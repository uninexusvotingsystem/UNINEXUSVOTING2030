import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCategoryVotingStatus } from "@/lib/category-cache";
import { deriveOtpCode, hashValue, normalizePhone } from "@/lib/otp";
import { sendOtpSms } from "@/lib/sms";
import {
  otpRequestPhoneLimiter, otpRequestIpLimiter, voteBurstLimiter, globalApiLimiter,
  enforceRateLimit, clientIp,
} from "@/lib/rate-limit";
import { enforceCors } from "@/lib/cors";
import { verifyTurnstileToken } from "@/lib/turnstile";
import * as Sentry from "@sentry/nextjs";

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

    const VOTE_LIMIT = 20;
    const { count: votesSoFar } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("category_id", categoryId)
      .eq("phone_hash", phoneHash);

    if ((votesSoFar ?? 0) >= VOTE_LIMIT) {
      return NextResponse.json(
        { error: `This phone number has already used all ${VOTE_LIMIT} votes allowed in this category.` },
        { status: 409 }
      );
    }

    // STRICT RULE: ONE code per phone number per category, ever. If this phone
    // has ever been issued a code here (used, unused, expired — any state),
    // NO new SMS is sent on a normal request; the voter is simply taken to the
    // "enter your code" step. The only way to get an SMS again is the explicit
    // "Resend code" button, which re-sends the SAME code (never a new one).
    const { data: existingOtp } = await supabase
      .from("otp_codes")
      .select("id, code_hash, expires_at")
      .eq("category_id", categoryId)
      .eq("phone_hash", phoneHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // CAPTCHA before anything that costs money. A resend for a number that
    // already passed the CAPTCHA once (it has a code on file) skips it — the
    // widget isn't on screen at the code step — and is still covered by the
    // per-phone / per-IP / burst limiters above.
    if (!(forceResend && existingOtp)) {
      const turnstileOk = await verifyTurnstileToken(turnstileToken || null, ip);
      if (!turnstileOk) {
        return NextResponse.json({ error: "Verification failed — please refresh and try again." }, { status: 400 });
      }
    }

    // The code is valid for 5 minutes from when it was first sent. If that
    // window has passed without the voter finishing, they are done for this
    // category: no new code, no resend, ever. Checked BEFORE anything is sent.
    if (existingOtp && new Date(existingOtp.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: "This number was already sent a code earlier for this category. Only one code is allowed per number, so another can't be sent." },
        { status: 403 }
      );
    }

    if (existingOtp && !forceResend) {
      return NextResponse.json({ ok: true, alreadySent: true });
    }

    const code = deriveOtpCode(phone, categoryId);
    const codeHash = hashValue(code);
    const validUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    if (existingOtp) {
      // Resend (only reachable inside the original 5-minute window): same row,
      // same code, expiry NOT extended. Older random-code rows move to the
      // derived code once.
      await supabase
        .from("otp_codes")
        .update({ code_hash: codeHash, attempts: 0 })
        .eq("id", existingOtp.id);
    } else {
      await supabase.from("otp_codes").insert({
        category_id: categoryId,
        phone_hash: phoneHash,
        code_hash: codeHash,
        expires_at: validUntil,
      });
    }

    await sendOtpSms(phone, code);

    return NextResponse.json({ ok: true, resent: !!existingOtp });
  } catch (err: any) {
    Sentry.captureException(err);
    console.error("[otp-request] failed:", err?.message || err);
    return NextResponse.json({ error: "Couldn't send a verification code. Please try again." }, { status: 500 });
  }
}
