import Link from "next/link";
import { ArrowLeft, Banknote, CalendarClock, ReceiptText } from "lucide-react";
import { notFound } from "next/navigation";
import { getSignedInUser } from "@/lib/auth";
import { formatFinancialDate, formatInr } from "@/lib/finance";
import { PaginationLinks } from "@/components/pagination-links";

type Props = { params: Promise<{ memberId: string }>; searchParams: Promise<{ annee?: string; page?: string }> };
type Identity = { id: string; member_number: string; first_name: string; last_name: string; sex: string | null; status: string };
type Summary = { initial_claim_inr: number; total_paid_inr: number; remaining_inr: number; payment_status: "up_to_date" | "partial" | "overdue"; total_count: number };
type Month = { month_number: number; month_due_inr: number; month_paid_inr: number; month_remaining_inr: number; payment_status: string };
type Payment = { payment_id: string; reference: string; paid_on: string; amount_inr: number; payment_method: "cash" | "online"; note: string | null; recorded_by: string | null; months: number[]; total_count: number };

const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export default async function ContributionMemberDetailsPage({ params, searchParams }: Props) {
  const [{ memberId }, query, { supabase }] = await Promise.all([params, searchParams, getSignedInUser()]);
  if (!supabase || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memberId)) notFound();
  const currentYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date()));
  const year = Math.max(1900, Math.min(2200, Number.parseInt(query.annee ?? String(currentYear), 10) || currentYear));
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1));
  const pageSize = 50;
  const { data: identityRows, error: identityError } = await supabase.rpc("get_finance_member_contribution_identity", { p_member_id: memberId });
  if (identityError) throw new Error("La fiche du membre n’a pas pu être chargée.");
  const member = (identityRows as Identity[] | null)?.[0];
  if (!member) notFound();
  const [{ data: summaries }, { data: months }, { data: paymentRows }] = await Promise.all([
    supabase.rpc("get_contribution_year_summary", { p_year: year, p_search: member.member_number, p_status: null, p_limit: 1, p_offset: 0 }),
    supabase.rpc("get_contribution_month_breakdown", { p_member_id: memberId, p_year: year }),
    supabase.rpc("get_contribution_payment_history", { p_year: year, p_month: null, p_method: null, p_search: member.member_number, p_limit: pageSize, p_offset: (page - 1) * pageSize }),
  ]);
  const summary = (summaries as Summary[] | null)?.[0];
  const monthlyRows = (months ?? []) as Month[];
  const payments = (paymentRows ?? []) as Payment[];
  const paymentCount = payments[0]?.total_count ?? 0;
  const monthLabel = (number: number) => monthNames[number - 1] ?? "Mois inconnu";
  const statusText = (status: string) => status === "not_concerned" ? "Non concerné" : status === "paid" ? "Payé" : status === "partial" ? "Partiellement payé" : status === "not_generated" ? "Non généré" : "Non payé";

  return <>
    <div className="admin-page-heading contribution-detail-heading"><div><Link href={`/gestion-financiere/cotisations?annee=${year}`} className="text-link"><ArrowLeft size={15} /> Retour aux cotisations</Link><div className="eyebrow eyebrow-green">DÉTAIL DU MEMBRE · {year}</div><h1>{member.first_name} {member.last_name}</h1><p>{member.member_number} · {member.sex === "male" ? "Homme" : member.sex === "female" ? "Femme" : "Genre non renseigné"} · {member.status === "active" ? "Actif" : "Archivé"}</p></div><form className="contribution-year-select" method="get"><label htmlFor="detail-year">Année financière</label><input id="detail-year" type="number" name="annee" min="1900" max="2200" defaultValue={year} /><button className="admin-submit admin-submit-secondary" type="submit">Afficher</button></form></div>
    <div className="admin-stats finance-stats contribution-detail-stats"><div className="admin-stat"><span><Banknote size={14} /> Cotisations attendues</span><strong>{formatInr(summary?.initial_claim_inr)}</strong></div><div className="admin-stat"><span>Total payé</span><strong>{formatInr(summary?.total_paid_inr)}</strong></div><div className="admin-stat"><span><CalendarClock size={14} /> Solde restant</span><strong>{formatInr(summary?.remaining_inr)}</strong></div></div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2>Les 12 mois de {year}</h2><p>Les paiements sont rapprochés des échéances mensuelles enregistrées.</p></div></div><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Mois</th><th>Montant dû</th><th>Montant payé</th><th>Solde restant</th><th>Situation</th></tr></thead><tbody>{monthlyRows.map((month) => <tr key={month.month_number}><td>{monthLabel(month.month_number)}</td><td>{formatInr(month.month_due_inr)}</td><td>{formatInr(month.month_paid_inr)}</td><td className={month.month_remaining_inr > 0 ? "finance-amount" : ""}>{formatInr(month.month_remaining_inr)}</td><td><span className={`status-chip ${month.payment_status === "unpaid" || month.payment_status === "partial" ? "draft" : ""}`}>{statusText(month.payment_status)}</span></td></tr>)}</tbody></table></div></div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2><ReceiptText size={18} /> Historique des paiements</h2><p>Les références et affectations mensuelles sont conservées pour chaque opération.</p></div></div><div className="admin-list">{payments.map((payment) => <article className="admin-list-row contribution-payment-history-row" key={payment.payment_id}><div><h3>{formatFinancialDate(payment.paid_on)} · {payment.payment_method === "online" ? "Online" : "Espèces"}</h3><p>{payment.months.map(monthLabel).join(", ")} · Référence {payment.reference}</p><small>{payment.note || "Aucun commentaire"}{payment.recorded_by ? ` · Enregistré par ${payment.recorded_by}` : ""}</small></div><strong>{formatInr(payment.amount_inr)}</strong></article>)}{!payments.length && <div className="admin-empty">Aucun paiement enregistré pour cette année.</div>}</div><PaginationLinks pathname={`/gestion-financiere/cotisations/${memberId}`} page={page} hasNext={paymentCount > page * pageSize} query={{ annee: String(year) }} /></div>
  </>;
}
