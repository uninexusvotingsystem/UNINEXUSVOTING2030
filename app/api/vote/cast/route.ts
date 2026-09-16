import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { hashValue, normalizePhone } from "@/lib/otp";
import { voteIpLimiter, voteBurstLimiter, globalApiLimiter, enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { enforceCors } from "@/lib/cors";
import * as Sentry from "@sentry/nextjs";

const schema = z.object({
  categoryId: z.string().uuid(),
  nomineeId: z.string().uuid(),
  phone: z.string().min(9),
  code: z.string().length(6),
});

export async function POST(request: Request) {
  const corsBlock = enforceCors(request);
  if (corsBlock) return corsBlock;

  const ip = clientIp(request);
  const blocked =
    (await enforceRateLimit(globalApiLimiter, `global:${ip}`)) ||
    (await enforceRateLimit(voteBurstLimiter, `vote:burst:${ip}`)) ||
    (await enforceRateLimit(voteIpLimiter, `vote:ip:${ip}`));
  if (blocked) return blocked;

  try {
    const { categoryId, nomineeId, phone: rawPhone, code } = schema.parse(await request.json());
    const phone = normalizePhone(rawPhone);
    const phoneHash = hashValue(phone);
    const codeHash = hashValue(code);

    const supabase = createServiceRoleClient();

    const { data: category } = await supabase.from("categories").select("id, voting_open").eq("id", categoryId).maybeSingle();
    if (!category || !category.voting_open) {
      return NextResponse.json({ error: "Voting isn't open for this category." }, { status: 400 });
    }

    const { data: nominee } = await supabase
      .from("nominees")
      .select("id")
      .eq("id", nomineeId)
      .eq("category_id", categoryId)
      .eq("status", "approved")
      .maybeSingle();
    if (!nominee) {
      return NextResponse.json({ error: "That nominee isn't available in this category." }, { status: 400 });
    }

    const { data: otp } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("category_id", categoryId)
      .eq("phone_hash", phoneHash)
      .eq("consumed", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp) {
      return NextResponse.json({ error: "Request a new verification code and try again." }, { status: 400 });
    }
    if (new Date(otp.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "That code has expired. Request a new one." }, { status: 400 });
    }
    if (otp.attempts >= 5) {
      return NextResponse.json({ error: "Too many incorrect attempts. Request a new code." }, { status: 429 });
    }
    if (otp.code_hash !== codeHash) {
      await supabase.from("otp_codes").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
      return NextResponse.json({ error: "Incorrect code. Please try again." }, { status: 400 });
    }

    // Code is correct — consume it, then cast the vote. The (category_id,
    // phone_hash) unique constraint on the votes table is the real,
    // unbypassable guard against voting twice, not this application check.
    await supabase.from("otp_codes").update({ consumed: true }).eq("id", otp.id);

    const { error } = await supabase.from("votes").insert({
      category_id: categoryId,
      nominee_id: nomineeId,
      phone_hash: phoneHash,
      ip_hash: createHash("sha256").update(ip).digest("hex"),
    });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "This phone number has already voted in this category." }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    Sentry.captureException(err);
    return NextResponse.json({ error: err.message || "Something went wrong. Please try again." }, { status: 500 });
  }
}
