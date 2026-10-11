import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCategoryVotingStatus } from "@/lib/category-cache";
import { deriveOtpCode, generateOtpCode, hashValue, normalizePhone } from "@/lib/otp";
import { sendOtpSms } from "@/lib/sms";
import {
  otpRequestPhoneLimiter, otpRequestIpLimiter, voteBurstLimiter, globalApiLimiter,
  enforceRateLimit, clientIp,
} from "@/lib/rate-limit";
import { enforceCors } from "@/lib/cors";
import { verifyTurnstileToken } from "@/lib/turnstile";
import * as Sentry from "@sentry/nextjs";

const VOTE_LIMIT = 20;

const schema = z.object({
  categoryId: z.string().uuid(),
  phone: z.string().min(9),
  turnstileToken: z.string().optional(),
  // True when the voter explicitly tapped "Resend code" because the first
  // SMS never arrived — forces a brand-new code instead of silently reusing
  // a still-valid pending one. Rate limited exactly the same as any other
  // request to this route (otpRequestPhoneLimiter: 3 per 15 min), so this
  // can't be used to spam SMS any more than a normal request could.
  forceResend: z.boolean().optional(),
});

export async function POST(request: Request) {
  const corsBlock = enforceCors(request);
  if (corsBlock) return corsBlock;

  const ip = clientIp(request);

  // Cheapest checks first, before any parsing or database work — a flood
  // should be rejected as early and as cheaply as possible.
  const globalBlocked =
    (await enforceRateLimit(globalApiLimiter, `global:${ip}`)) ||
    (await enforceRateLimit(voteBurstLimiter, `otp:burst:${ip}`));
  if (globalBlocked) return globalBlocked;

  try {
    const { categoryId, phone: rawPhone, turnstileToken, forceResend } = schema.parse(await request.json());

    const phone = normalizePhone(rawPhone);
    if (!/^254(7|1)\d{8}$/.test(phone)) {
      return NextResponse.json({ error: "Enter a valid Kenyan number, e.g. 0712345678." }, { status: 400 });
    }
    const phoneHash = hashValue(phone);

    const blocked =
      (await enforceRateLimit(otpRequestPhoneLimiter, `otp:phone:${phoneHash}`)) ||
      (await enforceRateLimit(otpRequestIpLimiter, `otp:ip:${ip}`));
    if (blocked) return blocked;

    const supabase = createServiceRoleClient();

    const category = await getCategoryVotingStatus(supabase, categoryId);
    if (!category || !category.voting_open) {
      return NextResponse.json({ error: "Voting isn't open for this category." }, { status: 400 });
    }

    // Lightweight, NON-authoritative peek — used only to decide whether this
    // request can skip CAPTCHA (a resend from someone who already passed it
    // once). The real, race-proof decision happens inside request_otp_slot()
    // below, inside a single locked transaction, so this peek being
    // slightly stale in a rare race is harmless: worst case is verifying
    // CAPTCHA when it technically wasn't required, never the reverse.
    const { data: existingPeek } = await supabase
      .from("otp_codes")
      .select("id")
      .eq("category_id", categoryId)
      .eq("phone_hash", phoneHash)
      .limit(1)
      .maybeSingle();

    if (!(forceResend && existingPeek)) {
      const turnstileOk = await verifyTurnstileToken(turnstileToken || null, ip);
      if (!turnstileOk) {
        return NextResponse.json({ error: "Verification failed — please refresh and try again." }, { status: 400 });
      }
    }

    const derived = deriveOtpCode(phone, categoryId);
    const code = derived ?? generateOtpCode();
    const codeHash = hashValue(code);
    const validUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // ONE atomic call: checks the 20-vote cap, checks for an existing code,
    // and performs the insert/update for it — all inside one advisory-lock-
    // guarded Postgres transaction (request_otp_slot, see its own migration
    // for the full explanation). This is what actually closes the race that
    // let two near-simultaneous requests for the same phone+category both
    // slip past a "does it already exist?" check before either write
    // landed — confirmed happening in production before this fix.
    const { data: slot, error: slotErr } = await supabase.rpc("request_otp_slot", {
      p_category_id: categoryId,
      p_phone_hash: phoneHash,
      p_force_resend: !!forceResend,
      p_code_hash: codeHash,
      p_expires_at: validUntil,
    });

    if (slotErr) throw slotErr;

    if (slot === "limit_reached") {
      return NextResponse.json(
        { error: `This phone number has already used all ${VOTE_LIMIT} votes allowed in this category.` },
        { status: 409 }
      );
    }
    if (slot === "blocked_expired") {
      return NextResponse.json(
        {
          error:
            "This number was already sent a code earlier for this category. Only one code is allowed per number, so another can't be sent.",
        },
        { status: 403 }
      );
    }
    if (slot === "already_sent") {
      return NextResponse.json({ ok: true, alreadySent: true });
    }

    // slot === "send" — the row is already safely written at this point, so
    // only now does the request spend real money calling Celcom. If the SMS
    // send itself fails, the row still exists, meaning a bare retry of this
    // same request would correctly be treated as "already sent" rather than
    // writing a second row — right for preventing duplicates, but it does
    // mean a genuine provider failure here needs the voter to use Resend.
    // Logged clearly either way so a failure is visible, not silent.
    try {
      await sendOtpSms(phone, code);
    } catch (smsErr) {
      Sentry.captureException(smsErr);
      console.error("[otp-request] SMS send failed after slot was claimed:", smsErr instanceof Error ? smsErr.message : smsErr);
      return NextResponse.json({ error: "Couldn't send the SMS right now. Please try Resend in a moment." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, resent: !!existingPeek });
  } catch (err: any) {
    Sentry.captureException(err);
    console.error("[otp-request] failed:", err?.message || err);
    return NextResponse.json({ error: "Couldn't send a verification code. Please try again." }, { status: 500 });
  }
}
