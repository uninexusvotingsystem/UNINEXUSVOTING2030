import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * A self-check endpoint you can visit directly in the browser to see exactly
 * what's broken, instead of a screenshot round-trip every time something
 * fails with a generic error. Checks each thing the nomination submit route
 * actually depends on, in order, and reports the real result of each —
 * including the exact database/storage error text where something fails.
 *
 * Protected by a secret query param so a stranger can't use it to map out
 * your infrastructure. Visit:
 *   https://yourdomain/api/diagnostics?key=YOUR_CRON_SECRET
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized. Add ?key=YOUR_CRON_SECRET to the URL." }, { status: 401 });
  }

  const checks: Record<string, any> = {};

  // 1. Are the required env vars even present?
  checks.envVars = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    OTP_HASH_SECRET: Boolean(process.env.OTP_HASH_SECRET),
  };

  let supabase;
  try {
    supabase = createServiceRoleClient();
    checks.supabaseClientCreated = true;
  } catch (err: any) {
    checks.supabaseClientCreated = false;
    checks.supabaseClientError = err?.message;
    return NextResponse.json({ checks }, { status: 200 });
  }

  // 2. Can it actually reach Supabase and read the categories table?
  const { data: categories, error: categoriesErr } = await supabase.from("categories").select("id, name, nominations_open");
  checks.categoriesTable = categoriesErr
    ? { exists: false, error: categoriesErr.message, code: categoriesErr.code }
    : { exists: true, count: categories?.length ?? 0, rows: categories };

  // 3. Does the nominees table exist and accept a real insert? (inserted then
  //    immediately deleted — this is the exact operation that's been failing)
  const { data: testInsert, error: nomineesErr } = await supabase
    .from("nominees")
    .insert({
      category_id: categories?.[0]?.id ?? "00000000-0000-0000-0000-000000000000",
      name: "__diagnostic_test__",
      about: "Automated diagnostic check — safe to ignore, deleted immediately.",
      status: "rejected",
    })
    .select("id")
    .single();

  if (nomineesErr) {
    checks.nomineesTable = { canInsert: false, error: nomineesErr.message, code: nomineesErr.code, details: nomineesErr.details, hint: nomineesErr.hint };
  } else {
    checks.nomineesTable = { canInsert: true };
    if (testInsert?.id) await supabase.from("nominees").delete().eq("id", testInsert.id);
  }

  // 4. Does the storage bucket exist?
  const { data: buckets, error: bucketsErr } = await supabase.storage.listBuckets();
  checks.storageBucket = bucketsErr
    ? { error: bucketsErr.message }
    : { exists: buckets?.some((b) => b.id === "nominee-media") ?? false, allBuckets: buckets?.map((b) => b.id) };

  // 5. Does the admin_users table/function exist? (used by RLS policies)
  const { error: isAdminErr } = await supabase.rpc("is_admin");
  checks.isAdminFunction = isAdminErr ? { exists: false, error: isAdminErr.message } : { exists: true };

  return NextResponse.json({ checks }, { status: 200 });
}
