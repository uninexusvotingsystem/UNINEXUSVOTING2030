import { headers } from "next/headers";
import { MarqueeBanner } from "@/components/marquee-banner";
import { CookieConsent } from "@/components/cookie-consent";

/**
 * Renders the public-facing chrome (scrolling banner + cookie notice) on
 * every page EXCEPT the admin panel — an admin managing nominations doesn't
 * need the visitor banner scrolling above their workspace.
 *
 * IMPORTANT: this must stay a Server Component. MarqueeBanner is itself an
 * async Server Component (it reads the banner text from Supabase), and a
 * Client Component cannot import/render one — Next.js fails the entire build
 * with "You're importing a component that needs next/headers" if you try.
 * Server Components have no usePathname(), so the route is read from the
 * `x-pathname` header that middleware.ts stamps onto every request.
 */
export function PublicChrome({ slot }: { slot: "top" | "bottom" }) {
  const isAdminRoute = (headers().get("x-pathname") || "").startsWith("/admin");
  if (isAdminRoute) return null;

  return slot === "top" ? <MarqueeBanner /> : <CookieConsent />;
}
