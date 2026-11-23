import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { AdminShell } from "@/components/admin-shell";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase) return <section className="admin-wrap"><div className="container empty-state"><span className="empty-state-icon"><AlertCircle size={25} /></span><h1>Administration non configurée</h1><p>Ajoutez les paramètres Supabase du projet et appliquez la migration SQL pour activer cet espace.</p><Link className="text-link" href="/">Retour à l’accueil <ArrowLeft size={15} /></Link></div></section>;
  if (!user) redirect("/connexion?next=/admin");
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const { data: profile } = await supabase.from("profiles").select("must_change_password,mfa_enabled").eq("user_id", user.id).maybeSingle();
  if (profile?.must_change_password) redirect("/mot-de-passe");
  if (!await hasRequiredMfa(supabase, user.id, profile?.mfa_enabled ?? false)) redirect("/auth/mfa?next=%2Fadmin");
  return <AdminShell email={user.email ?? "Compte ADEIO"} roles={roles}>{children}</AdminShell>;
}
