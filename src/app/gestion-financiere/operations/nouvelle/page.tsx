import Link from "next/link";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { createFinancialTransactionAction } from "@/app/gestion-financiere/actions";
import { FinanceSubmitButton } from "@/components/finance-submit-button";

type Props = { searchParams: Promise<{ erreur?: string }> };

export default async function NewFinancialTransactionPage({ searchParams }: Props) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const [{ data: categories }, { data: recentTransactions }] = await Promise.all([
    supabase.from("transaction_categories").select("id,name,direction").eq("is_active", true).order("direction").order("name"),
    supabase.from("financial_transactions").select("id,occurred_on,direction,label,amount_fcfa").eq("is_published", true).order("occurred_on", { ascending: false }).limit(100),
  ]);
  const errors: Record<string, string> = {
    "formulaire-invalide": "Vérifiez la date, le libellé, le montant et le moyen de paiement.",
    "categorie-invalide": "La catégorie choisie ne correspond pas à la nature de l’opération.",
    "correction-invalide": "Une correction doit être liée à une opération publiée de sens opposé.",
    "justificatif-invalide": "Joignez un justificatif PDF, JPG ou PNG de 10 Mo maximum.",
    "enregistrement-impossible": "L’opération n’a pas pu être enregistrée.",
    "justificatif-impossible": "Le justificatif n’a pas pu être enregistré ; l’écriture provisoire a été annulée.",
    "publication-impossible": "La publication a échoué ; l’écriture provisoire a été annulée.",
  };
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">NOUVELLE ÉCRITURE</div><h1>Saisir une opération</h1><p>Une opération est publiée dès validation et devient immuable.</p></div><Link href="/gestion-financiere/operations" className="text-link"><ArrowLeft size={15} /> Historique</Link></div>
    {params.erreur && errors[params.erreur] && <div role="alert" className="form-error finance-alert">{errors[params.erreur]}</div>}
    <div className="admin-card"><h2><FilePlus2 size={16} /> Détails de l’opération</h2><form action={createFinancialTransactionAction} className="admin-form finance-form">
      <div className="admin-form-grid"><div><label htmlFor="occurred_on">Date de l’opération</label><input id="occurred_on" name="occurred_on" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div><div><label htmlFor="direction">Nature</label><select id="direction" name="direction" required defaultValue="income"><option value="income">Recette</option><option value="expense">Dépense</option></select></div></div>
      <div><label htmlFor="category_id">Catégorie</label><select id="category_id" name="category_id" required defaultValue=""><option value="" disabled>Choisir une catégorie</option><optgroup label="Recettes">{categories?.filter((category) => category.direction === "income").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</optgroup><optgroup label="Dépenses">{categories?.filter((category) => category.direction === "expense").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</optgroup></select><small>Choisissez une catégorie du même type que l’opération.</small></div>
      <div><label htmlFor="label">Libellé</label><input id="label" name="label" required minLength={3} maxLength={180} placeholder="Ex. Frais de location de salle" /></div>
      <div className="admin-form-grid"><div><label htmlFor="amount_fcfa">Montant (FCFA)</label><input id="amount_fcfa" name="amount_fcfa" type="number" min="1" max="1000000000000" step="1" required inputMode="numeric" /></div><div><label htmlFor="payment_method">Moyen de paiement</label><select id="payment_method" name="payment_method" required defaultValue="cash"><option value="cash">Espèces</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Virement</option><option value="other">Autre</option></select></div></div>
      <div><label htmlFor="correction_of">Écriture corrigée (facultatif)</label><select id="correction_of" name="correction_of" defaultValue=""><option value="">Aucune, écriture normale</option>{recentTransactions?.map((transaction) => <option key={transaction.id} value={transaction.id}>{transaction.occurred_on} · {transaction.direction === "income" ? "Recette" : "Dépense"} · {transaction.label} · {transaction.amount_fcfa.toLocaleString("fr-FR")} FCFA</option>)}</select><small>Pour rectifier une publication, choisissez l’écriture d’origine et saisissez le sens opposé.</small></div>
      <div><label htmlFor="attachment">Justificatif (facultatif)</label><input id="attachment" name="attachment" type="file" accept="application/pdf,image/jpeg,image/png" /><small>PDF, JPG ou PNG · 10 Mo maximum · fichier stocké en privé.</small></div>
      <div className="admin-banner">Après validation, l’écriture sera immédiatement visible aux membres. Les corrections et annulations se font par une nouvelle écriture tracée.</div>
      <FinanceSubmitButton pendingLabel="Publication…">Publier l’opération</FinanceSubmitButton>
    </form></div>
  </>;
}
