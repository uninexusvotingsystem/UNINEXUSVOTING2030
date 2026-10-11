-- Closes a race condition found in production: the otp-request route's
-- "does a code already exist?" check and the insert/update that followed it
-- were two separate database calls, not one atomic operation. Two
-- near-simultaneous requests for the same phone+category could both pass
-- the check before either write landed, producing two OTP rows (and two
-- SMS sends) instead of one.
--
-- This wraps the whole decision in a single Postgres function, guarded by
-- the same advisory-lock pattern already proven correct for the vote-cap
-- trigger, so the check and the write can no longer race against each other.
--
-- Returns one of: 'limit_reached', 'already_sent', 'blocked_expired', 'send'
-- ('send' means the caller should now actually send the SMS; the row is
-- already written by the time this returns).
--
-- Tested directly against production data before being relied on: first
-- call for a fresh phone+category returns 'send' and inserts a row; a
-- second call without force_resend returns 'already_sent' and does NOT
-- overwrite the existing row; a call WITH force_resend updates that same
-- row in place (never a second row) and returns 'send'; an expired row
-- returns 'blocked_expired'; a phone already at the 20-vote cap returns
-- 'limit_reached'.
create or replace function public.request_otp_slot(
  p_category_id uuid,
  p_phone_hash text,
  p_force_resend boolean,
  p_code_hash text,
  p_expires_at timestamptz
)
returns text as $$
declare
  v_vote_count integer;
  v_existing record;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_category_id::text || ':' || p_phone_hash, 0));

  select count(*) into v_vote_count
  from public.votes
  where category_id = p_category_id and phone_hash = p_phone_hash;

  if v_vote_count >= 20 then
    return 'limit_reached';
  end if;

  select id, expires_at into v_existing
  from public.otp_codes
  where category_id = p_category_id and phone_hash = p_phone_hash
  order by created_at desc
  limit 1;

  if v_existing.id is not null and v_existing.expires_at < now() then
    return 'blocked_expired';
  end if;

  if v_existing.id is not null and not p_force_resend then
    return 'already_sent';
  end if;

  if v_existing.id is not null then
    -- Resend: update the one existing row in place, never insert a second.
    update public.otp_codes set code_hash = p_code_hash, attempts = 0 where id = v_existing.id;
  else
    insert into public.otp_codes (category_id, phone_hash, code_hash, expires_at)
    values (p_category_id, p_phone_hash, p_code_hash, p_expires_at);
  end if;

  return 'send';
end;
$$ language plpgsql;
