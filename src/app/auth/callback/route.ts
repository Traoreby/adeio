import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/redirect";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const destination = safeRedirectPath(requestUrl.searchParams.get("next"), request.url, "/espace-membre");
  const authError = requestUrl.searchParams.get("error");
  const authErrorCode = requestUrl.searchParams.get("error_code");

  if (authError || authErrorCode) {
    const message = authErrorCode === "otp_expired" ? "lien-expire" : "lien-invalide";
    return NextResponse.redirect(new URL(`/connexion?erreur=${message}&recovery=1`, requestUrl.origin));
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.redirect(new URL("/connexion?erreur=service-indisponible", requestUrl.origin));
  if (!code) return NextResponse.redirect(new URL("/connexion?erreur=lien-invalide&recovery=1", requestUrl.origin));

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/connexion?erreur=lien-expire&recovery=1", requestUrl.origin));

  return NextResponse.redirect(new URL(destination, requestUrl.origin));
}
