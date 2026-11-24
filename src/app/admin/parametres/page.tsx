import type { Metadata } from "next";
import { getSignedInUser } from "@/lib/auth";
import { setFormerMembersVisibilityAction, setFinancialReceiptThresholdAction } from "@/app/admin/actions";

export const metadata: Metadata = { title: "Paramètres de l’administration" };
type Props = { searchParams: Promise<{ statut?: string; erreur?: string }> };

export default async function AdminSettingsPage({ searchParams }: Props) {
  const { supabase, roles } = await getSignedInUser();
  if (!supabase || !roles.includes("super_admin")) return null;
  const [{ data: visibilitySetting }, { data: receiptSetting }, params] = await Promise.all([
    supabase.from("settings").select("key,value").eq("key", "former_members_visibility").maybeSingle(),
    supabase.from("settings").select("key,value").eq("key", "financial_receipt_required_threshold_fcfa").maybeSingle(),
    searchParams,
  ]);
  const isVisible = visibilitySetting?.value === true || visibilitySetting?.value?.enabled === true;
  const thresholdValue = receiptSetting?.value && typeof receiptSetting.value === "object" ? receiptSetting.value.thresholdFcfa : null;
  const receiptThreshold = typeof thresholdValue === "number" && thresholdValue > 0 ? thresholdValue : null;
  const successMessage = params.statut === "archives-visibles"
    ? "Les archives sont maintenant visibles pour les membres connectés."
    : params.statut === "archives-masquees"
      ? "Les archives restent réservées aux responsables autorisés."
      : params.statut === "seuil-justificatif-enregistre"
        ? "Le seuil des justificatifs obligatoires a été enregistré."
      : "";
  return <><div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CONFIGURATION</div><h1>Paramètres</h1><p>Réglages de visibilité et de justificatifs ADEIO.</p></div></div><div className="admin-card"><h2>Visibilité des anciens membres</h2><p>Ce réglage contrôle si les membres connectés peuvent consulter les anciens membres dans l’annuaire et les archives. Les responsables habilités conservent leur accès.</p><p>État actuel : <span className="status-chip">{isVisible ? "Visibles aux membres" : "Réservés aux responsables autorisés"}</span></p>{successMessage && <p role="status" className="form-success">{successMessage}</p>}{params.erreur && <p role="alert" className="form-error">{params.erreur === "reglage-invalide" || params.erreur === "seuil-invalide" ? "La valeur saisie n’est pas valide." : "Le réglage n’a pas pu être enregistré. Réessayez."}</p>}<form action={setFormerMembersVisibilityAction} className="admin-setting-form"><input type="hidden" name="visible" value={String(!isVisible)} /><button className="admin-submit" type="submit">{isVisible ? "Réserver les archives aux responsables" : "Rendre les archives visibles aux membres"}</button><span>Le changement est enregistré dans Supabase et appliqué par les règles d’accès de la base.</span></form></div><div className="admin-card"><h2>Justificatif obligatoire au-dessus d’un montant</h2><p>Par défaut, un justificatif reste facultatif. Saisissez un montant pour l’imposer aux opérations dont le montant est supérieur à ce seuil.</p><form action={setFinancialReceiptThresholdAction} className="admin-setting-form"><label htmlFor="receipt-threshold">Seuil en FCFA (laisser vide pour désactiver)</label><input id="receipt-threshold" name="threshold_fcfa" type="number" min="1" max="1000000000000" step="1" placeholder="Ex. 100 000" defaultValue={receiptThreshold ?? ""} /><button className="admin-submit" type="submit">Enregistrer le seuil</button><span>Réglage actuel : {receiptThreshold ? `${receiptThreshold.toLocaleString("fr-FR")} FCFA` : "aucun seuil, justificatif facultatif"}.</span></form></div><div className="admin-card"><h2>Comptes à privilèges</h2><p>La gestion des rôles se fait dans Supabase Auth et via les fonctions protégées de la base de données. Aucun formulaire côté navigateur ne peut s’attribuer un rôle.</p></div></>;
}
