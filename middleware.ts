import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isAdminRoute = path.startsWith("/admin") && path !== "/admin/login";

  // Every request gets its pathname forwarded as a header — this is how Server
  // Components (which have no usePathname() equivalent) can tell whether
  // they're rendering inside /admin, so the public marquee/cookie chrome can be
  // skipped there. Cheap: a header write, no Supabase call.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", path);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // The Supabase auth check below is a real network round-trip — only pay for
  // it on routes that actually need guarding, not on every public page load.
  if (!isAdminRoute) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("redirect", path);
    return NextResponse.redirect(url);
  }

  // Service-role client on purpose: this check must never be affected by RLS or
  // by whether the session cookie round-tripped perfectly — it's a simple,
  // safe, read-only lookup by a known user id.
  const service = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: admin } = await service.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();

  if (!admin) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("error", "not-admin");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Runs on every route (needed for the x-pathname header) except static
  // assets, which don't render through the React tree anyway.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
