import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/redirect";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const redirectOrigin = process.env.NODE_ENV === "production"
    ? "https://adeio.vercel.app"
    : requestUrl.origin;

  // Reject callback requests delivered to a Vercel preview or any other host.
  // The OAuth/OTP exchange and its cookies must complete on the official site.
  if (requestUrl.origin !== redirectOrigin) {
    return NextResponse.redirect(new URL("/connexion?erreur=lien-invalide&recovery=1", redirectOrigin));
  }

  const code = requestUrl.searchParams.get("code");
  const destination = safeRedirectPath(requestUrl.searchParams.get("next"), request.url, "/espace-membre");
  const authError = requestUrl.searchParams.get("error");
  const authErrorCode = requestUrl.searchParams.get("error_code");

  if (authError || authErrorCode) {
    const message = authErrorCode === "otp_expired" ? "lien-expire" : "lien-invalide";
    return NextResponse.redirect(new URL(`/connexion?erreur=${message}&recovery=1`, redirectOrigin));
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.redirect(new URL("/connexion?erreur=service-indisponible", redirectOrigin));
  if (!code) return NextResponse.redirect(new URL("/connexion?erreur=lien-invalide&recovery=1", redirectOrigin));

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return NextResponse.redirect(new URL("/connexion?erreur=lien-expire&recovery=1", redirectOrigin));
  }

  // Confirm the exchanged session with Supabase before redirecting to the
  // password form; the SSR client writes the session cookies in this handler.
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user || user.id !== data.session.user.id) {
    return NextResponse.redirect(new URL("/connexion?erreur=lien-invalide&recovery=1", redirectOrigin));
  }

  return NextResponse.redirect(new URL(destination, redirectOrigin));
}
