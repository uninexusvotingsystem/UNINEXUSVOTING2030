-- The original sync_nominee_vote_count trigger only fired on INSERT, never
-- DELETE. Under the original one-vote-forever model this rarely mattered,
-- but it meant any removed vote row (including vote-cap testing during
-- development) left vote_count permanently inflated rather than returning
-- to the real number — e.g. one nominee showed 33 stored vs 0 actual votes
-- at the time this was found and fixed.
create or replace function public.sync_nominee_vote_count()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update public.nominees set vote_count = vote_count + 1 where id = new.nominee_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.nominees set vote_count = greatest(0, vote_count - 1) where id = old.nominee_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists on_vote_cast on public.votes;
create trigger on_vote_cast
  after insert or delete on public.votes
  for each row execute function public.sync_nominee_vote_count();

-- One-time correction: recompute every nominee's vote_count from the real
-- votes table. Run once as part of this migration; not something that
-- needs repeating now that the trigger handles both directions correctly.
update public.nominees n
set vote_count = coalesce((select count(*) from public.votes v where v.nominee_id = n.id), 0);
