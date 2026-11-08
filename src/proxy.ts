import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page request (Next.js 16 "proxy", formerly "middleware").
 *  1. Keeps the Supabase login session fresh (refreshes the cookie when needed).
 *  2. Sends logged-out visitors on /admin or /worker to the login page.
 *
 * The real role check (admin vs worker) happens on the server in each area's layout
 * via requireRole() — this is only the first, fast gate.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          // Supabase asks for no-cache headers when it refreshes a session.
          for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
        },
      },
    },
  );

  // Validates the session and refreshes it if it has expired. Don't put code between
  // createServerClient and this call.
  const { data } = await supabase.auth.getClaims();
  const loggedIn = Boolean(data?.claims?.sub);

  const path = request.nextUrl.pathname;
  const isProtected = path.startsWith("/admin") || path.startsWith("/worker");
  if (isProtected && !loggedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Only pages that need the login session. The public booking page, API routes
  // (e.g. Stripe webhooks) and static files skip this entirely.
  matcher: ["/admin/:path*", "/worker/:path*", "/login"],
};
