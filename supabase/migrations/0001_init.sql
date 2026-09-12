-- ============================================================================
-- UNX Awards — standalone nominations + voting system.
-- Fully isolated from the main UniNexus Connect database on purpose: this
-- system takes public, unauthenticated submissions at scale (1000+ nominees),
-- which is a fundamentally higher-risk surface than a members-only site. If
-- anything here is ever abused or overwhelmed, it cannot touch member data,
-- tickets, or payments on the main site — they don't share a database.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------- Admin roles (mirrors the main site's pattern) ----------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- ---------- Categories ----------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  -- Two independent phases per category: first collect nominations from the
  -- public, then (once you've moderated down to a clean shortlist) open voting.
  -- Keeping these as separate flags means you can close nominations for a
  -- category while others are still open, and open voting for one category
  -- while still moderating another.
  nominations_open boolean not null default true,
  voting_open boolean not null default false,
  results_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Nominees ----------
-- Every public submission lands here as 'pending' — nothing submitted by the
-- public is ever visible anywhere until an admin approves it. This is the
-- moderation gate: you can collect as many raw submissions as come in, then
-- prune down to your target shortlist (e.g. ~10 per category) before voting
-- ever opens, without the public ever seeing the unmoderated flood.
create type public.nominee_status as enum ('pending', 'approved', 'rejected');

create table if not exists public.nominees (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null,
  about text not null,
  status public.nominee_status not null default 'pending',
  -- Contact info for the SUBMITTER (not necessarily the nominee themselves) —
  -- lets an admin follow up to verify a submission or ask for a better photo,
  -- without this ever being shown publicly.
  submitter_email text,
  submitter_phone text,
  vote_count integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id)
);

create index if not exists nominees_category_idx on public.nominees(category_id);
create index if not exists nominees_status_idx on public.nominees(status);
-- Supports fast case-insensitive name search once a category has hundreds of
-- pending submissions to moderate.
create index if not exists nominees_name_search_idx on public.nominees using gin (to_tsvector('simple', name));

-- ---------- Nominee media (up to a few photos + one short video) ----------
create table if not exists public.nominee_media (
  id uuid primary key default gen_random_uuid(),
  nominee_id uuid not null references public.nominees(id) on delete cascade,
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists nominee_media_nominee_idx on public.nominee_media(nominee_id);

-- ---------- OTP codes for voting (same pattern as the main site's gala voting) ----------
create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone_hash text not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists otp_codes_lookup_idx on public.otp_codes(phone_hash, category_id, expires_at);

-- ---------- Votes ----------
-- The unique constraint below — not application logic — is what actually
-- guarantees one vote per phone number per category, even under concurrent
-- requests. This is the same design proven on the main site's gala voting.
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  nominee_id uuid not null references public.nominees(id) on delete cascade,
  phone_hash text not null,
  ip_hash text,
  created_at timestamptz not null default now(),
  unique (category_id, phone_hash)
);

create index if not exists votes_nominee_idx on public.votes(nominee_id);

-- Keep nominees.vote_count in sync automatically (cheap single-column read on
-- the public results view, instead of counting votes on every page load).
create or replace function public.sync_nominee_vote_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.nominees set vote_count = vote_count + 1 where id = new.nominee_id;
  return new;
end;
$$;

drop trigger if exists on_vote_cast on public.votes;
create trigger on_vote_cast
  after insert on public.votes
  for each row execute function public.sync_nominee_vote_count();

-- ---------- Admin audit log ----------
-- Useful for disputes over close results, or tracking who opened/closed voting
-- and when, and who approved/rejected which nominees.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id),
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.categories enable row level security;
alter table public.nominees enable row level security;
alter table public.nominee_media enable row level security;
alter table public.otp_codes enable row level security;
alter table public.votes enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_audit_log enable row level security;

-- Categories: public read (need to see names/slugs to nominate/vote); admin write.
drop policy if exists "categories_public_read" on public.categories;
create policy "categories_public_read" on public.categories for select using (true);
drop policy if exists "categories_admin_write" on public.categories;
create policy "categories_admin_write" on public.categories for all using (public.is_admin()) with check (public.is_admin());

-- Nominees: public can only ever see APPROVED nominees (or admins see everything,
-- including the pending queue awaiting moderation). Public submission (insert)
-- happens through a server API route using the service role, NOT a direct public
-- insert policy — see /api/nominations/submit. This keeps the moderation gate a
-- server-enforced guarantee, not just an RLS policy someone could route around.
drop policy if exists "nominees_public_read_approved" on public.nominees;
create policy "nominees_public_read_approved" on public.nominees
  for select using (status = 'approved' or public.is_admin());
drop policy if exists "nominees_admin_write" on public.nominees;
create policy "nominees_admin_write" on public.nominees for all using (public.is_admin()) with check (public.is_admin());

-- Nominee media: visible only alongside an approved nominee (or to admins).
drop policy if exists "nominee_media_public_read" on public.nominee_media;
create policy "nominee_media_public_read" on public.nominee_media
  for select using (
    exists (select 1 from public.nominees n where n.id = nominee_id and (n.status = 'approved' or public.is_admin()))
  );
drop policy if exists "nominee_media_admin_write" on public.nominee_media;
create policy "nominee_media_admin_write" on public.nominee_media for all using (public.is_admin()) with check (public.is_admin());

-- OTP codes and votes: no direct public policies at all — every read/write goes
-- through server API routes using the service role, which is what actually
-- enforces the OTP-then-vote sequence and the one-vote-per-phone constraint.
drop policy if exists "otp_codes_admin_read" on public.otp_codes;
create policy "otp_codes_admin_read" on public.otp_codes for select using (public.is_admin());
drop policy if exists "votes_admin_read" on public.votes;
create policy "votes_admin_read" on public.votes for select using (public.is_admin());

-- Admin tables: admin-only, full stop.
drop policy if exists "admin_users_admin_read" on public.admin_users;
create policy "admin_users_admin_read" on public.admin_users for select using (public.is_admin());
drop policy if exists "admin_audit_log_admin_read" on public.admin_audit_log;
create policy "admin_audit_log_admin_read" on public.admin_audit_log for select using (public.is_admin());

-- ============================================================================
-- Public results function (bypasses RLS deliberately, security definer) —
-- returns only what should ever be public: approved nominees' vote tallies,
-- and only for categories with results_published = true.
-- ============================================================================
create or replace function public.get_category_results(_category_id uuid)
returns table (nominee_id uuid, nominee_name text, vote_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select n.id, n.name, n.vote_count::bigint
  from public.nominees n
  join public.categories c on c.id = n.category_id
  where n.category_id = _category_id
    and n.status = 'approved'
    and c.results_published = true
  order by n.vote_count desc;
$$;

-- ============================================================================
-- Storage buckets
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('nominee-media', 'nominee-media', true)
on conflict (id) do nothing;

-- No public storage write policy at all — every upload goes through the
-- /api/nominations/submit route using the service role, which validates file
-- type and size BEFORE anything touches storage. A public-facing form that
-- allowed direct anonymous storage writes would be an open invitation for
-- someone to dump arbitrary files at your bucket; routing through a validating
-- server endpoint closes that off entirely.
drop policy if exists "nominee_media_storage_public_read" on storage.objects;
create policy "nominee_media_storage_public_read" on storage.objects
  for select using (bucket_id = 'nominee-media');
