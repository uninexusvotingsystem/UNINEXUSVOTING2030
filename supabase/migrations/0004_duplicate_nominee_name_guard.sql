-- Enables trigram-based fuzzy text matching, which is what lets this catch
-- spelling variants ("Blu Stitches" vs "Blue Stitches") rather than only
-- exact matches.
create extension if not exists pg_trgm;

-- A stored, normalized version of the name — lowercased, straight/curly
-- apostrophes unified, whitespace collapsed — kept as a real column (not
-- recomputed every query) so the fuzzy-search index below stays fast even
-- as the table grows into the thousands of rows.
alter table public.nominees
  add column if not exists normalized_name text
  generated always as (regexp_replace(lower(trim(replace(name, '’', ''''))), '\s+', ' ', 'g')) stored;

create index if not exists nominees_normalized_name_trgm_idx
  on public.nominees using gin (normalized_name gin_trgm_ops);

-- Enforced in a trigger rather than a unique index, because a plain index can
-- only catch EXACT matches — it can't tell "Blu Stitches" and "Blue Stitches"
-- are the same nomination attempt. Scope: PER CATEGORY (the same name can
-- legitimately appear in two different categories, just not twice in one).
-- Checks every pending/approved nominee in the same category for:
--   1. An exact match on the normalized name.
--   2. A fuzzy match above a 0.72 similarity threshold — high enough to
--      catch typos and near-duplicates, low enough that two genuinely
--      different short names won't be falsely flagged as the same person.
-- A different phone number or email on the new submission does not get
-- around this — the block applies regardless of who's submitting.
--
-- IMPORTANT implementation note: this function deliberately recomputes the
-- normalized name from NEW.name inside the trigger, rather than reading
-- NEW.normalized_name. A generated column is NOT yet populated on NEW inside
-- a BEFORE INSERT trigger in Postgres — an earlier version of this function
-- read NEW.normalized_name directly and silently matched against NULL every
-- time, meaning it never actually blocked anything despite deploying
-- without error. Keep the recomputation here if this function is ever
-- modified.
create or replace function public.block_duplicate_nominee_name()
returns trigger as $$
declare
  existing_id uuid;
  new_normalized text;
begin
  new_normalized := regexp_replace(lower(trim(replace(new.name, '’', ''''))), '\s+', ' ', 'g');

  select id into existing_id
  from public.nominees
  where status <> 'rejected'
    and category_id = new.category_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and (
      normalized_name = new_normalized
      or similarity(normalized_name, new_normalized) > 0.72
    )
  limit 1;

  if existing_id is not null then
    raise exception 'DUPLICATE_NOMINEE_NAME: % has already been nominated in this category', new.name
      using errcode = 'P0001';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists nominees_block_duplicate_name on public.nominees;
create trigger nominees_block_duplicate_name
  before insert on public.nominees
  for each row execute function public.block_duplicate_nominee_name();
