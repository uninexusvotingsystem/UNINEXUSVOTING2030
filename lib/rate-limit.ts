import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;

function makeLimiter(requests: number, window: `${number} ${"s" | "m" | "h"}`) {
  if (!redis) return null;
  return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(requests, window), analytics: true });
}

// A public, unauthenticated nomination form is the highest-risk endpoint on this
// whole site — anyone can hit it with no login at all. Rate limiting by IP is
// the main defense against someone (or a bot) flooding a category with junk
// submissions faster than a human ever could.
export const nominationSubmitLimiter = makeLimiter(5, "1 h");
export const otpRequestPhoneLimiter = makeLimiter(3, "15 m");
export const otpRequestIpLimiter = makeLimiter(10, "15 m");
export const otpVerifyLimiter = makeLimiter(8, "15 m");
export const voteIpLimiter = makeLimiter(30, "1 h");

export function clientIp(request: Request) {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function enforceRateLimit(limiter: Ratelimit | null, key: string) {
  if (!limiter) return null;
  const { success, reset } = await limiter.limit(key);
  if (success) return null;
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return new Response(JSON.stringify({ error: "Too many requests. Please try again shortly." }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) },
  });
}
