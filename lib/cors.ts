function normalize(origin: string) {
  return origin.trim().toLowerCase().replace(/\/+$/, "");
}

const STATIC_ALLOWED = [
  process.env.NEXT_PUBLIC_SITE_URL,
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
  process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  "http://localhost:3000",
]
  .filter(Boolean)
  .map((o) => normalize(o as string));

export function enforceCors(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const normalizedOrigin = normalize(origin);

  const host = request.headers.get("host");
  if (host) {
    const selfOrigins = [normalize(`https://${host}`), normalize(`http://${host}`)];
    if (selfOrigins.includes(normalizedOrigin)) return null;
  }

  if (STATIC_ALLOWED.includes(normalizedOrigin)) return null;

  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol === "https:" && hostname.endsWith(".vercel.app")) return null;
  } catch {
    // Malformed Origin header — fall through to reject below.
  }

  console.warn(`[cors] Rejected request from origin "${origin}" (request host: "${host || "unknown"}").`);

  return new Response(JSON.stringify({ error: "Origin not allowed." }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
