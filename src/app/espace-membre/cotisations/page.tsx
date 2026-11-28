import Link from "next/link";
import { ArrowLeft, Banknote, CalendarClock, CircleCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { getSignedInUser } from "@/lib/auth";
import { formatFinancialDate, formatInr } from "@/lib/finance";

export default async function MyContributionsPage() {
  const { supabase, user } = await getSignedInUser();
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Cotisations indisponibles</h1><p>Le projet Supabase doit être raccordé avant l’activation des cotisations.</p></div></section>;
  if (!user) redirect("/connexion?next=%2Fespace-membre%2Fcotisations");
  const { data: member } = await supabase.from("members").select("id,member_number,first_name,last_name").eq("user_id", user.id).maybeSingle();
  if (!member) return <section className="member-space-page section-pad"><div className="container member-space-empty"><h1>Fiche membre non associée</h1><p>Demandez à l’administration de relier votre compte à votre fiche ADEIO.</p><Link href="/espace-membre" className="text-link"><ArrowLeft size={14} /> Retour à mon espace</Link></div></section>;
  const { data: dues } = await supabase.from("contribution_dues").select("id,period_start,period_end,due_on,amount_due_inr,is_not_concerned,contribution_plans(name),contribution_allocations(amount_inr,contribution_payments(paid_on))").eq("member_id", member.id).eq("currency_code", "INR").order("due_on", { ascending: false }).limit(480);
  const rows = (dues ?? []).map((due) => {
    const paid = due.is_not_concerned ? 0 : (due.contribution_allocations ?? []).reduce((sum, allocation) => sum + Number(allocation.amount_inr ?? 0), 0);
    const amountDue = due.is_not_concerned ? 0 : Number(due.amount_due_inr ?? 0);
    return { ...due, amountDue, paid, remaining: Math.max(0, amountDue - paid) };
  });
  const total = (key: "amountDue" | "paid" | "remaining") => rows.reduce((sum, due) => sum + due[key], 0);
  const unpaidMonths = rows.filter((due) => due.remaining > 0).length;

  const renderRows = (list: typeof rows, formatter: (value: number) => string) => list.map((due) => <tr key={due.id}><td>{due.contribution_plans?.[0]?.name ?? "Cotisation"}</td><td>{formatFinancialDate(due.period_start)} – {formatFinancialDate(due.period_end)}</td><td>{formatFinancialDate(due.due_on)}</td><td>{formatter(due.amountDue)}</td><td>{formatter(due.paid)}</td><td className={due.remaining > 0 ? "finance-amount" : ""}>{formatter(due.remaining)}</td><td><span className={`status-chip ${due.is_not_concerned ? "" : due.remaining > 0 ? "draft" : ""}`}>{due.is_not_concerned ? "Non concerné" : due.remaining > 0 ? due.paid ? "Partiellement payée" : "À régler" : "Payée"}</span></td></tr>);

  return <section className="member-space-page section-pad"><div className="container">
    <div className="member-space-heading"><div><div className="eyebrow eyebrow-green">SUIVI PERSONNEL</div><h1>Mes cotisations</h1><p>{member.first_name} {member.last_name} · {member.member_number}</p></div><Link href="/espace-membre" className="text-link"><ArrowLeft size={14} /> Mon espace</Link></div>
    <div className="admin-stats finance-stats"><div className="admin-stat"><span>Montant dû</span><strong>{formatInr(total("amountDue"))}</strong></div><div className="admin-stat"><span><CircleCheck size={13} /> Montant payé</span><strong>{formatInr(total("paid"))}</strong></div><div className="admin-stat"><span><CalendarClock size={13} /> Reste · {unpaidMonths} mois</span><strong>{formatInr(total("remaining"))}</strong></div></div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2><Banknote size={16} /> Mes échéances</h2><p>Les montants sont regroupés par échéance mensuelle.</p></div></div><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Plan</th><th>Mois</th><th>Échéance</th><th>Dû</th><th>Payé</th><th>Reste</th><th>État</th></tr></thead><tbody>{renderRows(rows, formatInr)}</tbody></table></div>{!rows.length && <div className="admin-empty">Aucune échéance n’a encore été créée pour votre fiche.</div>}</div>
    <p className="member-profile-help">Seuls vous et les rôles financiers habilités peuvent consulter le détail de vos échéances et paiements. Pour signaler une erreur, contactez le trésorier.</p>
  </div></section>;
}
