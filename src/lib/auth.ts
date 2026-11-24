import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AppRole = "member" | "treasurer" | "auditor" | "admin" | "super_admin";

const getUserRoles = cache(async (userId: string) => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [] as AppRole[];
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((item) => item.role as AppRole);
});

export const getHeaderSession = cache(async function getHeaderSession() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { user: null, roles: [] as AppRole[] };

  // This session snapshot is only used to render the header. Protected data and
  // routes still verify the user with getUser() and database RLS.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  const roles = user ? await getUserRoles(user.id) : [];
  return { user, roles };
});

export async function hasRequiredMfa(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  userId: string,
  mfaEnabled?: boolean,
) {
  const enabled = mfaEnabled ?? (await supabase.from("profiles").select("mfa_enabled").eq("user_id", userId).maybeSingle()).data?.mfa_enabled;
  if (!enabled) return true;
  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return !assuranceError && assurance?.currentLevel === "aal2";
}

export const getSignedInUser = cache(async function getSignedInUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { supabase: null, user: null, roles: [] as AppRole[] };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, roles: [] as AppRole[] };

  const roles = await getUserRoles(user.id);

  return {
    supabase,
    user,
    roles,
  };
});

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
