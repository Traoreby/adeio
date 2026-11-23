"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/redirect";
import type { AppRole } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  next: z.string().max(2048).optional(),
});

export type LoginActionResult = { error?: string };

export async function loginMemberAction(input: unknown): Promise<LoginActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { error: "Saisissez une adresse e-mail et un mot de passe valides." };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "La connexion est momentanément indisponible. Réessayez plus tard." };

  const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error || !data.user) return { error: "Adresse e-mail ou mot de passe incorrect." };

  const [profileResult, roleResult] = await Promise.all([
    supabase.from("profiles").select("mfa_enabled,must_change_password").eq("user_id", data.user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", data.user.id),
  ]);
  const roles = (roleResult.data ?? []).map((item) => item.role as AppRole);
  const isAdmin = roles.some((role) => role === "admin" || role === "super_admin");
  const destination = safeRedirectPath(parsed.data.next ?? null, "https://adeio.invalid", isAdmin ? "/admin" : "/espace-membre");

  if (profileResult.data?.must_change_password) redirect("/mot-de-passe");
  if (profileResult.data?.mfa_enabled) {
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) return { error: "La vérification de sécurité est momentanément indisponible." };
    if (assurance?.currentLevel !== "aal2" && assurance?.nextLevel === "aal2") {
      redirect(`/auth/mfa?next=${encodeURIComponent(destination)}`);
    }
  }

  redirect(destination);
}
