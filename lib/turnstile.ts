/**
 * Verifies a Cloudflare Turnstile token server-side. Returns true only if
 * Turnstile isn't configured at all (so the site still works before you've
 * set it up) or if Cloudflare confirms the token is genuinely valid — never
 * trusts the client's word for it.
 */
export async function verifyTurnstileToken(token: string | null, remoteIp: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Not configured yet — don't block submissions.
  if (!token) return false;

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
    });
    const data = await res.json();
    return data.success === true;
  } catch {
    // Cloudflare unreachable — fail closed (reject) rather than silently
    // letting an unverifiable submission through.
    return false;
  }
}
