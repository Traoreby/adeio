import Link from "next/link";
import { Banknote, CalendarClock, CirclePlus, RefreshCw } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { formatFinancialDate, formatInr } from "@/lib/finance";
import { generateContributionDuesAction } from "@/app/gestion-financiere/actions";
import { ContributionPaymentForm } from "@/components/contribution-payment-form";
import { ContributionPlanForm } from "@/components/contribution-plan-form";
import { FinanceSubmitButton } from "@/components/finance-submit-button";
import { PaginationLinks } from "@/components/pagination-links";

type Props = { searchParams: Promise<{ statut?: string; erreur?: string; page?: string; annee?: string; mois?: string; situation?: string; mode?: string; q?: string; membre?: string; reference?: string }> };
type MemberOption = { id: string; member_number: string; first_name: string; last_name: string };
type LedgerMember = { member_id: string; member_number: string; first_name: string; last_name: string; sex: string | null; initial_claim_inr: number; total_paid_inr: number; remaining_inr: number; treasurer_comment: string | null; payment_status: "up_to_date" | "partial" | "overdue"; total_count: number };
type PaymentRow = { payment_id: string; reference: string; member_id: string; member_number: string; full_name: string; paid_on: string; amount_inr: number; payment_method: "cash" | "online"; note: string | null; recorded_by: string | null; months: number[]; total_count: number };
type MonthRow = { due_id: string | null; month_number: number; month_due_inr: number; month_paid_inr: number; month_remaining_inr: number; payment_status: string };

const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export default async function FinanceContributionsPage({ searchParams }: Props) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const currentYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date()));
  const year = Math.max(1900, Math.min(2200, Number.parseInt(params.annee ?? String(currentYear), 10) || currentYear));
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const pageSize = 50;
  const month = Number(params.mois);
  const validMonth = Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
  const validStatus = ["up_to_date", "partial", "overdue"].includes(params.situation ?? "") ? params.situation! : null;
  const validMethod = params.mode === "cash" || params.mode === "online" ? params.mode : null;
  const search = params.q?.trim().slice(0, 80) ?? "";
  const [{ data: plans }, { data: members }, { data: ledger }, { data: totalsRows }, { data: history }, { data: legacyPlans }, { data: legacyPayments }] = await Promise.all([
    supabase.from("contribution_plans").select("id,name,amount_inr,starts_on,ends_on,is_active").eq("currency_code", "INR").order("starts_on", { ascending: false }).limit(50),
    supabase.rpc("get_finance_contribution_members", { p_year: year, p_member_id: null }),
    supabase.rpc("get_contribution_year_summary", { p_year: year, p_search: search || null, p_status: validStatus, p_limit: pageSize, p_offset: (page - 1) * pageSize }),
    supabase.rpc("get_contribution_year_totals", { p_year: year }),
    supabase.rpc("get_contribution_payment_history", { p_year: year, p_month: validMonth, p_method: validMethod, p_search: search || null, p_limit: pageSize, p_offset: (page - 1) * pageSize }),
    supabase.from("contribution_plans").select("id,name,amount_fcfa,starts_on").eq("currency_code", "XOF").order("starts_on", { ascending: false }).limit(20),
    supabase.from("contribution_payments").select("id,reference,paid_on,amount_fcfa,payment_method,note,members(member_number,first_name,last_name)").eq("currency_code", "XOF").order("paid_on", { ascending: false }).limit(10),
  ]);
  const eligibleMembers = (members ?? []) as MemberOption[];
  const rows = (ledger ?? []) as LedgerMember[];
  const payments = (history ?? []) as PaymentRow[];
  const monthNamesByPayment = (payment: PaymentRow) => payment.months.map((number) => monthNames[number - 1]).join(", ");
  const totalCount = rows[0]?.total_count ?? 0;
  const historyCount = payments[0]?.total_count ?? 0;
  const totals = totalsRows?.[0];
  const selectedMemberId = params.membre && /^[0-9a-f-]{36}$/i.test(params.membre) ? params.membre : "";
  const [{ data: selectedMembers }, { data: monthBreakdown }] = selectedMemberId ? await Promise.all([
    supabase.rpc("get_finance_contribution_members", { p_year: year, p_member_id: selectedMemberId }),
    supabase.rpc("get_contribution_month_breakdown", { p_member_id: selectedMemberId, p_year: year }),
  ]) : [{ data: null }, { data: [] }];
  const selectedMember = (selectedMembers as MemberOption[] | null)?.[0] ?? null;
  const monthlyRows = (monthBreakdown ?? []) as MonthRow[];
  const alerts: Record<string, string> = {
    "plan-invalide": "Vérifiez le nom, le montant INR et l’année financière.",
    "generation-impossible": "Les échéances mensuelles INR n’ont pas pu être générées.",
    "paiement-invalide": "Vérifiez le membre, la date, le montant reçu et la répartition des mois.",
    "repartition-invalide": "La répartition doit égaler le montant reçu et ne pas dépasser le solde restant de chaque mois.",
    "paiement-impossible": "Le paiement INR n’a pas été enregistré. Vérifiez l’année, le membre et les mois sélectionnés.",
  };
  const statusLabel = (status: LedgerMember["payment_status"]) => status === "overdue" ? "En retard" : status === "partial" ? "Partiellement payé" : "À jour";
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">ÉCHÉANCES INDIVIDUELLES</div><h1>Cotisations et arriérés</h1><p>Créances et paiements mensuels en roupies indiennes (INR). Les mois sont choisis et répartis manuellement.</p><p className="finance-security-note">Accès aux détails limité aux rôles financiers habilités. Les écritures XOF historiques sont conservées séparément, sans conversion.</p></div></div>
    {params.statut && <div role="status" className="form-success finance-alert">{params.statut === "plan-cree" ? "Plan mensuel INR créé." : params.statut === "paiement-enregistre" ? `Paiement enregistré et ventilé selon les mois sélectionnés.${params.reference ? ` Référence : ${params.reference}.` : ""}` : params.statut.replaceAll("-", " ")}</div>}
    {params.erreur && alerts[params.erreur] && <div role="alert" className="form-error finance-alert">{alerts[params.erreur]}</div>}
    <div className="admin-card"><div className="admin-card-heading"><div><h2><CirclePlus size={20} /> Créer un plan mensuel INR</h2><p>Un montant mensuel est appliqué à chaque mois de l’année financière.</p></div></div><ContributionPlanForm /></div>

    <div className="admin-card"><div className="admin-card-heading"><div><h2><RefreshCw size={20} /> Plans et échéances INR</h2><p>Générez les 12 mois de l’année pour les membres dont l’adhésion couvre cette année.</p></div></div>{plans?.length ? <div className="admin-list">{plans.map((plan) => { const planYear = Number(plan.starts_on.slice(0, 4)); return <div className="admin-list-row finance-plan-row" key={plan.id}><div><h3>{plan.name} · {formatInr(plan.amount_inr)}</h3><p>Année financière {planYear} · du {formatFinancialDate(plan.starts_on)} au {formatFinancialDate(plan.ends_on)}</p><span className={`status-chip ${plan.is_active ? "" : "draft"}`}>{plan.is_active ? "Actif" : "Inactif"}</span></div>{plan.is_active && <form action={generateContributionDuesAction} className="finance-generate-form"><input type="hidden" name="plan_id" value={plan.id} /><input type="hidden" name="financial_year" value={planYear} /><FinanceSubmitButton pendingLabel="Génération…">Générer les 12 mois</FinanceSubmitButton></form>}</div>; })}</div> : <div className="admin-empty">Aucun plan INR. Créez un plan ci-dessus pour commencer.</div>}</div>

    <div className="admin-card"><div className="admin-card-heading"><div><h2><CalendarClock size={18} /> Enregistrer un paiement</h2><p>Choisissez un ou plusieurs mois et répartissez le montant reçu, sans affectation automatique.</p></div></div>{eligibleMembers.length ? <ContributionPaymentForm members={eligibleMembers} initialYear={year} /> : <div className="admin-empty">Aucun membre actif éligible au paiement pour cette année financière.</div>}</div>

    <div className="admin-card"><div className="admin-card-heading"><div><h2><Banknote size={18} /> Situation annuelle · {year}</h2><p>La créance couvre les échéances générées; les arriérés ne comptent que les mois échus.</p></div></div>
      <div className="admin-stats finance-stats"><div className="admin-stat"><span>Créances totales</span><strong>{formatInr(totals?.total_claim_inr)}</strong></div><div className="admin-stat"><span>Total encaissé</span><strong>{formatInr(totals?.total_paid_inr)}</strong></div><div className="admin-stat"><span>Arriérés échus</span><strong>{formatInr(totals?.total_overdue_inr)}</strong></div><div className="admin-stat"><span>Membres à jour</span><strong>{totals?.up_to_date_members ?? 0}</strong></div><div className="admin-stat"><span>Avec un solde</span><strong>{totals?.members_with_balance ?? 0}</strong></div></div>
      <form className="finance-filter-bar" method="get"><label>Année<input type="number" name="annee" min="1900" max="2200" defaultValue={year} /></label><label>Recherche membre<input name="q" defaultValue={search} placeholder="Nom ou numéro ADEIO" /></label><label>Situation<select name="situation" defaultValue={params.situation ?? ""}><option value="">Toutes</option><option value="up_to_date">À jour</option><option value="partial">Partiellement payé</option><option value="overdue">En retard</option></select></label><button className="admin-submit admin-submit-secondary" type="submit">Filtrer</button></form>
      <div className="member-table-scroll"><table className="member-table"><thead><tr><th>Membre</th><th>Genre</th><th>Créance initiale</th><th>Total payé</th><th>Solde restant</th><th>Commentaire</th><th>Situation</th></tr></thead><tbody>{rows.map((member) => <tr key={member.member_id}><td><Link href={`/gestion-financiere/cotisations?annee=${year}&membre=${member.member_id}`} className="text-link">{member.first_name} {member.last_name}</Link><small>{member.member_number}</small></td><td>{member.sex === "male" ? "M" : member.sex === "female" ? "F" : "—"}</td><td>{formatInr(member.initial_claim_inr)}</td><td>{formatInr(member.total_paid_inr)}</td><td className={member.remaining_inr ? "finance-amount" : ""}>{formatInr(member.remaining_inr)}</td><td>{member.treasurer_comment || "—"}</td><td><span className={`status-chip ${member.payment_status === "overdue" ? "draft" : ""}`}>{statusLabel(member.payment_status)}</span></td></tr>)}</tbody></table></div>
      {!rows.length && <div className="admin-empty">Aucune créance INR trouvée pour cette année. Créez un plan et générez ses échéances.</div>}
      <PaginationLinks pathname="/gestion-financiere/cotisations" page={page} hasNext={totalCount > page * pageSize} query={{ annee: String(year), q: search, situation: params.situation ?? "" }} />
    </div>

    {selectedMember && <div className="admin-card"><h2>Détail mensuel · {selectedMember.first_name} {selectedMember.last_name} · {year}</h2><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Mois</th><th>Montant dû</th><th>Déjà payé</th><th>Reste</th><th>État</th></tr></thead><tbody>{monthlyRows.map((row) => <tr key={row.month_number}><td>{monthNames[row.month_number - 1]}</td><td>{formatInr(row.month_due_inr)}</td><td>{formatInr(row.month_paid_inr)}</td><td>{formatInr(row.month_remaining_inr)}</td><td>{row.payment_status === "paid" ? "Payé" : row.payment_status === "partial" ? "Partiellement payé" : row.payment_status === "not_generated" ? "Échéance non générée" : "Non payé"}</td></tr>)}</tbody></table></div></div>}

    <div className="admin-card"><div className="admin-card-heading"><div><h2>Historique des paiements INR</h2><p>Référence, mois affectés et auteur sont conservés pour chaque reçu.</p></div></div><form className="finance-filter-bar" method="get"><input type="hidden" name="annee" value={year} /><label>Mois concerné<select name="mois" defaultValue={params.mois ?? ""}><option value="">Tous les mois</option>{monthNames.map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</select></label><label>Mode de paiement<select name="mode" defaultValue={params.mode ?? ""}><option value="">Tous les modes</option><option value="cash">Espèces</option><option value="online">Online</option></select></label><label>Recherche membre<input name="q" defaultValue={search} placeholder="Nom ou numéro ADEIO" /></label><button className="admin-submit admin-submit-secondary" type="submit">Filtrer l’historique</button></form><div className="admin-list">{payments.map((payment) => <div className="admin-list-row" key={payment.payment_id}><div><h3>{payment.full_name} · {payment.member_number}</h3><p>{formatFinancialDate(payment.paid_on)} · {monthNamesByPayment(payment)} · {payment.payment_method === "online" ? "Online" : "Espèces"} · Réf. {payment.reference}</p><small>{payment.note || "Aucun commentaire"} · Enregistré par {payment.recorded_by || "compte technique non disponible"}</small></div><strong>{formatInr(payment.amount_inr)}</strong></div>)}{!payments.length && <div className="admin-empty">Aucun paiement INR ne correspond à ces filtres.</div>}</div><PaginationLinks pathname="/gestion-financiere/cotisations" page={page} hasNext={historyCount > page * pageSize} query={{ annee: String(year), mois: params.mois ?? "", mode: params.mode ?? "", q: search }} /></div>

    {legacyPlans?.length || legacyPayments?.length ? <div className="admin-card legacy-currency-card"><h2>Archives historiques en XOF · FCFA</h2><p>Ces anciens plans et reçus restent conservés dans leur devise d’origine. Ils ne sont pas convertis ni additionnés aux montants INR.</p>{legacyPlans?.map((plan) => <p key={plan.id}>{plan.name} · {Number(plan.amount_fcfa).toLocaleString("fr-FR")} FCFA · {plan.starts_on.slice(0, 4)}</p>)}{legacyPayments?.map((payment) => { const member = Array.isArray(payment.members) ? payment.members[0] : payment.members; return <p key={payment.id}>{member?.member_number} · {member?.first_name} {member?.last_name} · {formatFinancialDate(payment.paid_on)} · {Number(payment.amount_fcfa).toLocaleString("fr-FR")} FCFA · {payment.reference}</p>; })}</div> : null}
  </>;
}
