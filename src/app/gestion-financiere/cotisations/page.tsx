import Link from "next/link";
import { ArrowRight, Banknote, CalendarClock, CirclePlus, RefreshCw } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { contributionPeriodicityLabel, formatFcfa, formatFinancialDate } from "@/lib/finance";
import { generateContributionDuesAction, recordContributionPaymentAction } from "@/app/gestion-financiere/actions";
import { ContributionPlanForm } from "@/components/contribution-plan-form";
import { FinanceSubmitButton } from "@/components/finance-submit-button";
import { PaginationLinks } from "@/components/pagination-links";

type Props = { searchParams: Promise<{ statut?: string; erreur?: string; page?: string }> };
type OverdueMember = { member_id: string; member_number: string; first_name: string; last_name: string; overdue_periods: number; oldest_due_on: string; overdue_amount_fcfa: number; total_count: number };

export default async function FinanceContributionsPage({ searchParams }: Props) {
  const [{ supabase, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const today = new Date().toISOString().slice(0, 10);
  const arrearsPage = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const arrearsPageSize = 50;
  const [{ data: plans }, { data: members }, { data: overdue }, { data: payments }] = await Promise.all([
    supabase.from("contribution_plans").select("id,name,amount_fcfa,periodicity,custom_period_days,starts_on,ends_on,is_active").order("created_at", { ascending: false }).limit(50),
    supabase.from("members").select("id,member_number,first_name,last_name").eq("status", "active").order("last_name").order("first_name").limit(500),
    supabase.rpc("get_finance_overdue_page", { p_as_of: today, p_limit: arrearsPageSize, p_offset: (arrearsPage - 1) * arrearsPageSize }),
    supabase.from("contribution_payments").select("id,member_id,paid_on,amount_fcfa,payment_method,note,members(member_number,first_name,last_name)").order("paid_on", { ascending: false }).limit(10),
  ]);
  const overdueMembers = (overdue ?? []) as OverdueMember[];
  const overdueCount = overdueMembers[0]?.total_count ?? 0;
  const alerts: Record<string, string> = {
    "plan-invalide": "Vérifiez le nom, le montant, la périodicité et les dates du plan.",
    "generation-impossible": "Les échéances n’ont pas pu être générées. Vérifiez que le plan est actif.",
    "paiement-invalide": "Vérifiez le membre, le montant et les informations du paiement.",
    "paiement-impossible": "Le paiement n’a pas été enregistré. Assurez-vous que des échéances échues existent et que le montant ne les dépasse pas.",
  };
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">ÉCHÉANCES INDIVIDUELLES</div><h1>Cotisations et arriérés</h1><p>Créez un plan de cotisation, enregistrez les paiements des membres et suivez les arriérés.</p><p className="finance-security-note">Les données individuelles restent limitées au membre concerné et aux rôles financiers habilités.</p></div></div>
    {params.statut && <div role="status" className="form-success finance-alert">{params.statut === "plan-cree" ? "Plan de cotisation créé." : params.statut === "paiement-enregistre" ? "Paiement enregistré, affecté aux plus anciennes échéances et publié dans la trésorerie." : params.statut.replaceAll("-", " ")}</div>}
    {params.erreur && alerts[params.erreur] && <div role="alert" className="form-error finance-alert">{alerts[params.erreur]}</div>}
    <div className="admin-card"><div className="admin-card-heading"><div><h2><CirclePlus size={20} /> Créer un plan</h2><p>Le montant et la périodicité sont paramétrables par l’association.</p></div></div><ContributionPlanForm /></div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2><RefreshCw size={20} /> Plans et échéances</h2><p>Générez les échéances jusqu’à la date choisie.</p></div></div>{plans?.length ? <div className="admin-list">{plans.map((plan) => <div className="admin-list-row finance-plan-row" key={plan.id}><div><h3>{plan.name} · {formatFcfa(plan.amount_fcfa)}</h3><p>{contributionPeriodicityLabel(plan.periodicity)}{plan.custom_period_days ? ` · ${plan.custom_period_days} jours` : ""} · du {formatFinancialDate(plan.starts_on)}{plan.ends_on ? ` au ${formatFinancialDate(plan.ends_on)}` : " · sans date de fin"}</p><span className={`status-chip ${plan.is_active ? "" : "draft"}`}>{plan.is_active ? "Actif" : "Inactif"}</span></div>{plan.is_active && <form action={generateContributionDuesAction} className="finance-generate-form"><input type="hidden" name="plan_id" value={plan.id} /><label>Générer jusqu’au<input type="date" name="through" defaultValue={today} max="2200-12-31" /></label><FinanceSubmitButton pendingLabel="Génération…">Générer</FinanceSubmitButton></form>}</div>)}</div> : <div className="admin-empty">Aucun plan pour le moment. Créez-en un en renseignant le montant et la périodicité décidés par l’association.</div>}</div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2><CalendarClock size={16} /> Enregistrer un paiement</h2><p>Le paiement est affecté en priorité aux plus anciennes échéances échues, puis publié comme recette.</p></div></div>{members?.length ? <form action={recordContributionPaymentAction} className="admin-form finance-form">
      <div><label htmlFor="payment-member">Membre</label><select id="payment-member" name="member_id" required defaultValue=""><option value="" disabled>Choisir un membre</option>{members.map((member) => <option value={member.id} key={member.id}>{member.member_number} · {member.first_name} {member.last_name}</option>)}</select></div>
      <div className="admin-form-grid"><div><label htmlFor="payment-date">Date du paiement</label><input id="payment-date" name="paid_on" type="date" required defaultValue={today} /></div><div><label htmlFor="payment-amount">Montant versé (FCFA)</label><input id="payment-amount" name="amount_fcfa" type="number" min="1" step="1" max="1000000000000" required placeholder="Ex. 5 000" /></div></div>
      <div className="admin-form-grid"><div><label htmlFor="payment-method">Moyen de paiement</label><select id="payment-method" name="payment_method" defaultValue="cash"><option value="cash">Espèces</option><option value="mobile_money">Mobile money</option><option value="bank_transfer">Virement</option><option value="other">Autre</option></select></div><div><label htmlFor="payment-note">Référence ou note (facultatif)</label><input id="payment-note" name="note" maxLength={500} /></div></div><FinanceSubmitButton pendingLabel="Enregistrement…">Enregistrer le paiement</FinanceSubmitButton>
    </form> : <div className="admin-empty">Aucun membre actif. Ajoutez d’abord des fiches dans Administration → Membres.{roles.some((role) => role === "admin" || role === "super_admin") ? <> <Link href="/admin/membres" className="text-link">Ajouter des membres <ArrowRight size={14} /></Link></> : <span> Demandez à un administrateur de les ajouter.</span>}</div>}</div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2>Échéances échues non réglées</h2><p>{overdueCount} membre(s) en retard · {arrearsPageSize} lignes maximum par page, montants agrégés par la base.</p></div><a href="/api/finances/arrears" className="text-link">Exporter CSV <ArrowRight size={14} /></a></div><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Membre</th><th>Périodes impayées</th><th>Plus ancienne échéance</th><th>Montant restant</th></tr></thead><tbody>{overdueMembers.map((member) => <tr key={member.member_id}><td>{member.member_number} · {member.first_name} {member.last_name}</td><td>{member.overdue_periods}</td><td>{formatFinancialDate(member.oldest_due_on)}</td><td className="finance-amount">{formatFcfa(member.overdue_amount_fcfa)}</td></tr>)}</tbody></table></div>{!overdueCount && <div className="admin-empty">Aucun membre n’a d’échéance échue impayée.</div>}<PaginationLinks pathname="/gestion-financiere/cotisations" page={arrearsPage} hasNext={overdueCount > arrearsPage * arrearsPageSize} /></div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2><Banknote size={16} /> Paiements récents</h2><p>Les reçus individuels ne sont pas affichés dans les finances générales des membres.</p></div><Link href="/gestion-financiere/operations" className="text-link">Voir les opérations <ArrowRight size={14} /></Link></div><div className="admin-list">{payments?.map((payment) => <div className="admin-list-row" key={payment.id}><div><h3>{payment.members?.[0]?.member_number} · {payment.members?.[0]?.first_name} {payment.members?.[0]?.last_name}</h3><p>{formatFinancialDate(payment.paid_on)} · {payment.note || "Cotisation enregistrée"}</p></div><strong>{formatFcfa(payment.amount_fcfa)}</strong></div>)}{!payments?.length && <p className="admin-empty">Aucun paiement enregistré.</p>}</div></div>
  </>;
}
