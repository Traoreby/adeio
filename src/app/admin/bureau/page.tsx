import type { Metadata } from "next";
import { ArrowUpRight, CalendarDays, UserPlus, UsersRound } from "lucide-react";
import { assignExecutiveMemberAction, removeExecutiveMemberAction, startExecutiveTermAction } from "@/app/admin/actions";
import { getSignedInUser } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Administration du bureau" };

type PageProps = { searchParams: Promise<{ statut?: string; erreur?: string }> };
type ExecutiveAssignment = {
  id: string;
  biography: string | null;
  sort_order: number;
  position: { title: string } | { title: string }[] | null;
  member: { first_name: string; last_name: string; member_number: string } | { first_name: string; last_name: string; member_number: string }[] | null;
};

const messages: Record<string, string> = {
  "mandat-cree": "Le nouveau mandat a été créé. Vous pouvez maintenant lui attribuer des membres.",
  "affectation-ajoutee": "La fonction a été attribuée.",
  "affectation-retiree": "L’affectation a été retirée.",
};
const errors: Record<string, string> = {
  "formulaire-invalide": "Vérifiez les dates et les champs du formulaire.",
  "creation-impossible": "Le mandat n’a pas pu être créé.",
  "fonction-deja-attribuee": "Cette fonction est déjà attribuée dans ce mandat.",
  "affectation-impossible": "L’affectation n’a pas pu être enregistrée.",
  "suppression-impossible": "L’affectation n’a pas pu être retirée.",
};

export default async function AdminBureauPage({ searchParams }: PageProps) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const [{ data: terms }, { data: positions }, { data: members }] = await Promise.all([
    supabase.from("executive_terms").select("id,title,starts_on,ends_on,is_current").order("starts_on", { ascending: false }),
    supabase.from("executive_positions").select("id,title,sort_order,is_active").eq("is_active", true).order("sort_order"),
    supabase.from("members").select("id,first_name,last_name,member_number").eq("status", "active").order("last_name"),
  ]);
  const currentTerm = terms?.find((term) => term.is_current) ?? null;
  const assignmentResult = currentTerm ? await supabase.from("executive_members").select("id,biography,sort_order,position:executive_positions(title),member:members(first_name,last_name,member_number)").eq("term_id", currentTerm.id).order("sort_order") : { data: [] };
  const assignments = (assignmentResult.data ?? []) as ExecutiveAssignment[];
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">GOUVERNANCE</div><h1>Bureau exécutif</h1><p>Créez un mandat et attribuez les postes aux membres enregistrés.</p></div><span className="admin-heading-mark"><UsersRound size={18} /></span></div>
    {params.statut && messages[params.statut] && <div role="status" className="form-alert success-alert admin-banner">{messages[params.statut]}</div>}
    {params.erreur && <div role="alert" className="form-alert error-alert admin-banner">{errors[params.erreur] ?? "Une erreur est survenue."}</div>}
    <div className="admin-card"><h2>Mandat en cours</h2>{currentTerm ? <div className="term-summary"><span className="status-chip">En cours</span><div><strong>{currentTerm.title}</strong><p>Du {formatDate(currentTerm.starts_on)}{currentTerm.ends_on ? ` au ${formatDate(currentTerm.ends_on)}` : " · sans date de fin enregistrée"}</p></div></div> : <div className="admin-empty">Aucun mandat en cours. Créez le mandat validé par l’association.</div>}</div>
    <div className="admin-card"><h2><CalendarDays size={16} /> Renouveler le bureau</h2><p>La création d’un mandat clôture automatiquement celui qui est en cours et conserve son historique.</p><form action={startExecutiveTermAction} className="admin-form"><div className="admin-form-grid"><div><label htmlFor="term-title">Nom du mandat</label><input id="term-title" name="title" required maxLength={120} placeholder="Ex. Bureau 2026–2028" /></div><div><label htmlFor="term-start">Date de début</label><input id="term-start" name="starts_on" type="date" required /></div></div><div className="admin-form-grid"><div><label htmlFor="term-end">Date de fin (facultative)</label><input id="term-end" name="ends_on" type="date" /></div><div className="form-helper">Les fonctions pourront ensuite être attribuées aux membres actifs enregistrés.</div></div><Button type="submit" className="admin-submit">Créer le mandat <ArrowUpRight size={15} /></Button></form></div>
    {currentTerm && <div className="admin-card"><h2><UserPlus size={16} /> Ajouter une fonction au mandat en cours</h2>{members?.length && positions?.length ? <form action={assignExecutiveMemberAction} className="admin-form"><input type="hidden" name="term_id" value={currentTerm.id} /><div className="admin-form-grid"><div><label htmlFor="executive-member">Membre</label><select id="executive-member" name="member_id" required defaultValue=""><option value="" disabled>Choisir un membre</option>{members.map((member) => <option key={member.id} value={member.id}>{member.first_name} {member.last_name} · {member.member_number}</option>)}</select></div><div><label htmlFor="executive-position">Fonction</label><select id="executive-position" name="position_id" required defaultValue=""><option value="" disabled>Choisir une fonction</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}</select></div></div><Button type="submit" className="admin-submit">Attribuer la fonction <ArrowUpRight size={15} /></Button></form> : <div className="admin-banner">Ajoutez d’abord des membres actifs dans Administration → Membres et configurez les fonctions de référence dans Supabase.</div>}
      <div className="admin-list admin-assignments">{assignments.length ? assignments.map((assignment) => { const position = Array.isArray(assignment.position) ? assignment.position[0] : assignment.position; const member = Array.isArray(assignment.member) ? assignment.member[0] : assignment.member; return <div className="admin-list-row" key={assignment.id}><div><h3>{position?.title ?? "Fonction"}</h3><p>{[member?.first_name, member?.last_name].filter(Boolean).join(" ")} · {member?.member_number}</p></div><form action={removeExecutiveMemberAction}><input type="hidden" name="id" value={assignment.id} /><button className="text-action danger-action" type="submit">Retirer</button></form></div>; }) : <div className="admin-empty">Aucune fonction attribuée pour le moment.</div>}</div>
    </div>}
    <div className="admin-card"><h2>Historique des mandats</h2><div className="admin-list">{terms?.length ? terms.map((term) => <div className="admin-list-row" key={term.id}><div><h3>{term.title}</h3><p>{formatDate(term.starts_on)}{term.ends_on ? ` – ${formatDate(term.ends_on)}` : " – en cours"}</p></div><span className={`status-chip ${term.is_current ? "" : "draft"}`}>{term.is_current ? "En cours" : "Archivé"}</span></div>) : <div className="admin-empty">L’historique apparaîtra après la création du premier mandat.</div>}</div></div>
  </>;
}
