-- Raises the per-phone, per-category vote cap from 8 to 20. Same mechanism
-- as 0005 (advisory-lock-guarded trigger) — only the limit constant changes.
-- Tested directly before being saved here: 20 sequential inserts for one
-- phone+category succeeded, a 21st was rejected, test data cleaned up
-- afterward.
create or replace function public.enforce_vote_cap_per_phone_category()
returns trigger as $$
declare
  current_count integer;
  vote_limit constant integer := 20;
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
