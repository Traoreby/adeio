import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/redirect";

const RECOVERY_COOKIE = "adeio-password-recovery";
const PASSWORD_API_PATH = "/api/account/password";
const PASSWORD_FLOW_COOKIE = "adeio-password-flow";
const PASSWORD_FLOWS = new Set(["invitation", "signup", "recovery", "reactivation"]);

function errorRedirect(origin: string, error: string) {
  const response = NextResponse.redirect(new URL(`/connexion?erreur=${error}&recovery=1`, origin));
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function exchangeErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "";
  return error.code;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const redirectOrigin = process.env.NODE_ENV === "production"
    ? "https://adeio.vercel.app"
    : requestUrl.origin;

  // Reject callback requests delivered to a Vercel preview or any other host.
  // The OAuth/OTP exchange and its cookies must complete on the official site.
  if (requestUrl.origin !== redirectOrigin) {
    return errorRedirect(redirectOrigin, "domaine-invalide");
  }

  const code = requestUrl.searchParams.get("code");
  const destination = safeRedirectPath(requestUrl.searchParams.get("next"), request.url, "/espace-membre");
  const requestedFlow = requestUrl.searchParams.get("flow");
  const passwordFlow = requestedFlow && PASSWORD_FLOWS.has(requestedFlow) ? requestedFlow : null;
  const authError = requestUrl.searchParams.get("error");
  const authErrorCode = requestUrl.searchParams.get("error_code");

  if (authError || authErrorCode) {
    const error = authErrorCode === "otp_expired" || authErrorCode === "flow_state_expired"
      ? "lien-expire"
      : authErrorCode === "bad_code_verifier" || authErrorCode === "pkce_code_verifier_not_found"
        ? "verificateur-manquant"
        : "lien-invalide";
    return errorRedirect(redirectOrigin, error);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return errorRedirect(redirectOrigin, "service-indisponible");
  if (!code) return errorRedirect(redirectOrigin, "code-manquant");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    const code = exchangeErrorCode(error);
    const redirectError = code === "flow_state_expired" || code === "flow_state_not_found" || code === "otp_expired"
      ? "lien-expire"
      : code === "bad_code_verifier" || code === "pkce_code_verifier_not_found"
        ? "verificateur-manquant"
        : code === "over_request_rate_limit"
          ? "trop-de-demandes"
          : "echange-impossible";
    return errorRedirect(redirectOrigin, redirectError);
  }

  // Confirm the exchanged session with Supabase before redirecting to the
  // password form; the SSR client writes the session cookies in this handler.
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) return errorRedirect(redirectOrigin, "verification-indisponible");
  if (!user || user.id !== data.session.user.id) {
    return errorRedirect(redirectOrigin, "session-absente");
  }

  const cookieStore = await cookies();
  if (passwordFlow) {
    cookieStore.set(PASSWORD_FLOW_COOKIE, passwordFlow, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: PASSWORD_API_PATH,
      maxAge: 10 * 60,
    });
    if (passwordFlow === "recovery") {
      cookieStore.set(RECOVERY_COOKIE, "1", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: PASSWORD_API_PATH,
        maxAge: 10 * 60,
      });
    }
  }

  const destinationUrl = new URL(destination, redirectOrigin);
  if (passwordFlow && destinationUrl.pathname === "/mot-de-passe") destinationUrl.searchParams.set("flow", passwordFlow);
  const response = NextResponse.redirect(destinationUrl);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
