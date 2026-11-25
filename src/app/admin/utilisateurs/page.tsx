import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ShieldCheck, UserCog } from "lucide-react";
import { redirect } from "next/navigation";
import { assignUserRoleAction, removeUserRoleAction, resendMemberAccessEmailAction } from "@/app/admin/actions";
import { getSignedInUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminEmailChange } from "@/components/admin-email-change";

export const metadata: Metadata = { title: "Utilisateurs et rôles" };

type PageProps = { searchParams: Promise<{ statut?: string; erreur?: string; page?: string }> };
const messages: Record<string, string> = {
  "invitation-envoyee": "L’invitation a été envoyée.",
  "role-attribue": "Le rôle a été attribué.",
  "role-existant": "Ce compte possède déjà ce rôle.",
  "role-retire": "Le rôle a été retiré.",
  "email-acces-renvoye": "Les instructions ont été renvoyées au compte existant.",
  "changement-email-demarre": "Les demandes de confirmation ont été envoyées aux deux adresses. L’adresse du compte ne changera qu’après les confirmations Supabase.",
};
const errors: Record<string, string> = {
  "formulaire-invalide": "Vérifiez les informations saisies.",
  "cle-serveur-manquante": "La variable serveur SUPABASE_SECRET_KEY doit être configurée pour envoyer des invitations.",
  "email-deja-utilise": "Cette adresse e-mail est déjà associée à un compte.",
  "invitation-impossible": "L’invitation n’a pas pu être envoyée.",
  "role-impossible": "La modification du rôle n’a pas abouti.",
  "dernier-super-admin": "Au moins un super-administrateur doit rester actif.",
  "dossier-invitation-impossible": "Le compte a été invité, mais son dossier d’adhésion n’a pas pu être créé. Ne renvoyez pas une nouvelle invitation ; contactez le Super Admin pour associer le compte existant.",
  "compte-introuvable": "Le compte ciblé est introuvable.",
  "compte-email-introuvable": "Aucune adresse e-mail Auth vérifiée n’est associée à ce compte.",
  "service-serveur-manquant": "Le service serveur Supabase doit être configuré.",
  "url-site-manquante": "Configurez NEXT_PUBLIC_SITE_URL pour envoyer les e-mails Supabase.",
  "envoi-email-impossible": "L’e-mail n’a pas pu être envoyé. Vérifiez la configuration et les limites d’envoi Supabase.",
  "email-identique": "Cette adresse est déjà celle du compte.",
  "email-provider-manquant": "L’envoi sécurisé n’est pas configuré. Ajoutez RESEND_API_KEY et ADEIO_AUTH_FROM_EMAIL aux variables serveur Vercel avant de relancer la demande.",
  "envoi-confirmation-impossible": "Un e-mail de confirmation n’a pas pu être envoyé. Aucune adresse Auth n’a été modifiée. Vérifiez l’expéditeur et réessayez.",
  "confirmation-supabase-impossible": "Supabase n’a pas pu préparer les liens. Vérifiez que la double confirmation des changements d’e-mail est activée.",
  "changement-email-impossible": "Le changement d’adresse n’a pas pu être lancé. L’adresse peut déjà appartenir à un autre compte.",
  "utilisez-profil-securite": "Pour modifier votre propre adresse, utilisez les réglages de sécurité du compte.",
};
const rolesList = ["member", "treasurer", "auditor", "admin", "super_admin"] as const;
const roleLabels: Record<(typeof rolesList)[number], string> = { member: "Membre", treasurer: "Trésorier", auditor: "Commissaire aux comptes", admin: "Administrateur", super_admin: "Super-administrateur" };

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const [{ supabase, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const canManageRoles = roles.includes("super_admin");
  const page = Math.max(1, Math.min(100, Number.parseInt(params.page ?? "1", 10) || 1));
  const [{ data: roleRows }, { data: profiles }, serviceClient] = await Promise.all([
    supabase.from("user_roles").select("user_id,role,created_at"),
    supabase.from("profiles").select("user_id,display_name,must_change_password,mfa_enabled,created_at").order("created_at", { ascending: false }),
    Promise.resolve(createSupabaseServiceClient()),
  ]);
  let authUsers: { id: string; email?: string; last_sign_in_at?: string }[] = [];
  let hasNextPage = false;
  if (serviceClient) {
    const { data } = await serviceClient.auth.admin.listUsers({ page, perPage: 50 });
    authUsers = data?.users ?? [];
    hasNextPage = authUsers.length === 50;
  } else {
    authUsers = (profiles ?? []).map((profile) => ({ id: profile.user_id }));
  }
  const rolesByUser = new Map<string, string[]>();
  for (const item of roleRows ?? []) rolesByUser.set(item.user_id, [...(rolesByUser.get(item.user_id) ?? []), item.role]);
  const profileByUser = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">ACCÈS ET SÉCURITÉ</div><h1>Utilisateurs et rôles</h1><p>Les droits sensibles sont gérés par rôle et contrôlés aussi par PostgreSQL.</p></div><span className="admin-heading-mark"><UserCog size={18} /></span></div>
    {params.statut && messages[params.statut] && <div role="status" className="form-alert success-alert admin-banner">{messages[params.statut]}</div>}
    {params.erreur && <div role="alert" className="form-alert error-alert admin-banner">{errors[params.erreur] ?? "Une erreur est survenue."}</div>}
    {!serviceClient && <div className="admin-banner"><AlertTriangle size={14} /> Les invitations nécessitent la variable serveur SUPABASE_SECRET_KEY. Les comptes existants restent visibles par leur nom et leur identifiant interne.</div>}
    <div className="admin-banner">La création d’un membre (compte, fiche et invitation) se fait désormais dans <Link href="/admin/membres/nouveau">Membres → Ajouter un membre</Link>. Cette page reste réservée à la gestion des rôles, au renvoi des instructions et à l’administration des comptes existants.</div>
    <div className="admin-card"><h2><ShieldCheck size={16} /> Comptes enregistrés</h2><p>Les rôles Trésorier et Commissaire donnent accès aux données financières individuelles. Le rôle Président n’ajoute aucun accès aux arriérés. Lorsqu’un compte sensible active le MFA, la base impose le niveau AAL2.</p><div className="admin-list">{authUsers.length ? authUsers.map((account) => { const userRoles = rolesByUser.get(account.id) ?? []; const profile = profileByUser.get(account.id); const accountLabel = account.email ?? profile?.display_name ?? account.id; return <div className="user-admin-row" key={account.id}><div className="user-admin-identity"><span className="user-admin-avatar"><UserCog size={15} /></span><div><strong title={account.email ?? profile?.display_name ?? account.id}>{profile?.display_name || account.email || "Compte ADEIO"}</strong><small title={account.email ?? undefined}>{account.email ? `${account.email} · ` : "Compte Supabase · "}{profile?.must_change_password ? "Premier mot de passe à changer" : profile?.mfa_enabled ? "MFA activé" : "MFA désactivé"}</small></div></div><div className="user-role-list">{userRoles.map((role) => <div className="user-role-chip" key={role}><span>{roleLabels[role as keyof typeof roleLabels] ?? role}</span>{canManageRoles && <form action={removeUserRoleAction}><input type="hidden" name="user_id" value={account.id} /><input type="hidden" name="role" value={role} /><button type="submit" aria-label={`Retirer le rôle ${roleLabels[role as keyof typeof roleLabels] ?? role}`}>×</button></form>}</div>)}</div>{canManageRoles && <form action={assignUserRoleAction} className="inline-role-form"><input type="hidden" name="user_id" value={account.id} /><select name="role" aria-label={`Ajouter un rôle à ${accountLabel}`} defaultValue="member">{rolesList.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select><button type="submit">Ajouter</button></form>}<div className="user-account-actions"><form action={resendMemberAccessEmailAction}><input type="hidden" name="user_id" value={account.id} /><button className="text-action" type="submit">Renvoyer les instructions</button></form>{account.email && <AdminEmailChange userId={account.id} currentEmail={account.email} />}</div></div>; }) : <div className="admin-empty">Aucun compte trouvé sur cette page.</div>}</div>{page > 1 || hasNextPage ? <div className="admin-pagination">{page > 1 ? <a href={`/admin/utilisateurs?page=${page - 1}`}>Page précédente</a> : <span />}{hasNextPage && <a href={`/admin/utilisateurs?page=${page + 1}`}>Page suivante</a>}</div> : null}</div>
    <div className="admin-card"><h2>Règles de sécurité</h2><ul className="admin-security-list"><li>Les arriérés sont accessibles uniquement au membre concerné, au trésorier, au commissaire aux comptes et au super-administrateur.</li><li>Les administrateurs n’ont pas accès aux arriérés individuels.</li><li>La fonction Président n’est pas un rôle d’accès aux données financières.</li><li>Le dernier rôle super-administrateur ne peut pas être retiré.</li></ul></div>
  </>;
}
