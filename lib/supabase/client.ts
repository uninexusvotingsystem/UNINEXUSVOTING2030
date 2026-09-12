import { createBrowserClient } from "@supabase/ssr";

// Note: intentionally untyped (no <Database> generic). The hand-authored Database
// type in ./types is kept as documentation of the schema, but applying it strictly
// here caused TypeScript to infer `never` for dynamic insert/update payloads used
// throughout the admin pages (e.g. `.update(payload)` where payload is built from
// form state), which failed `next build`. Once you regenerate real types with
// `supabase gen types`, you can re-add `<Database>` safely.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
