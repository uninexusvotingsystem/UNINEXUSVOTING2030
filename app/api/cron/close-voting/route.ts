import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Runs on a schedule (see vercel.json) so voting deadlines don't have to be
// closed manually one category at a time. Only ever CLOSES voting on its own —
// opening voting is always a deliberate admin action, never automatic.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const nowIso = new Date().toISOString();

  const { data: closed } = await supabase
    .from("categories")
    .update({ voting_open: false })
    .eq("voting_open", true)
    .lt("voting_closes_at", nowIso)
    .select("id, name");

  return NextResponse.json({ closed: closed?.length || 0, categories: closed?.map((c) => c.name) || [] });
}
