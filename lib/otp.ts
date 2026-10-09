import { createHash, createHmac, randomInt } from "crypto";
import { normalizePhone } from "@/lib/utils";

export { normalizePhone };

export function generateOtpCode() {
  return String(randomInt(100000, 999999));
}

export function hashValue(value: string) {
  const pepper = process.env.OTP_HASH_SECRET || process.env.CRON_SECRET || "unx-awards-fallback-pepper";
  return createHash("sha256").update(`${value}:${pepper}`).digest("hex");
}

// One permanent code per phone number per category. The code is derived (not
// random) so that "Resend code" can send the SAME code again without having to
// store it in plain text. Needs a real secret — never the public fallback.
export function deriveOtpCode(phone: string, categoryId: string) {
  const secret = process.env.OTP_HASH_SECRET || process.env.CRON_SECRET;
  if (!secret) throw new Error("OTP_HASH_SECRET (or CRON_SECRET) must be set to issue voting codes.");
  const n = createHmac("sha256", secret).update(`otp:${categoryId}:${phone}`).digest().readUInt32BE(0);
  return String(100000 + (n % 900000));
}
