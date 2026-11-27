import type { Metadata } from "next";
import { ArrowUpRight, CalendarDays, UserPlus, UsersRound } from "lucide-react";
import { assignExecutiveMemberAction, removeExecutiveMemberAction } from "@/app/admin/actions";
import { ExecutiveTermForm } from "@/components/executive-term-form";
import { getSignedInUser } from "@/lib/auth";
import { getExecutiveTermEnd, getExecutiveTermStatus, getIndiaDateString } from "@/lib/executive-terms";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Administration du bureau" };

type PageProps = { searchParams: Promise<{ statut?: string; erreur?: string }> };
type ExecutiveAssignment = {
  id: string;
  term_id: string;
  biography: string | null;
  sort_order: number;
  position: { title: string } | { title: string }[] | null;
  member: { first_name: string; last_name: string; member_number: string } | { first_name: string; last_name: string; member_number: string }[] | null;
};

const messages: Record<string, string> = {
  "mandat-cree": "Le mandat a été créé avec ses dates calculées. Vous pouvez maintenant attribuer les postes.",
  "affectation-ajoutee": "La fonction a été attribuée.",
  "affectation-retiree": "L’affectation a été retirée.",
};
const errors: Record<string, string> = {
  "formulaire-invalide": "Saisissez une date de début valide.",
  "creation-impossible": "Le mandat n’a pas pu être créé. Vérifiez vos droits et réessayez.",
  "chevauchement-mandats": "Les dates chevauchent un autre mandat. Vérifiez l’historique avant de continuer.",
  "fonction-deja-attribuee": "Cette fonction est déjà attribuée dans ce mandat.",
  "affectation-impossible": "L’affectation n’a pas pu être enregistrée.",
  "suppression-impossible": "L’affectation n’a pas pu être retirée.",
  "historique-protege": "Les affectations d’un mandat terminé sont conservées dans l’historique.",
};

function relationOne<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function AdminBureauPage({ searchParams }: PageProps) {
  const [{ supabase, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const today = getIndiaDateString();
  const [{ data: terms }, { data: positions }, { data: members }] = await Promise.all([
    supabase.from("executive_terms").select("id,title,starts_on,ends_on,is_current").order("starts_on", { ascending: false }),
    supabase.from("executive_positions").select("id,title,sort_order,is_active").eq("is_active", true).order("sort_order"),
    supabase.from("members").select("id,first_name,last_name,member_number").eq("status", "active").gte("exit_year", Number(today.slice(0, 4))).order("last_name"),
  ]);
  const termRows = terms ?? [];
  const statuses = new Map(termRows.map((term) => [term.id, getExecutiveTermStatus(term.starts_on, term.ends_on, today)]));
  const currentTerm = termRows.find((term) => statuses.get(term.id) === "current") ?? null;
  const nextTerm = termRows.filter((term) => statuses.get(term.id) === "upcoming").sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0] ?? null;
  const assignmentTerm = currentTerm ?? nextTerm;
  const { data: assignmentRows } = termRows.length
    ? await supabase.from("executive_members").select("id,term_id,biography,sort_order,position:executive_positions(title),member:members(first_name,last_name,member_number)").in("term_id", termRows.map((term) => term.id)).order("sort_order")
    : { data: [] };
  const assignments = (assignmentRows ?? []) as ExecutiveAssignment[];
  const canCreateTerm = roles.includes("super_admin");

  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">GOUVERNANCE</div><h1>Bureau exécutif</h1><p>Mandats de 12 mois, postes attribués par période et historique conservé.</p></div><span className="admin-heading-mark"><UsersRound size={18} /></span></div>
    {params.statut && messages[params.statut] && <div role="status" className="form-alert success-alert admin-banner">{messages[params.statut]}</div>}
    {params.erreur && <div role="alert" className="form-alert error-alert admin-banner">{errors[params.erreur] ?? "Une erreur est survenue."}</div>}

    <div className="admin-card"><h2>Mandat en cours</h2>{currentTerm ? <div className="term-summary"><span className="status-chip">En cours</span><div><strong>{currentTerm.title}</strong><p>Du {formatDate(currentTerm.starts_on)} au {formatDate(currentTerm.ends_on ?? getExecutiveTermEnd(currentTerm.starts_on))}</p></div></div> : <div className="admin-empty">Aucun mandat en cours aujourd’hui.</div>}</div>

    {canCreateTerm && <div className="admin-card"><h2><CalendarDays size={16} /> Créer un mandat de 12 mois</h2><p>Le mandat précédent et ses affectations restent consultables dans l’historique.</p><ExecutiveTermForm /></div>}

    {assignmentTerm && <div className="admin-card">
      <h2><UserPlus size={16} /> Attribuer les postes · {assignmentTerm.title}</h2>
      {members?.length && positions?.length ? <form action={assignExecutiveMemberAction} className="admin-form"><input type="hidden" name="term_id" value={assignmentTerm.id} /><div className="admin-form-grid"><div><label htmlFor="executive-member">Membre</label><select id="executive-member" name="member_id" required defaultValue=""><option value="" disabled>Choisir un membre actif</option>{members.map((member) => <option key={member.id} value={member.id}>{member.first_name} {member.last_name} · {member.member_number}</option>)}</select></div><div><label htmlFor="executive-position">Fonction</label><select id="executive-position" name="position_id" required defaultValue=""><option value="" disabled>Choisir une fonction</option>{positions.map((position) => <option key={position.id} value={position.id}>{position.title}</option>)}</select></div></div><Button type="submit" className="admin-submit">Attribuer la fonction <ArrowUpRight size={15} /></Button></form> : <div className="admin-banner">Ajoutez d’abord des membres actifs éligibles et configurez les fonctions de référence.</div>}
      <div className="admin-list admin-assignments">{assignments.filter((assignment) => assignment.term_id === assignmentTerm.id).length ? assignments.filter((assignment) => assignment.term_id === assignmentTerm.id).map((assignment) => { const position = relationOne(assignment.position); const member = relationOne(assignment.member); return <div className="admin-list-row" key={assignment.id}><div><h3>{position?.title ?? "Fonction"}</h3><p>{[member?.first_name, member?.last_name].filter(Boolean).join(" ")} · {member?.member_number}</p></div><form action={removeExecutiveMemberAction}><input type="hidden" name="id" value={assignment.id} /><button className="text-action danger-action" type="submit">Retirer</button></form></div>; }) : <div className="admin-empty">Aucune fonction attribuée pour ce mandat.</div>}</div>
    </div>}

    <div className="admin-card"><h2>Historique des mandats et des compositions</h2><div className="admin-list">{termRows.length ? termRows.map((term) => {
      const termAssignments = assignments.filter((assignment) => assignment.term_id === term.id);
      const status = statuses.get(term.id);
      const statusLabel = status === "current" ? "En cours" : status === "upcoming" ? "À venir" : "Terminé";
      return <section className="admin-list-row executive-term-history" key={term.id}><div><h3>{term.title}</h3><p>Du {formatDate(term.starts_on)} au {formatDate(term.ends_on ?? getExecutiveTermEnd(term.starts_on))}</p>{termAssignments.length ? <ul className="executive-history-roster">{termAssignments.map((assignment) => { const position = relationOne(assignment.position); const member = relationOne(assignment.member); return <li key={assignment.id}><strong>{position?.title ?? "Fonction"}</strong><span>{[member?.first_name, member?.last_name].filter(Boolean).join(" ")} · {member?.member_number}</span></li>; })}</ul> : <p>Aucune affectation enregistrée.</p>}</div><span className={`status-chip ${status === "ended" ? "draft" : ""}`}>{statusLabel}</span></section>;
    }) : <div className="admin-empty">L’historique apparaîtra après la création du premier mandat.</div>}</div></div>
  </>;
}
