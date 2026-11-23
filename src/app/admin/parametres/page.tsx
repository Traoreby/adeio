import type { Metadata } from "next";
import { getSignedInUser } from "@/lib/auth";
import { setFormerMembersVisibilityAction } from "@/app/admin/actions";

export const metadata: Metadata = { title: "Paramètres de l’administration" };
type Props = { searchParams: Promise<{ statut?: string; erreur?: string }> };

export default async function AdminSettingsPage({ searchParams }: Props) {
  const { supabase, roles } = await getSignedInUser();
  if (!supabase || !roles.includes("super_admin")) return null;
  const [{ data }, params] = await Promise.all([
    supabase.from("settings").select("key,value").eq("key", "former_members_visibility").maybeSingle(),
    searchParams,
  ]);
  const isVisible = data?.value === true || data?.value?.enabled === true;
  const successMessage = params.statut === "archives-visibles"
    ? "Les archives sont maintenant visibles pour les membres connectés."
    : params.statut === "archives-masquees"
      ? "Les archives restent réservées aux responsables autorisés."
      : "";
  return <><div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CONFIGURATION</div><h1>Paramètres</h1><p>Réglages de visibilité de la plateforme ADEIO.</p></div></div><div className="admin-card"><h2>Visibilité des anciens membres</h2><p>Ce réglage contrôle si les membres connectés peuvent consulter les anciens membres dans l’annuaire et les archives. Les responsables habilités conservent leur accès.</p><p>État actuel : <span className="status-chip">{isVisible ? "Visibles aux membres" : "Réservés aux responsables autorisés"}</span></p>{successMessage && <p role="status" className="form-success">{successMessage}</p>}{params.erreur && <p role="alert" className="form-error">{params.erreur === "reglage-invalide" ? "Le choix envoyé n’est pas valide." : "Le réglage n’a pas pu être enregistré. Réessayez."}</p>}<form action={setFormerMembersVisibilityAction} className="admin-setting-form"><input type="hidden" name="visible" value={String(!isVisible)} /><button className="admin-submit" type="submit">{isVisible ? "Réserver les archives aux responsables" : "Rendre les archives visibles aux membres"}</button><span>Le changement est enregistré dans Supabase et appliqué par les règles d’accès de la base.</span></form></div><div className="admin-card"><h2>Comptes à privilèges</h2><p>La gestion des rôles se fait dans Supabase Auth et via les fonctions protégées de la base de données. Aucun formulaire côté navigateur ne peut s’attribuer un rôle.</p></div></>;
}
