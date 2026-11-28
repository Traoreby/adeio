import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { setFormerMembersVisibilityAction, setFinancialReceiptThresholdAction } from "@/app/admin/actions";

export const metadata: Metadata = { title: "Paramètres de l’administration" };
type Props = { searchParams: Promise<{ statut?: string; erreur?: string }> };

export default async function AdminSettingsPage({ searchParams }: Props) {
  const { supabase, roles } = await getSignedInUser();
  if (!supabase || !roles.includes("super_admin")) return null;
  const [{ data: visibilitySetting }, { data: receiptSetting }, { count: incompleteActiveCount }, params] = await Promise.all([
    supabase.from("settings").select("key,value").eq("key", "former_members_visibility").maybeSingle(),
    supabase.from("settings").select("key,value").eq("key", "financial_receipt_required_threshold_inr").maybeSingle(),
    supabase.from("members").select("id", { count: "exact", head: true }).eq("status", "active").is("exit_year", null),
    searchParams,
  ]);
  const isVisible = visibilitySetting?.value === true || visibilitySetting?.value?.enabled === true;
  const thresholdValue = receiptSetting?.value && typeof receiptSetting.value === "object" ? receiptSetting.value.thresholdInr : null;
  const receiptThreshold = typeof thresholdValue === "number" && thresholdValue > 0 ? thresholdValue : null;
  const successMessage = params.statut === "archives-visibles"
    ? "Les archives sont maintenant visibles pour les membres connectés."
    : params.statut === "archives-masquees"
      ? "Les archives restent réservées aux responsables autorisés."
      : params.statut === "seuil-justificatif-enregistre"
        ? "Le seuil des justificatifs obligatoires a été enregistré."
      : "";
  return <><div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CONFIGURATION</div><h1>Paramètres</h1><p>Réglages de visibilité, d’archivage et de justificatifs ADEIO.</p></div></div>{successMessage && <p role="status" className="form-success">{successMessage}</p>}<div className="admin-card"><h2>Carte de membre</h2><p>Configurez la signature et le cachet officiels, puis prévisualisez leurs versions actives. Les anciennes versions restent conservées pour les cartes délivrées.</p><Link href="/admin/parametres/carte-membre" className="text-link">Configurer la carte de membre <ArrowRight size={15} /></Link></div><div className="admin-card"><h2>Archivage selon l’année de fin de cycle</h2><p>Les accès réservés aux membres actifs s’arrêtent immédiatement après le 31 décembre de l’année de fin de cycle. Le traitement automatique archive ensuite le dossier et clôt sa période. La réactivation reste toujours une action manuelle de l’administration.</p><p>État actuel : <span className="status-chip">Règle appliquée automatiquement</span></p>{typeof incompleteActiveCount === "number" && incompleteActiveCount > 0 && <p role="status">{incompleteActiveCount} fiche(s) active(s) sans année de fin de cycle et donc sans accès actif.</p>}<p className="admin-form-note">Cette règle métier ne peut pas être suspendue. Les comptes archivés ne sont jamais réactivés automatiquement.</p></div><div className="admin-card"><h2>Visibilité des anciens membres</h2><p>Ce réglage contrôle si les membres connectés peuvent consulter les anciens membres dans l’annuaire et les archives. Les responsables habilités conservent leur accès.</p><p>État actuel : <span className="status-chip">{isVisible ? "Visibles aux membres" : "Réservés aux responsables autorisés"}</span></p><form action={setFormerMembersVisibilityAction} className="admin-setting-form"><input type="hidden" name="visible" value={String(!isVisible)} /><button className="admin-submit" type="submit">{isVisible ? "Réserver les archives aux responsables" : "Rendre les archives visibles aux membres"}</button><span>Le changement est enregistré dans Supabase et appliqué par les règles d’accès de la base.</span></form></div><div className="admin-card"><h2>Justificatif obligatoire au-dessus d’un montant</h2><p>Par défaut, un justificatif reste facultatif. Saisissez un montant pour l’imposer aux opérations dont le montant est supérieur à ce seuil.</p><form action={setFinancialReceiptThresholdAction} className="admin-setting-form"><label htmlFor="receipt-threshold">Seuil en INR (laisser vide pour désactiver)</label><input id="receipt-threshold" name="threshold_inr" type="number" min="1" max="1000000000000" step="1" placeholder="Ex. 5 000" defaultValue={receiptThreshold ?? ""} /><button className="admin-submit" type="submit">Enregistrer le seuil</button><span>Réglage actuel : {receiptThreshold ? `₹${receiptThreshold.toLocaleString("en-IN")}` : "aucun seuil, justificatif facultatif"}.</span></form></div><div className="admin-card"><h2>Comptes à privilèges</h2><p>La gestion des rôles se fait dans Supabase Auth et via les fonctions protégées de la base de données. Aucun formulaire côté navigateur ne peut s’attribuer un rôle.</p></div></>;
}
