-- ============================================================================
-- 0002 — Scheduled voting close. Previously every category had to be closed
-- manually, one at a time — fine for a handful of categories, tedious once
-- you're running many at once. This adds an optional deadline per category
-- that a scheduled job (see app/api/cron/close-voting) checks periodically.
-- ============================================================================

alter table public.categories add column if not exists voting_closes_at timestamptz;
