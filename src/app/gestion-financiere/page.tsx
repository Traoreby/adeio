import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, FileBarChart2, Plus, ReceiptText } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { currentFinancialPeriod, financeDirectionLabel, financeMethodLabel, formatFinancialDate, formatInr } from "@/lib/finance";
import { FinanceSubmitButton } from "@/components/finance-submit-button";

type Props = { searchParams: Promise<{ periode?: string }> };

export default async function FinanceDashboardPage({ searchParams }: Props) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const period = ["month", "quarter", "year"].includes(params.periode ?? "") ? params.periode! : "all";
  const { from, to } = currentFinancialPeriod(period);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const [{ data: summaryRows }, { data: arrearsRows }, { data: recent }, { count: memberCount }] = await Promise.all([
    supabase.rpc("get_financial_summary_inr", { p_from: from, p_to: to }),
    supabase.rpc("get_finance_overdue_summary_inr", { p_as_of: today }),
    (() => { let query = supabase.from("financial_transactions").select("id,occurred_on,direction,label,amount_inr,payment_method,transaction_categories(name)").eq("currency_code", "INR").eq("is_published", true).order("occurred_on", { ascending: false }).limit(8); if (from) query = query.gte("occurred_on", from); if (to) query = query.lte("occurred_on", to); return query; })(),
    supabase.from("members").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);
  const summary = summaryRows?.[0];
  const arrears = arrearsRows?.[0];
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">TRÉSORERIE ADEIO · INR</div><h1>Vue financière</h1><p>Vue d’ensemble : solde de la caisse, recettes, dépenses et résultat net.</p></div><Link href="/gestion-financiere/operations/nouvelle" className="admin-submit"><Plus size={18} /> Nouvelle opération</Link></div>
    <form className="finance-period-picker" aria-label="Période du tableau de bord"><label htmlFor="periode">Période</label><select id="periode" name="periode" defaultValue={period}><option value="all">Depuis le début</option><option value="month">Ce mois</option><option value="quarter">Ce trimestre</option><option value="year">Cette année</option></select><FinanceSubmitButton pendingLabel="Chargement…">Appliquer</FinanceSubmitButton></form>
    <div className="admin-stats finance-stats"><div className="admin-stat"><span>Résultat net</span><strong>{formatInr(summary?.net_balance_inr)}</strong></div><div className="admin-stat"><span><ArrowUpRight size={13} /> Recettes</span><strong>{formatInr(summary?.total_income_inr)}</strong></div><div className="admin-stat"><span><ArrowDownRight size={13} /> Dépenses</span><strong>{formatInr(summary?.total_expense_inr)}</strong></div><div className="admin-stat"><span><Banknote size={13} /> Membres en retard</span><strong>{arrears?.members_overdue ?? 0}</strong></div></div>
    <div className="finance-summary-note">Les totaux incluent uniquement les opérations publiées en roupies indiennes. Les arriérés sont accessibles aux rôles financiers autorisés.</div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2><ReceiptText size={16} /> Dernières opérations</h2><p>{summary?.transaction_count ?? 0} opération(s) publiée(s) dans l’historique.</p></div><Link href="/gestion-financiere/operations" className="text-link">Tout l’historique <ArrowRight size={15} /></Link></div>
      <div className="member-table-scroll"><table className="member-table"><thead><tr><th>Date</th><th>Nature</th><th>Libellé</th><th>Catégorie</th><th>Moyen</th><th>Montant</th></tr></thead><tbody>{recent?.map((item) => <tr key={item.id}><td>{formatFinancialDate(item.occurred_on)}</td><td><span className={`status-chip ${item.direction === "expense" ? "draft" : ""}`}>{financeDirectionLabel(item.direction)}</span></td><td>{item.label}</td><td>{item.transaction_categories?.[0]?.name ?? "—"}</td><td>{financeMethodLabel(item.payment_method)}</td><td className="finance-amount">{formatInr(item.amount_inr)}</td></tr>)}</tbody></table></div>
      {!recent?.length && <div className="admin-empty">Aucune opération publiée pour le moment.</div>}
    </div>
    <div className="finance-quick-links"><Link href="/gestion-financiere/cotisations"><Banknote size={17} /> Gérer les cotisations et arriérés <ArrowRight size={15} /></Link><Link href="/gestion-financiere/bilans"><FileBarChart2 size={17} /> Publier ou consulter un bilan <ArrowRight size={15} /></Link></div>
    <p className="finance-dashboard-footnote">{memberCount ?? 0} membres actifs enregistrés. Aucune opération publiée ne peut être supprimée : toute correction doit être enregistrée comme une nouvelle écriture.</p>
  </>;
}
