import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCategoryVotingStatus } from "@/lib/category-cache";
import { hashValue, normalizePhone } from "@/lib/otp";
import { voteIpLimiter, voteBurstLimiter, globalApiLimiter, enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { enforceCors } from "@/lib/cors";
import * as Sentry from "@sentry/nextjs";

const VOTE_LIMIT = 20;

const schema = z.object({
  categoryId: z.string().uuid(),
  nomineeId: z.string().uuid(),
  phone: z.string().min(9),
  code: z.string().length(6),
  // How many votes to cast for this nominee in this single request — lets a
  // voter type "5" once instead of tapping Vote five separate times. Capped
  // at VOTE_LIMIT here too (not just relying on the remaining-votes check
  // below), so a malformed or tampered request can't even attempt an
  // absurd quantity.
  quantity: z.number().int().min(1).max(VOTE_LIMIT).default(1),
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
    const { categoryId, nomineeId, phone: rawPhone, code, quantity } = schema.parse(await request.json());
    const phone = normalizePhone(rawPhone);
    const phoneHash = hashValue(phone);
    const codeHash = hashValue(code);

    const supabase = createServiceRoleClient();

    const category = await getCategoryVotingStatus(supabase, categoryId);
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

    // How many this phone has already cast in this category, checked BEFORE
    // attempting the insert — lets a request for more than remains fail with
    // a clear, specific message ("only 7 left") instead of a generic error.
    // This is a courtesy check, not the real enforcement: the database
    // trigger on votes (below) is still what's actually unbypassable, since
    // this check and the insert aren't atomic with each other on their own.
    const { count: alreadyCast } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("category_id", categoryId)
      .eq("phone_hash", phoneHash);

    const remainingBefore = Math.max(0, VOTE_LIMIT - (alreadyCast ?? 0));
    if (remainingBefore === 0) {
      await supabase.from("otp_codes").update({ consumed: true }).eq("id", otp.id);
      return NextResponse.json(
        { error: `This phone number has already used all ${VOTE_LIMIT} votes allowed in this category.` },
        { status: 409 }
      );
    }
    if (quantity > remainingBefore) {
      return NextResponse.json(
        {
          error: `You only have ${remainingBefore} vote${remainingBefore === 1 ? "" : "s"} left in this category. Please enter ${remainingBefore} or fewer.`,
        },
        { status: 400 }
      );
    }

    // One bulk insert for the whole requested quantity, not quantity-many
    // separate requests — this is the actual fix for "multiple clicking":
    // a voter who wants 15 votes for one nominee now sends ONE request, not
    // fifteen. The database trigger on votes still fires once PER ROW within
    // this single statement (Postgres processes multi-row inserts row by
    // row for row-level triggers), so the 20-vote cap is enforced exactly
    // as strictly as before — if anything slipped past the check above (a
    // genuine race with another concurrent request), the trigger still
    // catches it and the whole statement rolls back atomically; nothing
    // partial gets inserted.
    const ipHash = createHash("sha256").update(ip).digest("hex");
    const rows = Array.from({ length: quantity }, () => ({
      category_id: categoryId,
      nominee_id: nomineeId,
      phone_hash: phoneHash,
      ip_hash: ipHash,
    }));

    const { error } = await supabase.from("votes").insert(rows);

    if (error) {
      if (error.code === "P0002") {
        await supabase.from("otp_codes").update({ consumed: true }).eq("id", otp.id);
        return NextResponse.json(
          { error: `This phone number has already used all ${VOTE_LIMIT} votes allowed in this category.` },
          { status: 409 }
        );
      }
      throw error;
    }

    // No need to re-query the count here: the insert above is a single
    // atomic statement (verified directly — a bulk insert that would exceed
    // the cap rolls back in full, nothing partial), so the new total is
    // just the pre-check count plus however many were just inserted. Saves
    // a full extra database round trip on every single vote request, which
    // matters at real voting-night volume.
    const used = (alreadyCast ?? 0) + quantity;
    const remaining = Math.max(0, VOTE_LIMIT - used);

    if (remaining === 0) {
      await supabase.from("otp_codes").update({ consumed: true }).eq("id", otp.id);
    }
    // If remaining > 0, the OTP is deliberately left unconsumed so the SAME
    // code can be reused for this voter's next vote in this category without
    // requiring — and paying for — another SMS. It still can't be used past
    // its 5-minute expires_at, checked above on every cast.

    return NextResponse.json({ ok: true, votesUsed: used, votesRemaining: remaining, voteLimit: VOTE_LIMIT });
  } catch (err: any) {
    Sentry.captureException(err);
    return NextResponse.json({ error: err.message || "Something went wrong. Please try again." }, { status: 500 });
  }
}
