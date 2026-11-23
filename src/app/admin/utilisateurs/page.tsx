import type { Metadata } from "next";
import { AlertTriangle, MailPlus, ShieldCheck, UserCog } from "lucide-react";
import { redirect } from "next/navigation";
import { assignUserRoleAction, inviteMemberAccountAction, removeUserRoleAction } from "@/app/admin/actions";
import { getSignedInUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Utilisateurs et rôles" };

type PageProps = { searchParams: Promise<{ statut?: string; erreur?: string; page?: string }> };
const messages: Record<string, string> = {
  "invitation-envoyee": "L’invitation a été envoyée.",
  "role-attribue": "Le rôle a été attribué.",
  "role-existant": "Ce compte possède déjà ce rôle.",
  "role-retire": "Le rôle a été retiré.",
};
const errors: Record<string, string> = {
  "formulaire-invalide": "Vérifiez les informations saisies.",
  "cle-serveur-manquante": "La variable serveur SUPABASE_SECRET_KEY doit être configurée pour envoyer des invitations.",
  "url-site-manquante": "Configurez NEXT_PUBLIC_SITE_URL pour envoyer des invitations.",
  "email-deja-utilise": "Cette adresse e-mail est déjà associée à un compte.",
  "invitation-impossible": "L’invitation n’a pas pu être envoyée.",
  "role-impossible": "La modification du rôle n’a pas abouti.",
  "dernier-super-admin": "Au moins un super-administrateur doit rester actif.",
};
const rolesList = ["member", "treasurer", "auditor", "admin", "super_admin"] as const;
const roleLabels: Record<(typeof rolesList)[number], string> = { member: "Membre", treasurer: "Trésorier", auditor: "Commissaire aux comptes", admin: "Administrateur", super_admin: "Super-administrateur" };

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const [{ supabase, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
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
    <div className="admin-card"><h2><MailPlus size={16} /> Inviter un membre</h2><p>Seuls les comptes invités peuvent accéder à la plateforme. Les invitations créent un compte avec le rôle « Membre ».</p><form action={inviteMemberAccountAction} className="admin-form"><div className="admin-form-grid"><div><label htmlFor="invite-display-name">Nom affiché</label><input id="invite-display-name" name="display_name" required minLength={2} maxLength={120} placeholder="Nom et prénoms" /></div><div><label htmlFor="invite-email">Adresse e-mail</label><input id="invite-email" name="email" type="email" required maxLength={254} placeholder="Adresse e-mail du membre" /></div></div><Button type="submit" className="admin-submit" disabled={!serviceClient}>Envoyer l’invitation <MailPlus size={15} /></Button></form></div>
    <div className="admin-card"><h2><ShieldCheck size={16} /> Comptes enregistrés</h2><p>Les rôles Trésorier et Commissaire donnent accès aux données financières individuelles. Le rôle Président n’ajoute aucun accès aux arriérés. Lorsqu’un compte sensible active le MFA, la base impose le niveau AAL2.</p><div className="admin-list">{authUsers.length ? authUsers.map((account) => { const userRoles = rolesByUser.get(account.id) ?? []; const profile = profileByUser.get(account.id); const accountLabel = account.email ?? profile?.display_name ?? account.id; return <div className="user-admin-row" key={account.id}><div className="user-admin-identity"><span className="user-admin-avatar"><UserCog size={15} /></span><div><strong>{profile?.display_name || account.email || "Compte ADEIO"}</strong><small>{account.email ? `${account.email} · ` : "Compte Supabase · "}{profile?.must_change_password ? "Premier mot de passe à changer" : profile?.mfa_enabled ? "MFA activé" : "MFA désactivé"}</small></div></div><div className="user-role-list">{userRoles.map((role) => <div className="user-role-chip" key={role}><span>{roleLabels[role as keyof typeof roleLabels] ?? role}</span><form action={removeUserRoleAction}><input type="hidden" name="user_id" value={account.id} /><input type="hidden" name="role" value={role} /><button type="submit" aria-label={`Retirer le rôle ${roleLabels[role as keyof typeof roleLabels] ?? role}`}>×</button></form></div>)}</div><form action={assignUserRoleAction} className="inline-role-form"><input type="hidden" name="user_id" value={account.id} /><select name="role" aria-label={`Ajouter un rôle à ${accountLabel}`} defaultValue="member">{rolesList.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select><button type="submit">Ajouter</button></form></div>; }) : <div className="admin-empty">Aucun compte trouvé sur cette page.</div>}</div>{page > 1 || hasNextPage ? <div className="admin-pagination">{page > 1 ? <a href={`/admin/utilisateurs?page=${page - 1}`}>Page précédente</a> : <span />}{hasNextPage && <a href={`/admin/utilisateurs?page=${page + 1}`}>Page suivante</a>}</div> : null}</div>
    <div className="admin-card"><h2>Règles de sécurité</h2><ul className="admin-security-list"><li>Les arriérés sont accessibles uniquement au membre concerné, au trésorier, au commissaire aux comptes et au super-administrateur.</li><li>Les administrateurs n’ont pas accès aux arriérés individuels.</li><li>La fonction Président n’est pas un rôle d’accès aux données financières.</li><li>Le dernier rôle super-administrateur ne peut pas être retiré.</li></ul></div>
  </>;
}
