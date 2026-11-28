import Link from "next/link";
import { CirclePlus, RefreshCw } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { formatFinancialDate, formatInr } from "@/lib/finance";
import { activateContributionPlanAction, generateContributionDuesAction, requestContributionTariffChangeAction, reviewContributionTariffChangeAction } from "@/app/gestion-financiere/actions";
import { ContributionPaymentForm } from "@/components/contribution-payment-form";
import { ContributionPlanForm } from "@/components/contribution-plan-form";
import { FinanceSubmitButton } from "@/components/finance-submit-button";
import { PaginationLinks } from "@/components/pagination-links";

type Props = { searchParams: Promise<{ statut?: string; erreur?: string; page?: string; annee?: string; situation?: string; q?: string }> };
type MemberOption = { id: string; member_number: string; first_name: string; last_name: string };
type LedgerMember = { member_id: string; member_number: string; first_name: string; last_name: string; sex: string | null; initial_claim_inr: number; total_paid_inr: number; remaining_inr: number; treasurer_comment: string | null; payment_status: "up_to_date" | "partial" | "overdue"; total_count: number };

export default async function FinanceContributionsPage({ searchParams }: Props) {
  const [{ supabase, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const currentYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date()));
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const year = Math.max(1900, Math.min(2200, Number.parseInt(params.annee ?? String(currentYear), 10) || currentYear));
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const pageSize = 50;
  const validStatus = ["up_to_date", "partial", "overdue"].includes(params.situation ?? "") ? params.situation! : null;
  const search = params.q?.trim().slice(0, 80) ?? "";
  const [{ data: plans }, { data: terms }, { data: members }, { data: ledger }, { data: totalsRows }, { data: monthTotalsRows }, { data: tariffChanges }] = await Promise.all([
    supabase.from("contribution_plans").select("id,name,amount_inr,starts_on,ends_on,is_active,status,executive_term_id").eq("currency_code", "INR").order("starts_on", { ascending: false }).limit(50),
    supabase.from("executive_terms").select("id,title,starts_on,ends_on,is_current").not("ends_on", "is", null).order("starts_on", { ascending: false }).limit(50),
    supabase.rpc("get_finance_contribution_members", { p_year: year, p_member_id: null }),
    supabase.rpc("get_contribution_year_summary", { p_year: year, p_search: search || null, p_status: validStatus, p_limit: pageSize, p_offset: (page - 1) * pageSize }),
    supabase.rpc("get_contribution_year_totals", { p_year: year }),
    supabase.rpc("get_contribution_month_status_totals", { p_year: year }),
    supabase.from("contribution_plan_tariff_changes").select("id,plan_id,old_amount_inr,new_amount_inr,effective_from,reason,impact_snapshot,status,requested_at,review_note").order("requested_at", { ascending: false }).limit(50),
  ]);
  const eligibleMembers = (members ?? []) as MemberOption[];
  const rows = (ledger ?? []) as LedgerMember[];
  const totalCount = rows[0]?.total_count ?? 0;
  const totals = totalsRows?.[0];
  const monthTotals = monthTotalsRows?.[0];
  const canManagePlans = roles.some((role) => role === "treasurer" || role === "super_admin");
  const isSuperAdmin = roles.includes("super_admin");
  const planPreviews = await Promise.all((plans ?? []).filter((plan) => plan.status === "active" && canManagePlans).map(async (plan) => {
    const { data } = await supabase.rpc("preview_contribution_dues_for_plan", { p_plan_id: plan.id });
    return [plan.id, data?.[0] ?? null] as const;
  }));
  const previewByPlan = new Map(planPreviews);
  const alerts: Record<string, string> = {
    "plan-invalide": "Vérifiez le mandat et le montant INR. Le mandat doit durer exactement douze mois.",
    "plan-deja-existant": "Un plan existe déjà pour ce mandat.",
    "tarif-invalide": "La demande de modification tarifaire n’a pas abouti. Vérifiez le mois, le montant et le motif.",
    "generation-impossible": "Les échéances mensuelles n’ont pas pu être générées.",
    "paiement-invalide": "Vérifiez le membre, la date, le montant reçu et la répartition des mois.",
    "repartition-invalide": "La répartition doit égaler le montant reçu et respecter le solde restant de chaque mois.",
    "paiement-impossible": "Le paiement n’a pas été enregistré. Vérifiez l’année, le membre et les mois sélectionnés.",
  };
  const planCards = (plans ?? []).map((plan) => {
    const planYear = Number(plan.starts_on.slice(0, 4));
    const planInTerm = Boolean(plan.executive_term_id && plan.ends_on >= localToday);
    const preview = previewByPlan.get(plan.id);
    const term = terms?.find((item) => item.id === plan.executive_term_id);
    const periodStarts = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(`${plan.starts_on}T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + index);
      return date.toISOString().slice(0, 10);
    });
    const todayMonth = `${currentYear}-${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", month: "2-digit" }).format(new Date())}-01`;
    const active = plan.status === "active" && planInTerm;
    return <article className="finance-plan-card" key={plan.id}>
      <div className="admin-card-heading"><div><h3>{plan.name} · {formatInr(plan.amount_inr)}</h3><p>{term?.title ?? "Ancien plan sans mandat associé"} · {formatFinancialDate(plan.starts_on)} – {formatFinancialDate(plan.ends_on)}</p></div><span className={`status-chip ${active ? "" : "draft"}`}>{active ? "Actif" : plan.status === "finished" || (plan.status === "active" && !planInTerm) ? "Terminé" : "Brouillon"}</span></div>
      {plan.status === "draft" && canManagePlans && <form action={activateContributionPlanAction}><input type="hidden" name="plan_id" value={plan.id} /><FinanceSubmitButton pendingLabel="Activation…">Activer le plan</FinanceSubmitButton></form>}
      {plan.status === "active" && !plan.executive_term_id && <p className="admin-form-note">Ce plan historique n’est pas lié à un mandat. Il reste consultable, mais aucune nouvelle échéance ne sera créée à partir de lui.</p>}
      {active && canManagePlans && <section><p className="admin-form-note">Aperçu : {preview?.eligible_members ?? 0} membres éligibles · {preview?.existing_dues ?? 0} échéances déjà présentes · {preview?.dues_to_create ?? 0} nouvelles échéances à créer.</p>
        {canManagePlans && <form action={generateContributionDuesAction} className="finance-generate-form"><input type="hidden" name="plan_id" value={plan.id} /><input type="hidden" name="financial_year" value={planYear} /><FinanceSubmitButton pendingLabel="Génération…">Confirmer la génération idempotente</FinanceSubmitButton></form>}
        {canManagePlans && <details className="tariff-request"><summary>Demander une modification du tarif</summary><form action={requestContributionTariffChangeAction} className="admin-form"><input type="hidden" name="plan_id" value={plan.id} /><label>Mois d’application<select name="effective_from" required defaultValue=""><option value="" disabled>Choisir un mois futur</option>{periodStarts.filter((start) => start.slice(0, 7) > todayMonth.slice(0, 7)).map((start) => <option key={start} value={start}>{new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${start}T00:00:00Z`))}</option>)}</select></label><label>Nouveau montant mensuel (INR)<input name="new_amount_inr" type="text" inputMode="numeric" placeholder="Ex. 100" required /></label><label>Motif<textarea name="reason" minLength={5} maxLength={1000} required /></label><FinanceSubmitButton pendingLabel="Envoi…">Envoyer la demande</FinanceSubmitButton></form></details>}
      </section>}
    </article>;
  });
  const statusLabel = (status: LedgerMember["payment_status"]) => status === "overdue" ? "En retard" : status === "partial" ? "Partiellement payé" : "À jour";
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">COTISATIONS · INR</div><h1>Cotisations et arriérés</h1><p>Suivez les créances, les versements et les soldes des membres pour une année financière.</p></div></div>
    {params.statut && <div role="status" className="form-success finance-alert">{({"plan-cree":"Plan de cotisation créé pour le mandat.","plan-active":"Plan activé.","tarif-demande":"Demande tarifaire envoyée au Super Admin.","tarif-approuve":"Nouveau tarif approuvé et appliqué aux échéances futures admissibles.","tarif-refuse":"Demande tarifaire refusée.","paiement-enregistre":"Paiement enregistré selon la répartition choisie."} as Record<string,string>)[params.statut] ?? params.statut.replaceAll("-", " ")}</div>}
    {params.erreur && alerts[params.erreur] && <div role="alert" className="form-error finance-alert">{alerts[params.erreur]}</div>}

    <div className="admin-stats finance-stats contribution-overview">
      <div className="admin-stat"><span>Total des cotisations attendues</span><strong>{formatInr(totals?.total_claim_inr)}</strong></div>
      <div className="admin-stat"><span>Total encaissé</span><strong>{formatInr(totals?.total_paid_inr)}</strong></div>
      <div className="admin-stat"><span>Total restant à payer</span><strong>{formatInr(Math.max(0, Number(totals?.total_claim_inr ?? 0) - Number(totals?.total_paid_inr ?? 0)))}</strong></div>
      <div className="admin-stat"><span>Membres à jour</span><strong>{totals?.up_to_date_members ?? 0}</strong></div>
      <div className="admin-stat"><span>Membres avec un solde</span><strong>{totals?.members_with_balance ?? 0}</strong></div>
      <div className="admin-stat"><span>Mois impayés</span><strong>{monthTotals?.unpaid_months ?? 0}</strong></div>
      <div className="admin-stat"><span>Mois partiellement payés</span><strong>{monthTotals?.partially_paid_months ?? 0}</strong></div>
    </div>

    <div className="contribution-toolbox">
      <details className="admin-card contribution-tool"><summary><CirclePlus size={19} /> Enregistrer un paiement</summary><p>Choisissez les mois et répartissez vous-même le montant reçu.</p>{eligibleMembers.length ? <ContributionPaymentForm members={eligibleMembers} initialYear={year} /> : <div className="admin-empty">Aucun membre actif n’est éligible au paiement pour cette année.</div>}</details>
      <details className="admin-card contribution-tool"><summary><RefreshCw size={19} /> Plans et échéances</summary><p>Un mandat du Bureau exécutif correspond à un plan unique couvrant ses douze mois. Les nouveaux membres éligibles sont rattachés automatiquement.</p>
        {canManagePlans && <div className="contribution-plan-create"><h3>Créer un plan pour un mandat</h3><ContributionPlanForm terms={(terms ?? []).filter((term) => term.ends_on >= localToday && !(plans ?? []).some((plan) => plan.executive_term_id === term.id))} /></div>}
        {planCards.length ? <div className="admin-list">{planCards}</div> : <div className="admin-empty">Aucun plan. Créez-en un pour le mandat concerné.</div>}
        {(tariffChanges ?? []).length > 0 && <section className="tariff-requests"><h3>Historique des demandes tarifaires</h3>{tariffChanges!.map((change) => <article className="admin-list-row" key={change.id}><div><strong>{formatInr(change.old_amount_inr)} → {formatInr(change.new_amount_inr)} dès {formatFinancialDate(change.effective_from)}</strong><p>{change.reason}</p><small>Échéances déjà générées concernées : {change.impact_snapshot?.unpaid ?? 0} impayée(s), {change.impact_snapshot?.partial ?? 0} partielle(s), {change.impact_snapshot?.notConcerned ?? 0} non concernée(s), {change.impact_snapshot?.partialAboveNewRate ?? 0} paiement(s) partiel(s) incompatibles avec le nouveau tarif. Les périodes créées plus tard reprendront le tarif approuvé ; les paiements complets restent inchangés.</small><span className={`status-chip ${change.status === "pending" ? "draft" : ""}`}>{change.status === "pending" ? "En attente" : change.status === "approved" ? "Approuvée" : "Refusée"}</span></div>{isSuperAdmin && change.status === "pending" && <div className="tariff-review-actions">{[true,false].map((approve) => <form action={reviewContributionTariffChangeAction} key={String(approve)}><input type="hidden" name="request_id" value={change.id} /><input type="hidden" name="approve" value={String(approve)} /><input name="review_note" maxLength={1000} placeholder="Note (facultative)" /><button className={approve ? "admin-submit" : "admin-submit admin-submit-secondary"} type="submit">{approve ? "Approuver" : "Refuser"}</button></form>)}</div>}</article>)}</section>}
      </details>
    </div>

    <div className="admin-card contribution-ledger-card">
      <div className="admin-card-heading"><div><div className="eyebrow eyebrow-green">SUIVI ANNUEL</div><h2>Situation des membres · {year}</h2><p>Les soldes sont calculés à partir des échéances et paiements enregistrés.</p></div></div>
      <form className="finance-filter-bar" method="get"><label>Année financière<input type="number" name="annee" min="1900" max="2200" defaultValue={year} /></label><label>Rechercher un membre<input name="q" defaultValue={search} placeholder="Nom ou numéro ADEIO" /></label><label>Situation<select name="situation" defaultValue={params.situation ?? ""}><option value="">Toutes</option><option value="up_to_date">À jour</option><option value="partial">Partiellement payé</option><option value="overdue">En retard</option></select></label><button className="admin-submit admin-submit-secondary" type="submit">Filtrer</button></form>
      <div className="member-table-scroll"><table className="member-table contribution-ledger"><thead><tr><th>Membre</th><th>Genre</th><th>Créance initiale</th><th>Total payé</th><th>Solde restant</th><th>Commentaire</th><th>Situation</th><th>Action</th></tr></thead><tbody>{rows.map((member) => <tr key={member.member_id}><td><strong>{member.first_name} {member.last_name}</strong><small>{member.member_number}</small></td><td>{member.sex === "male" ? "M" : member.sex === "female" ? "F" : "—"}</td><td>{formatInr(member.initial_claim_inr)}</td><td>{formatInr(member.total_paid_inr)}</td><td className={member.remaining_inr ? "finance-amount" : ""}>{formatInr(member.remaining_inr)}</td><td>{member.treasurer_comment || "—"}</td><td><span className={`status-chip ${member.payment_status === "overdue" ? "draft" : ""}`}>{statusLabel(member.payment_status)}</span></td><td><Link href={`/gestion-financiere/cotisations/${member.member_id}?annee=${year}`} className="text-link">Voir les détails</Link></td></tr>)}</tbody></table></div>
      {!rows.length && <div className="admin-empty">Aucune créance trouvée pour cette année. Créez un plan puis générez les échéances.</div>}
      <PaginationLinks pathname="/gestion-financiere/cotisations" page={page} hasNext={totalCount > page * pageSize} query={{ annee: String(year), q: search, situation: params.situation ?? "" }} />
    </div>
  </>;
}
