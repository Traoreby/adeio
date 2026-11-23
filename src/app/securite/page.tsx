import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { MfaSettings } from "@/components/mfa-settings";
import { getSignedInUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Sécurité du compte" };

export default async function AccountSecurityPage() {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Configuration requise</h1><p>Connectez d’abord le projet Supabase de l’association.</p></div></section>;
  if (!user) redirect("/connexion?next=%2Fsecurite");
  if (!roles.some((role) => ["treasurer", "auditor", "admin", "super_admin"].includes(role))) redirect("/espace-membre?erreur=acces-refuse");
  const { data: profile } = await supabase.from("profiles").select("must_change_password").eq("user_id", user.id).maybeSingle();
  if (profile?.must_change_password) redirect("/mot-de-passe");
  return <section className="account-security-page section-pad"><div className="container account-security-container"><div className="page-hero-inline"><span className="empty-state-icon"><ShieldCheck size={25} /></span><div><div className="eyebrow eyebrow-green">SÉCURITÉ DU COMPTE</div><h1>Authentification à deux facteurs</h1><p>Disponible pour les rôles qui administrent les contenus ou les données sensibles.</p></div></div><MfaSettings syncAvailable={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)} /></div></section>;
}
