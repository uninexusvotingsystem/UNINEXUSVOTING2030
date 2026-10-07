// A short-lived cache of a category's voting_open status, shared across
// requests handled by the same warm serverless instance. This changes
// rarely (an admin toggles it a handful of times during an event, not
// constantly), but it's checked on EVERY vote OTP-request and every vote
// cast — during a real burst (many people voting in the same category at
// once, exactly what tomorrow looks like), that's a lot of identical reads
// for information that was almost certainly still true a few seconds ago.
// Same pattern already used for nomination category lookups.
const CACHE_TTL_MS = 20_000;
const cache = new Map<string, { data: { id: string; voting_open: boolean }; expiresAt: number }>();

export async function getCategoryVotingStatus(supabase: any, categoryId: string) {
  const cached = cache.get(categoryId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { data } = await supabase.from("categories").select("id, voting_open").eq("id", categoryId).maybeSingle();
  if (data) cache.set(categoryId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}
