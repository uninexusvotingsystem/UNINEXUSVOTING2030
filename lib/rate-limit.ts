import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;

/** True when rate limiting is actually active. Without Redis configured, every
 *  limiter below is null and silently enforces nothing — worth being able to
 *  detect explicitly rather than assuming protection that isn't there. */
export const rateLimitingEnabled = Boolean(redis);

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

// Voting limits, tightened for the reality of shared connections. A whole
// university campus, hostel, or cyber cafe can share ONE public IP, so a
// per-IP limit has to leave room for many genuine voters — but a burst limit
// alongside it still catches scripted mass-voting, which hits far faster than
// any realistic crowd of people typing on phones.
export const voteIpLimiter = makeLimiter(40, "1 h");
export const voteBurstLimiter = makeLimiter(5, "1 m");

// A blunt per-IP ceiling across ALL API routes — the cheap first line against
// someone simply hammering the site during voting hours. Deliberately high
// enough that no real person on a shared campus connection ever trips it.
export const globalApiLimiter = makeLimiter(120, "1 m");

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
