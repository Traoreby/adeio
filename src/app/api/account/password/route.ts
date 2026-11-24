import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { safeRedirectPath } from "@/lib/redirect";

const passwordSchema = z.object({
  password: z.string().min(10, "Utilisez au moins 10 caractères.").max(128),
  next: z.string().max(2048).optional(),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    return NextResponse.json({ error: "Origine de requête invalide." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Format de requête invalide." }, { status: 415 });
  }
  const payload = await request.json().catch(() => null);
  const parsed = passwordSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Mot de passe invalide." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Service non configuré." }, { status: 503 });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Session expirée. Reconnectez-vous." }, { status: 401 });

  const [{ data: roleRows, error: rolesError }, serviceClient] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    Promise.resolve(createSupabaseServiceClient()),
  ]);
  if (rolesError || !roleRows?.length) return NextResponse.json({ error: "Le rôle de ce compte n’a pas pu être vérifié. Contactez l’administration." }, { status: 503 });
  if (!serviceClient) return NextResponse.json({ error: "La finalisation sécurisée du compte est momentanément indisponible." }, { status: 503 });

  const roles = roleRows.map((row) => row.role);
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
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { error: profileError } = await serviceClient.from("profiles").update({ must_change_password: false }).eq("user_id", user.id);
  if (profileError) return NextResponse.json({ error: "Le mot de passe a été mis à jour, mais la finalisation du compte a échoué. Réessayez ou contactez l’administration." }, { status: 503 });
  return NextResponse.json({ ok: true, redirectTo }, { headers: { "Cache-Control": "no-store" } });
}
