import type { Metadata } from "next";
import Link from "next/link";
import { Archive, ArrowRight } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";

export const metadata: Metadata = { title: "Archives des membres · Administration" };
type Props = { searchParams: Promise<{ annee?: string }> };

export default async function AdminArchivesPage({ searchParams }: Props) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const year = /^\d{4}$/.test(params.annee ?? "") ? params.annee! : "";
  const { data: periods } = year ? await supabase.from("membership_periods").select("member_id").lte("starts_on", `${year}-12-31`).or(`ends_on.is.null,ends_on.gte.${year}-01-01`) : { data: null };
  let query = supabase.from("members").select("id,member_number,first_name,last_name,joined_year,status").in("status", ["former", "suspended", "deceased"]).order("last_name").limit(100);
  if (year) { const ids = [...new Set((periods ?? []).map((period) => period.member_id))]; query = ids.length ? query.in("id", ids) : query.eq("id", "00000000-0000-0000-0000-000000000000"); }
  const { data: members } = await query;
  return <><div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">MÉMOIRE DE L’ASSOCIATION</div><h1>Archives des membres</h1><p>Retrouvez les membres anciens, suspendus ou décédés par année de présence.</p></div><span className="admin-heading-mark"><Archive size={18} /></span></div><div className="admin-card"><form className="admin-filter-form"><label htmlFor="archive-year">Présent en année</label><input id="archive-year" name="annee" type="number" min="1900" max="2200" defaultValue={year} placeholder="Ex. 2024" /><button className="admin-submit" type="submit">Filtrer</button><Link href="/admin/archives" className="text-link">Effacer</Link></form><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Membre</th><th>Numéro</th><th>Entrée</th><th>Statut</th><th></th></tr></thead><tbody>{members?.map((member) => <tr key={member.id}><td>{member.first_name} {member.last_name}</td><td>{member.member_number}</td><td>{member.joined_year}</td><td>{memberStatusLabels[member.status as MemberStatus]}</td><td><Link href={`/admin/membres/${member.id}`} className="text-link">Ouvrir <ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div>{!members?.length && <div className="admin-empty">Aucune fiche archivée ne correspond à ce filtre.</div>}</div></>;
}
