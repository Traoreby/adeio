import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { safeRedirectPath } from "@/lib/redirect";

const passwordSchema = z.object({
  password: z.string().min(10, "Utilisez au moins 10 caractères.").max(128),
  next: z.string().max(2048).optional(),
});
const RECOVERY_COOKIE = "adeio-password-recovery";
const PASSWORD_API_PATH = "/api/account/password";

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    return errorResponse("Origine de requête invalide.", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return errorResponse("Format de requête invalide.", 415);
  }
  const payload = await request.json().catch(() => null);
  const parsed = passwordSchema.safeParse(payload);
  if (!parsed.success) return errorResponse("Mot de passe invalide.", 400);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return errorResponse("Service non configuré.", 503);
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) return errorResponse("La session n’a pas pu être vérifiée. Réessayez ou demandez un nouveau lien de récupération.", 503);
  if (!user) return errorResponse("La session de récupération est absente ou expirée. Demandez un nouveau lien.", 401);

  const cookieStore = await cookies();
  const isRecoverySession = cookieStore.get(RECOVERY_COOKIE)?.value === "1";
  const [roleResult, profileResult] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.from("profiles").select("must_change_password").eq("user_id", user.id).maybeSingle(),
  ]);
  if (roleResult.error || !roleResult.data?.length) return errorResponse("Le rôle de ce compte n’a pas pu être vérifié. Contactez l’administration.", 503);
  if (profileResult.error || !profileResult.data) return errorResponse("Le profil de ce compte n’a pas pu être vérifié. Contactez l’administration.", 503);
  if (!isRecoverySession && !profileResult.data.must_change_password) {
    return errorResponse("Cette session ne provient pas d’une récupération de mot de passe. Connectez-vous et demandez un nouveau lien si nécessaire.", 403);
  }
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) return errorResponse("La finalisation sécurisée du compte est momentanément indisponible.", 503);

  const roles = roleResult.data.map((row) => row.role);
  const isAdmin = roles.includes("admin") || roles.includes("super_admin");
  const fallback = isAdmin ? "/admin" : "/espace-membre";
  let redirectTo = safeRedirectPath(parsed.data.next ?? null, request.url, fallback);
  const destinationPath = new URL(redirectTo, request.url).pathname;
  if (destinationPath === "/connexion" || destinationPath === "/mot-de-passe" || destinationPath.startsWith("/auth/") || (!isAdmin && destinationPath.startsWith("/admin"))) {
    redirectTo = fallback;
  }

  const { error: passwordError } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (passwordError) {
    const errorCode = "code" in passwordError ? passwordError.code : "";
    const message = errorCode === "same_password"
      ? "Choisissez un mot de passe différent de celui que vous utilisez actuellement."
      : errorCode === "weak_password"
        ? "Choisissez un mot de passe plus robuste, d’au moins 10 caractères."
        : "Le mot de passe n’a pas pu être modifié. Réessayez ou demandez un nouveau lien si votre session a expiré.";
    return errorResponse(message, 400);
  }

  const { error: profileError } = await serviceClient.from("profiles").update({ must_change_password: false }).eq("user_id", user.id);
  if (profileError) return errorResponse("Le mot de passe a été mis à jour, mais la finalisation du compte a échoué. Contactez l’administration.", 503);

  cookieStore.set(RECOVERY_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: PASSWORD_API_PATH,
    maxAge: 0,
  });
  return NextResponse.json({ ok: true, redirectTo }, { headers: { "Cache-Control": "no-store" } });
}
