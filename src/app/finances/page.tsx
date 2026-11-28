import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, FileBarChart2, ReceiptText } from "lucide-react";
import { redirect } from "next/navigation";
import { getSignedInUser } from "@/lib/auth";
import { currentFinancialPeriod, financeDirectionLabel, financeMethodLabel, formatFinancialDate, formatInr } from "@/lib/finance";
import { FinanceSubmitButton } from "@/components/finance-submit-button";

type Props = { searchParams: Promise<{ periode?: string }> };

export default async function MemberFinancesPage({ searchParams }: Props) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Finances indisponibles</h1><p>Les données financières seront accessibles après le raccordement à Supabase.</p></div></section>;
  if (!user) redirect("/connexion?next=%2Ffinances");
  if (!roles.includes("member") && !roles.some((role) => ["treasurer", "auditor", "super_admin"].includes(role))) redirect("/espace-membre?erreur=acces-refuse");
  const params = await searchParams;
  const period = ["month", "quarter", "year"].includes(params.periode ?? "") ? params.periode! : "all";
  const { from, to } = currentFinancialPeriod(period);
  const [{ data: summaries }, { data: transactions }, { data: reports }] = await Promise.all([
    supabase.rpc("get_financial_summary_inr", { p_from: from, p_to: to }),
    (() => { let query = supabase.from("financial_transactions").select("id,occurred_on,direction,label,amount_inr,payment_method,transaction_categories(name)").eq("currency_code", "INR").eq("is_published", true).order("occurred_on", { ascending: false }).limit(20); if (from) query = query.gte("occurred_on", from); if (to) query = query.lte("occurred_on", to); return query; })(),
    supabase.from("financial_reports").select("id,title,period_start,period_end,summary,total_income_inr,total_expense_inr,net_balance_inr,transaction_count").order("period_end", { ascending: false }).limit(25),
  ]);
  const summary = summaries?.[0];
  const reportCards = (reports ?? []).map((report) => ({ ...report, canDownloadInr: report.total_income_inr !== null && report.total_expense_inr !== null && report.net_balance_inr !== null && report.transaction_count !== null, url: `/api/finances/reports/${report.id}` }));
  return <section className="member-space-page section-pad"><div className="container">
    <div className="member-space-heading"><div><div className="eyebrow eyebrow-green">TRANSPARENCE ET SUIVI</div><h1>Finances de l’association</h1><p>Consultez la situation générale et les bilans publiés en roupies indiennes.</p></div><Link href="/espace-membre" className="text-link">Mon espace</Link></div>
    <form className="finance-period-picker" aria-label="Période des finances"><label htmlFor="periode">Période affichée</label><select id="periode" name="periode" defaultValue={period}><option value="all">Depuis le début</option><option value="month">Ce mois</option><option value="quarter">Ce trimestre</option><option value="year">Cette année</option></select><FinanceSubmitButton pendingLabel="Chargement…">Appliquer</FinanceSubmitButton></form>
    <div className="admin-stats finance-stats"><div className="admin-stat"><span>Résultat net de la période</span><strong>{formatInr(summary?.net_balance_inr)}</strong></div><div className="admin-stat"><span><ArrowUpRight size={13} /> Recettes de la période</span><strong>{formatInr(summary?.total_income_inr)}</strong></div><div className="admin-stat"><span><ArrowDownRight size={13} /> Dépenses de la période</span><strong>{formatInr(summary?.total_expense_inr)}</strong></div></div>
    <div className="finance-export-links member-finance-exports"><a href={`/api/finances/export?format=csv&de=${from ?? ""}&a=${to ?? ""}`} className="text-link">Exporter l’historique CSV <ArrowRight size={14} /></a><a href={`/api/finances/export?format=pdf&de=${from ?? ""}&a=${to ?? ""}`} className="text-link">Télécharger l’historique PDF <ArrowRight size={14} /></a><Link href="/espace-membre/cotisations" className="text-link">Mes cotisations et échéances <ArrowRight size={14} /></Link></div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2><ReceiptText size={16} /> Opérations publiées</h2><p>Montants affichés en roupies indiennes.</p></div></div><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Date</th><th>Nature</th><th>Libellé</th><th>Catégorie</th><th>Moyen</th><th>Montant</th></tr></thead><tbody>{transactions?.map((item) => <tr key={item.id}><td>{formatFinancialDate(item.occurred_on)}</td><td>{financeDirectionLabel(item.direction)}</td><td>{item.label}</td><td>{item.transaction_categories?.[0]?.name ?? "—"}</td><td>{financeMethodLabel(item.payment_method)}</td><td className="finance-amount">{formatInr(item.amount_inr)}</td></tr>)}</tbody></table></div>{!transactions?.length && <p className="admin-empty">Aucune opération publiée.</p>}</div>
    <div className="admin-card"><h2><FileBarChart2 size={16} /> Bilans périodiques</h2><div className="admin-list">{reportCards.map((report) => <div className="admin-list-row" key={report.id}><div><h3>{report.title}</h3><p>{formatFinancialDate(report.period_start)} – {formatFinancialDate(report.period_end)}{report.summary ? ` · ${report.summary}` : ""}</p></div>{report.canDownloadInr ? <a className="text-link" href={report.url} target="_blank" rel="noreferrer">Télécharger</a> : <span className="status-chip draft">Ancien bilan à republier en INR</span>}</div>)}{!reportCards.length && <p className="admin-empty">Aucun bilan publié pour le moment.</p>}</div></div>
  </div></section>;
}
