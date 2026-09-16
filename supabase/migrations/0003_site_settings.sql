-- ============================================================================
-- 0003 — Site settings: admin-editable key/value store, used first for the
-- scrolling marquee banner text at the top of every public page.
-- ============================================================================

create table if not exists public.site_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

-- Public read: every visitor's page load needs the banner text.
drop policy if exists "site_settings_public_read" on public.site_settings;
create policy "site_settings_public_read" on public.site_settings
  for select using (true);

drop policy if exists "site_settings_admin_write" on public.site_settings;
create policy "site_settings_admin_write" on public.site_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- Seed the banner with the launch message. `on conflict do nothing` so
-- re-running this migration never overwrites text the admin has since edited.
insert into public.site_settings (key, value)
values (
  'marquee_text',
  'UniNexus Connect Nomination Now Open & Ends on Friday 25th September. Nominate One. Nominate All!'
)
on conflict (key) do nothing;
