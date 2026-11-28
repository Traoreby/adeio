import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  CalendarClock,
  CircleCheck,
  CircleDollarSign,
  CircleMinus,
  CirclePercent,
  Clock3,
  ReceiptText,
} from "lucide-react";
import { redirect } from "next/navigation";
import { getSignedInUser } from "@/lib/auth";
import { formatFinancialDate, formatInr } from "@/lib/finance";

type MaybeOne<T> = T | T[] | null;
type Term = { title: string; starts_on: string; ends_on: string | null };
type Plan = {
  id: string;
  name: string;
  amount_inr: number | null;
  currency_code: string;
  starts_on: string;
  ends_on: string | null;
  executive_term_id: string | null;
  executive_terms: MaybeOne<Term>;
};
type Payment = {
  id: string;
  paid_on: string;
  amount_inr: number;
  payment_method: string;
  reference: string;
  note: string | null;
};
type Allocation = { amount_inr: number; contribution_payments: MaybeOne<Payment> };
type Due = {
  id: string;
  plan_id: string;
  period_start: string;
  period_end: string;
  due_on: string;
  amount_due_inr: number;
  is_not_concerned: boolean;
  not_concerned_reason: string | null;
  contribution_plans: MaybeOne<Plan>;
  contribution_allocations: Allocation[] | null;
};
type DueView = Due & { plan: Plan | null; expected: number; paid: number; remaining: number; status: DueStatus };
type DueStatus = "paid" | "partial" | "unpaid" | "not_concerned";
type PaymentHistory = Payment & { allocations: { date: string; plan: string; amount: number }[] };

const monthFormatter = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const dateKey = (value: string) => value.slice(0, 10);
const monthLabel = (value: string) => monthFormatter.format(new Date(`${dateKey(value)}T00:00:00Z`));

function one<T>(value: MaybeOne<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function statusLabel(status: DueStatus) {
  if (status === "paid") return "Payé";
  if (status === "partial") return "Partiellement payé";
  if (status === "not_concerned") return "Non concerné";
  return "Impayé";
}

function statusClass(status: DueStatus) {
  return `member-contribution-status member-contribution-status-${status}`;
}

export default async function MyContributionsPage() {
  const { supabase, user } = await getSignedInUser();
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Cotisations indisponibles</h1><p>Le projet Supabase doit être raccordé avant l’activation des cotisations.</p></div></section>;
  if (!user) redirect("/connexion?next=%2Fespace-membre%2Fcotisations");

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id,member_number,first_name,last_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) throw new Error("Votre fiche membre n’a pas pu être chargée.");
  if (!member) return <section className="member-space-page section-pad"><div className="container member-space-empty"><h1>Fiche membre non associée</h1><p>Demandez à l’administration de relier votre compte à votre fiche ADEIO.</p><Link href="/espace-membre" className="text-link"><ArrowLeft size={14} /> Retour à mon espace</Link></div></section>;

  // Read only the signed-in member's own dues. RLS also scopes allocations and
  // payment details to this member; no finance-wide RPC or service key is used.
  const pageSize = 500;
  const allDues: Due[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("contribution_dues")
      .select("id,plan_id,period_start,period_end,due_on,amount_due_inr,is_not_concerned,not_concerned_reason,contribution_plans(id,name,amount_inr,currency_code,starts_on,ends_on,executive_term_id,executive_terms(title,starts_on,ends_on)),contribution_allocations!contribution_allocations_due_id_member_id_fkey(amount_inr,contribution_payments!contribution_allocations_payment_id_member_id_fkey(id,paid_on,amount_inr,payment_method,reference,note))")
      .eq("member_id", member.id)
      .eq("currency_code", "INR")
      .order("period_start", { ascending: true })
      .order("due_on", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error("Vos échéances de cotisation n’ont pas pu être chargées.");
    const chunk = (data ?? []) as unknown as Due[];
    allDues.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  const dues: DueView[] = allDues.map((due) => {
    const allocations = due.contribution_allocations ?? [];
    const paid = due.is_not_concerned
      ? 0
      : allocations.reduce((sum, allocation) => sum + Number(allocation.amount_inr ?? 0), 0);
    const expected = due.is_not_concerned ? 0 : Number(due.amount_due_inr ?? 0);
    const remaining = Math.max(0, expected - paid);
    const status: DueStatus = due.is_not_concerned
      ? "not_concerned"
      : remaining === 0
        ? "paid"
        : paid > 0
          ? "partial"
          : "unpaid";
    return { ...due, plan: one(due.contribution_plans), expected, paid, remaining, status };
  });

  const plans = new Map<string, { plan: Plan | null; dues: DueView[] }>();
  for (const due of dues) {
    const key = due.plan_id;
    const group = plans.get(key) ?? { plan: due.plan, dues: [] };
    if (!group.plan && due.plan) group.plan = due.plan;
    group.dues.push(due);
    plans.set(key, group);
  }

  const summary = dues.reduce((totals, due) => {
    totals.expected += due.expected;
    totals.paid += due.paid;
    totals.remaining += due.remaining;
    if (due.status === "paid") totals.paidCount += 1;
    else if (due.status === "partial") totals.partial += 1;
    else if (due.status === "unpaid") totals.unpaid += 1;
    else totals.not_concerned += 1;
    return totals;
  }, { expected: 0, paid: 0, remaining: 0, paidCount: 0, partial: 0, unpaid: 0, not_concerned: 0 } as {
    expected: number; paid: number; remaining: number; paidCount: number; partial: number; unpaid: number; not_concerned: number;
  });

  const paymentMap = new Map<string, PaymentHistory>();
  for (const due of dues) {
    if (due.is_not_concerned) continue;
    for (const allocation of due.contribution_allocations ?? []) {
      const payment = one(allocation.contribution_payments);
      if (!payment) continue;
      const entry = paymentMap.get(payment.id) ?? { ...payment, allocations: [] };
      entry.allocations.push({ date: due.period_start, plan: due.plan?.name ?? "Cotisation ADEIO", amount: Number(allocation.amount_inr ?? 0) });
      paymentMap.set(payment.id, entry);
    }
  }
  const payments = [...paymentMap.values()].sort((a, b) => dateKey(b.paid_on).localeCompare(dateKey(a.paid_on)) || a.reference.localeCompare(b.reference));

  return <section className="member-space-page section-pad"><div className="container member-contributions-page">
    <div className="member-space-heading"><div><div className="eyebrow eyebrow-green">SUIVI PERSONNEL · INR</div><h1>Mes cotisations et arriérés</h1><p>{member.first_name} {member.last_name} · {member.member_number}</p></div><Link href="/espace-membre" className="text-link"><ArrowLeft size={14} /> Mon espace</Link></div>

    <section className="member-contribution-summary" aria-label="Résumé de mes cotisations">
      <article className="member-contribution-summary-card"><span><CircleDollarSign size={17} /> Cotisations attendues</span><strong>{formatInr(summary.expected)}</strong></article>
      <article className="member-contribution-summary-card"><span><CircleCheck size={17} /> Total payé</span><strong>{formatInr(summary.paid)}</strong></article>
      <article className="member-contribution-summary-card"><span><CalendarClock size={17} /> Reste à payer</span><strong>{formatInr(summary.remaining)}</strong></article>
      <article className="member-contribution-summary-card"><span><Banknote size={17} /> Mois payés</span><strong>{summary.paidCount}</strong></article>
      <article className="member-contribution-summary-card"><span><CirclePercent size={17} /> Mois partiels</span><strong>{summary.partial}</strong></article>
      <article className="member-contribution-summary-card"><span><Clock3 size={17} /> Mois impayés</span><strong>{summary.unpaid}</strong></article>
      <article className="member-contribution-summary-card"><span><CircleMinus size={17} /> Non concernés</span><strong>{summary.not_concerned}</strong></article>
    </section>

    <section className="member-contributions-section">
      <div className="member-contributions-section-heading"><div><div className="eyebrow eyebrow-green">PLANS ET ÉCHÉANCES</div><h2>Mes plans de cotisation</h2><p>Les montants et statuts proviennent des échéances et des allocations enregistrées par le Trésorier.</p></div></div>
      {[...plans.entries()].map(([planId, group]) => {
        const term = one(group.plan?.executive_terms ?? null);
        const orderedDues = [...group.dues].sort((a, b) => dateKey(a.period_start).localeCompare(dateKey(b.period_start)));
        return <article className="admin-card member-contribution-plan" key={planId}>
          <header className="member-contribution-plan-heading">
            <div><h3>{group.plan?.name ?? "Plan de cotisation ADEIO"}</h3><p>{term?.title ?? "Mandat du Bureau exécutif"} · {formatFinancialDate(group.plan?.starts_on ?? orderedDues[0].period_start)} – {formatFinancialDate(group.plan?.ends_on ?? orderedDues.at(-1)!.period_end)}</p></div>
            {group.plan?.currency_code === "INR" && group.plan.amount_inr != null && <span className="member-contribution-plan-rate">Tarif mensuel actuel : {formatInr(group.plan.amount_inr)}</span>}
          </header>
          <div className="member-table-scroll"><table className="member-table member-contribution-table"><thead><tr><th>Mois</th><th>Montant attendu</th><th>Montant payé</th><th>Reste à payer</th><th>Statut</th><th>Paiements associés</th></tr></thead><tbody>
            {orderedDues.map((due) => {
              const allocations = due.is_not_concerned ? [] : (due.contribution_allocations ?? []).flatMap((allocation) => {
                const payment = one(allocation.contribution_payments);
                return payment ? [{ payment, amount: Number(allocation.amount_inr ?? 0) }] : [];
              }).sort((a, b) => dateKey(a.payment.paid_on).localeCompare(dateKey(b.payment.paid_on)));
              return <tr key={due.id}>
                <td><strong>{monthLabel(due.period_start)}</strong><small>Échéance : {formatFinancialDate(due.due_on)}</small></td>
                <td>{formatInr(due.expected)}</td><td>{formatInr(due.paid)}</td><td className={due.remaining > 0 ? "finance-amount" : ""}>{formatInr(due.remaining)}</td>
                <td><span className={statusClass(due.status)}>{statusLabel(due.status)}</span>{due.is_not_concerned && due.not_concerned_reason && <small className="member-contribution-reason">Motif : {due.not_concerned_reason}</small>}</td>
                <td>{allocations.length ? <details className="member-contribution-allocation-details"><summary>{allocations.length} paiement{allocations.length > 1 ? "s" : ""}</summary><ul>{allocations.map(({ payment, amount }) => <li key={payment.id}>{formatFinancialDate(payment.paid_on)} · {formatInr(amount)} · {payment.reference}</li>)}</ul></details> : <span className="member-contribution-muted">—</span>}</td>
              </tr>;
            })}
          </tbody></table></div>
        </article>;
      })}
      {!dues.length && <div className="admin-card admin-empty">Aucun plan de cotisation ni aucune échéance n’est encore rattaché à votre fiche. Si vous pensez qu’il s’agit d’une erreur, contactez le Trésorier.</div>}
    </section>

    <section className="admin-card member-contribution-history">
      <div className="admin-card-heading"><div><div className="eyebrow eyebrow-green">OPÉRATIONS ENREGISTRÉES</div><h2><ReceiptText size={18} /> Historique de mes paiements</h2><p>Chaque montant affecté correspond à une allocation enregistrée en base.</p></div></div>
      {payments.length ? <div className="admin-list">{payments.map((payment) => <article className="admin-list-row member-contribution-payment" key={payment.id}>
        <div className="member-contribution-payment-main"><h3>{formatFinancialDate(payment.paid_on)} · {payment.payment_method === "online" ? "Online" : payment.payment_method === "cash" ? "Espèces" : "Mode historique"}</h3><p>Référence {payment.reference}</p><ul>{payment.allocations.map((allocation, index) => <li key={`${payment.id}-${allocation.date}-${index}`}>{monthLabel(allocation.date)} · {allocation.plan} : {formatInr(allocation.amount)}</li>)}</ul>{payment.note && <small>Commentaire : {payment.note}</small>}</div>
        <strong>{formatInr(payment.amount_inr)}</strong>
      </article>)}</div> : <div className="admin-empty">Aucun paiement n’a encore été enregistré pour vos cotisations.</div>}
    </section>
    <p className="member-profile-help">Cet espace est consultatif. Seul le Trésorier peut enregistrer les paiements et modifier l’état des échéances. Pour signaler une erreur, contactez l’administration financière.</p>
  </div></section>;
}
