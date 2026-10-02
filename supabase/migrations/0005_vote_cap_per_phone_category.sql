-- The original rule: UNIQUE (category_id, phone_hash) — exactly one row
-- allowed, period. Dropped to allow more than one vote per phone at all.
alter table public.votes drop constraint if exists votes_category_id_phone_hash_key;

-- Replacement rule: up to 8 total votes per phone number, per category —
-- across ANY nominee in that category, in any distribution (all 8 on one
-- nominee, or split across several). Enforced with a trigger rather than a
-- simple constraint, because "at most 8" isn't something a UNIQUE or CHECK
-- constraint alone can express.
--
-- Race-safety: an advisory lock, scoped to this exact (category, phone)
-- pair, is taken before counting existing votes. Without it, several
-- simultaneous vote requests from the same phone (rapid tapping, or a
-- scripted burst) could each see "7 votes so far" and all insert, pushing
-- the real total past 8. The lock forces concurrent attempts from the same
-- phone+category to queue up one at a time, so the count each one sees is
-- always accurate. It's released automatically when the transaction ends —
-- no manual cleanup needed.
--
-- Tested directly against this exact scenario before being relied on: 8
-- sequential inserts for one phone+category succeeded, a 9th was rejected
-- with the error below.
create or replace function public.enforce_vote_cap_per_phone_category()
returns trigger as $$
declare
  current_count integer;
  vote_limit constant integer := 8;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.category_id::text || ':' || new.phone_hash, 0));

  select count(*) into current_count
  from public.votes
  where category_id = new.category_id and phone_hash = new.phone_hash;

  if current_count >= vote_limit then
    raise exception 'VOTE_LIMIT_REACHED: this phone number has already cast % of % allowed votes in this category', current_count, vote_limit
      using errcode = 'P0002';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists votes_enforce_cap on public.votes;
create trigger votes_enforce_cap
  before insert on public.votes
  for each row execute function public.enforce_vote_cap_per_phone_category();
