import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { enableMemberLifecycleAction, pauseMemberLifecycleAction, setFormerMembersVisibilityAction, setFinancialReceiptThresholdAction } from "@/app/admin/actions";

export const metadata: Metadata = { title: "Paramètres de l’administration" };
type Props = { searchParams: Promise<{ statut?: string; erreur?: string }> };

export default async function AdminSettingsPage({ searchParams }: Props) {
  const { supabase, roles } = await getSignedInUser();
  if (!supabase || !roles.includes("super_admin")) return null;
  const [{ data: visibilitySetting }, { data: receiptSetting }, { data: lifecycleSetting }, { count: incompleteActiveCount }, params] = await Promise.all([
    supabase.from("settings").select("key,value").eq("key", "former_members_visibility").maybeSingle(),
    supabase.from("settings").select("key,value").eq("key", "financial_receipt_required_threshold_fcfa").maybeSingle(),
    supabase.from("settings").select("key,value").eq("key", "member_lifecycle_enforced").maybeSingle(),
    supabase.from("members").select("id", { count: "exact", head: true }).eq("status", "active").is("exit_year", null),
    searchParams,
  ]);
  const isVisible = visibilitySetting?.value === true || visibilitySetting?.value?.enabled === true;
  const thresholdValue = receiptSetting?.value && typeof receiptSetting.value === "object" ? receiptSetting.value.thresholdFcfa : null;
  const receiptThreshold = typeof thresholdValue === "number" && thresholdValue > 0 ? thresholdValue : null;
  const lifecycleEnabled = lifecycleSetting?.value === true || lifecycleSetting?.value?.enabled === true;
  const successMessage = params.statut === "archives-visibles"
    ? "Les archives sont maintenant visibles pour les membres connectés."
    : params.statut === "archives-masquees"
      ? "Les archives restent réservées aux responsables autorisés."
      : params.statut === "seuil-justificatif-enregistre"
        ? "Le seuil des justificatifs obligatoires a été enregistré."
      : params.statut === "archivage-automatique-active"
        ? "La règle est activée : les accès actifs expirent dès l’année de sortie, et l’archivage quotidien mettra à jour les dossiers."
      : params.statut === "archivage-automatique-pause"
        ? "La coupure automatique par année de sortie est suspendue. Les membres déjà archivés restent archivés et ne sont pas réactivés."
      : "";
  const lifecycleError = params.erreur === "annees-sortie-a-corriger"
    ? "Complétez les années de sortie manquantes et corrigez celles qui précèdent l’année d’adhésion avant l’activation."
    : params.erreur === "activation-archivage-impossible" ? "Le réglage n’a pas pu être activé. Vérifiez vos droits et réessayez."
    : null;
  return <><div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CONFIGURATION</div><h1>Paramètres</h1><p>Réglages de visibilité, d’archivage et de justificatifs ADEIO.</p></div></div>{successMessage && <p role="status" className="form-success">{successMessage}</p>}<div className="admin-card"><h2>Carte de membre</h2><p>Configurez la signature et le cachet officiels, puis prévisualisez leurs versions actives. Les anciennes versions restent conservées pour les cartes délivrées.</p><Link href="/admin/parametres/carte-membre" className="text-link">Configurer la carte de membre <ArrowRight size={15} /></Link></div><div className="admin-card"><h2>Archivage selon l’année de sortie</h2><p>Une fois activée, l’année de sortie coupe immédiatement les accès réservés aux membres actifs. Un traitement quotidien bascule ensuite les dossiers expirés dans les archives et clôt leurs périodes. La réactivation restera toujours une action manuelle de l’administration.</p><p>État actuel : <span className="status-chip">{lifecycleEnabled ? "Règle activée" : "Règle en attente de validation"}</span></p>{typeof incompleteActiveCount === "number" && incompleteActiveCount > 0 && <p role="status">{incompleteActiveCount} fiche(s) active(s) sans année de sortie.</p>}{lifecycleError && <p role="alert" className="form-error">{lifecycleError}</p>}{params.erreur && <p role="alert" className="form-error">{params.erreur === "reglage-invalide" || params.erreur === "seuil-invalide" ? "La valeur saisie n’est pas valide." : "Le réglage n’a pas pu être enregistré. Réessayez."}</p>}{!lifecycleEnabled ? <form action={enableMemberLifecycleAction} className="admin-setting-form"><button className="admin-submit" type="submit" disabled={(incompleteActiveCount ?? 0) > 0}>Activer l’archivage automatique</button><span>Action réservée au Super Admin, protégée par MFA. La base bloque aussi l’activation s’il reste des années manquantes ou invalides.</span></form> : <form action={pauseMemberLifecycleAction} className="admin-setting-form"><button className="admin-submit" type="submit">Suspendre la coupure par année de sortie</button><span>Cette action ne réactive aucun membre déjà archivé ; seule une décision de réactivation peut le faire.</span></form>}</div><div className="admin-card"><h2>Visibilité des anciens membres</h2><p>Ce réglage contrôle si les membres connectés peuvent consulter les anciens membres dans l’annuaire et les archives. Les responsables habilités conservent leur accès.</p><p>État actuel : <span className="status-chip">{isVisible ? "Visibles aux membres" : "Réservés aux responsables autorisés"}</span></p><form action={setFormerMembersVisibilityAction} className="admin-setting-form"><input type="hidden" name="visible" value={String(!isVisible)} /><button className="admin-submit" type="submit">{isVisible ? "Réserver les archives aux responsables" : "Rendre les archives visibles aux membres"}</button><span>Le changement est enregistré dans Supabase et appliqué par les règles d’accès de la base.</span></form></div><div className="admin-card"><h2>Justificatif obligatoire au-dessus d’un montant</h2><p>Par défaut, un justificatif reste facultatif. Saisissez un montant pour l’imposer aux opérations dont le montant est supérieur à ce seuil.</p><form action={setFinancialReceiptThresholdAction} className="admin-setting-form"><label htmlFor="receipt-threshold">Seuil en FCFA (laisser vide pour désactiver)</label><input id="receipt-threshold" name="threshold_fcfa" type="number" min="1" max="1000000000000" step="1" placeholder="Ex. 100 000" defaultValue={receiptThreshold ?? ""} /><button className="admin-submit" type="submit">Enregistrer le seuil</button><span>Réglage actuel : {receiptThreshold ? `${receiptThreshold.toLocaleString("fr-FR")} FCFA` : "aucun seuil, justificatif facultatif"}.</span></form></div><div className="admin-card"><h2>Comptes à privilèges</h2><p>La gestion des rôles se fait dans Supabase Auth et via les fonctions protégées de la base de données. Aucun formulaire côté navigateur ne peut s’attribuer un rôle.</p></div></>;
}
