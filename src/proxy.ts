import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Auth callbacks and token confirmation pages must not run session refreshes
  // before their one-time credentials are exchanged by their own handler/action.
  if (request.nextUrl.pathname === "/auth/callback" || request.nextUrl.pathname === "/auth/verify") {
    const response = NextResponse.next({ request });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        response.headers.set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
        response.headers.set("Expires", "0");
        response.headers.set("Pragma", "no-cache");
      },
    },
  });

  // One verified call refreshes expired sessions and writes rotated cookies
  // back to both the downstream request and browser response.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/espace-membre/:path*",
    "/membres/:path*",
    "/archives",
    "/securite",
    "/connexion",
    "/mot-de-passe",
    "/auth/:path*",
  ],
};
