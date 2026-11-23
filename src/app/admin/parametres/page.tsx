import type { Metadata } from "next";
import { getSignedInUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Paramètres de l’administration" };

export default async function AdminSettingsPage() {
  const { supabase, roles } = await getSignedInUser();
  if (!supabase || !roles.includes("super_admin")) return null;
  const { data } = await supabase.from("settings").select("key,value").eq("key", "former_members_visibility").maybeSingle();
  const isVisible = data?.value === true || data?.value?.enabled === true;
  return <><div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CONFIGURATION</div><h1>Paramètres</h1><p>Réglages de visibilité de la plateforme ADEIO.</p></div></div><div className="admin-card"><h2>Visibilité des anciens membres</h2><p>Par défaut, les archives des anciens membres sont réservées aux membres connectés. Ce réglage est appliqué aux pages d’annuaire et d’archives.</p><p>État actuel : <span className="status-chip">{isVisible ? "Visibles aux membres" : "Réservés aux membres connectés"}</span></p><div className="admin-banner">La modification du réglage continue de se faire via le paramètre `former_members_visibility` de Supabase. Une commande dédiée sera disponible ultérieurement.</div></div><div className="admin-card"><h2>Comptes à privilèges</h2><p>La gestion des rôles se fait dans Supabase Auth et via les fonctions protégées de la base de données. Aucun formulaire côté navigateur ne peut s’attribuer un rôle.</p></div></>;
}
