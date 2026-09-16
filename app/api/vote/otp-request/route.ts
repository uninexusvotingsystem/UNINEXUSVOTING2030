import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { generateOtpCode, hashValue, normalizePhone } from "@/lib/otp";
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
    const { categoryId, phone: rawPhone, turnstileToken } = schema.parse(await request.json());

    // CAPTCHA before anything that costs money. Every OTP request sends a real
    // SMS you pay for, so this endpoint is the one most worth protecting from
    // scripted abuse — without it, a bot could drain your Africa's Talking
    // balance simply by requesting codes in a loop.
    const turnstileOk = await verifyTurnstileToken(turnstileToken || null, ip);
    if (!turnstileOk) {
      return NextResponse.json({ error: "Verification failed — please refresh and try again." }, { status: 400 });
    }

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

    const { data: category } = await supabase.from("categories").select("id, voting_open").eq("id", categoryId).maybeSingle();
    if (!category || !category.voting_open) {
      return NextResponse.json({ error: "Voting isn't open for this category." }, { status: 400 });
    }

    const { data: existingVote } = await supabase
      .from("votes")
      .select("id")
      .eq("category_id", categoryId)
      .eq("phone_hash", phoneHash)
      .maybeSingle();
    if (existingVote) {
      return NextResponse.json({ error: "This phone number has already voted in this category." }, { status: 409 });
    }

    const code = generateOtpCode();
    const codeHash = hashValue(code);

    await supabase.from("otp_codes").insert({
      category_id: categoryId,
      phone_hash: phoneHash,
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    await sendOtpSms(phone, code);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    Sentry.captureException(err);
    console.error("[otp-request] failed:", err?.message || err);
    return NextResponse.json({ error: "Couldn't send a verification code. Please try again." }, { status: 500 });
  }
}
