import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Download, Plus, UsersRound } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";
import { MemberImportForm } from "@/components/member-import-form";
import { PaginationLinks } from "@/components/pagination-links";

export const metadata: Metadata = { title: "Membres · Administration" };
type Props = { searchParams: Promise<{ q?: string; statut?: string; annee?: string; page?: string }> };

export default async function AdminMembersPage({ searchParams }: Props) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const query = (params.q ?? "").trim().replace(/[^\p{L}\p{N}\s-]/gu, " ").slice(0, 80);
  const status = ["active", "former", "suspended", "deceased"].includes(params.statut ?? "") ? params.statut! : "";
  const year = /^\d{4}$/.test(params.annee ?? "") ? params.annee! : "";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const pageSize = 25;
  let memberQuery = supabase.from("members").select("id,member_number,first_name,last_name,joined_year,status,created_at", { count: "exact" }).order("last_name").order("first_name").range((page - 1) * pageSize, page * pageSize - 1);
  if (status) memberQuery = memberQuery.eq("status", status);
  if (query) memberQuery = memberQuery.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,member_number.ilike.%${query}%`);
  if (year) {
    const { data: periods } = await supabase.from("membership_periods").select("member_id").lte("starts_on", `${year}-12-31`).or(`ends_on.is.null,ends_on.gte.${year}-01-01`);
    const ids = [...new Set((periods ?? []).map((period) => period.member_id))];
    memberQuery = ids.length ? memberQuery.in("id", ids) : memberQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  const { data: members, count } = await memberQuery;
  const { data: onboardingRows } = members?.length ? await supabase.from("member_onboarding").select("member_id,kind,status").in("member_id", members.map((member) => member.id)) : { data: [] };
  const pendingMemberIds = new Set((onboardingRows ?? []).filter((row) => row.kind === "new_member" && row.status === "pending").map((row) => row.member_id));
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">FICHES ET ARCHIVES</div><h1>Membres</h1><p>Gérez les fiches, les périodes de présence et les accès associés.</p></div><span className="admin-heading-mark"><UsersRound size={18} /></span></div>
    {params.statut === "membre-supprime" && <div role="status" className="form-success admin-banner">Le compte Auth et les données personnelles du membre ont été supprimés. Aucune écriture financière réelle n’a été supprimée.</div>}
    <div className="admin-toolbar"><form className="admin-filter-form"><input aria-label="Rechercher un membre" name="q" defaultValue={query} placeholder="Nom, prénoms ou numéro ADEIO" /><select aria-label="Filtrer par statut" name="statut" defaultValue={status}><option value="">Tous les statuts</option>{Object.entries(memberStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input aria-label="Présent en année" name="annee" type="number" min="1900" max="2200" defaultValue={year} placeholder="Présent en année" /><button className="admin-submit" type="submit">Filtrer</button></form><Link href="/admin/membres/nouveau" className="admin-submit"><Plus size={15} /> Ajouter un membre</Link></div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2>{count ?? members?.length ?? 0} fiche(s) membre</h2><p>25 fiches par page. Les coordonnées restent dans la fiche restreinte.</p></div><a className="text-link" href="/templates/adeio-members-template.csv" download><Download size={15} /> Modèle CSV</a></div><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Numéro</th><th>Nom</th><th>Année d’entrée</th><th>Statut</th><th></th></tr></thead><tbody>{members?.map((member) => { const awaiting = pendingMemberIds.has(member.id); return <tr key={member.id}><td>{member.member_number}</td><td><strong>{member.first_name} {member.last_name}</strong></td><td>{member.joined_year}</td><td><span className={`status-chip ${member.status === "active" && !awaiting ? "" : "draft"}`}>{awaiting ? "En attente de complétion" : memberStatusLabels[member.status as MemberStatus] ?? "Statut inconnu"}</span></td><td><Link href={`/admin/membres/${member.id}`} className="text-link">Ouvrir <ArrowRight size={14} /></Link></td></tr>; })}</tbody></table></div>{!members?.length && <div className="admin-empty">Aucun membre ne correspond à ces critères.</div>}<PaginationLinks pathname="/admin/membres" page={page} hasNext={(count ?? 0) > page * pageSize} query={{ q: query, statut: status, annee: year }} /></div>
    <div className="admin-card"><h2>Import groupé</h2><MemberImportForm /></div>
  </>;
}
