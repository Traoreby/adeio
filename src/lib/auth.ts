import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AppRole = "member" | "treasurer" | "auditor" | "admin" | "super_admin";

export async function hasRequiredMfa(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>, userId: string) {
  const { data: profile } = await supabase.from("profiles").select("mfa_enabled").eq("user_id", userId).maybeSingle();
  if (!profile?.mfa_enabled) return true;
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return !error && data?.currentLevel === "aal2";
}

export async function getSignedInUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { supabase: null, user: null, roles: [] as AppRole[] };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, roles: [] as AppRole[] };

  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  return {
    supabase,
    user,
    roles: (data ?? []).map((item) => item.role as AppRole),
  };
}

export async function requireAdmin() {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase) return { supabase: null, user: null, roles: [] as AppRole[] };
  if (!user) redirect("/connexion?next=/admin");
  if (!roles.some((role) => role === "admin" || role === "super_admin")) {
    redirect("/espace-membre?erreur=acces-refuse");
  }
  return { supabase, user, roles };
}

export async function requireStaff() {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase) return { supabase: null, user: null, roles: [] as AppRole[] };
  if (!user) redirect("/connexion?next=/admin");
  if (!roles.some((role) => ["treasurer", "auditor", "admin", "super_admin"].includes(role))) {
    redirect("/espace-membre?erreur=acces-refuse");
  }
  return { supabase, user, roles };
}
