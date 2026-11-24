import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { getSignedInProfile, hasRequiredMfa } from "@/lib/auth";
import { FinanceShell } from "@/components/finance-shell";

const financeRoles = ["treasurer", "auditor", "super_admin"];

export default async function FinanceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { supabase, user, roles, profile } = await getSignedInProfile();
  if (!supabase) return <section className="admin-wrap"><div className="container empty-state"><AlertCircle size={25} /><h1>Trésorerie non configurée</h1><p>Le projet Supabase doit être raccordé pour ouvrir la gestion financière.</p><Link className="text-link" href="/">Retour à l’accueil <ArrowLeft size={15} /></Link></div></section>;
  if (!user) redirect("/connexion?next=%2Fgestion-financiere");
  if (!roles.some((role) => financeRoles.includes(role))) redirect("/espace-membre?erreur=acces-refuse");
  if (profile?.must_change_password) redirect("/mot-de-passe?next=%2Fgestion-financiere");
  if (!await hasRequiredMfa(supabase, user.id, profile?.mfa_enabled ?? false)) redirect("/auth/mfa?next=%2Fgestion-financiere");
  return <FinanceShell email={user.email ?? "Compte ADEIO"} roles={roles}>{children}</FinanceShell>;
}
