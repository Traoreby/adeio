import type { Metadata } from "next";
import Link from "next/link";
import { Archive } from "lucide-react";
import { redirect } from "next/navigation";
import { getSignedInUser } from "@/lib/auth";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";

export const metadata: Metadata = { title: "Archives des membres · ADEIO" };
type Props = { searchParams: Promise<{ annee?: string }> };

export default async function MemberArchivesPage({ searchParams }: Props) {
  const [{ supabase, user, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Archives indisponibles</h1><p>Le projet Supabase doit être raccordé pour consulter les archives.</p></div></section>;
  if (!user) redirect("/connexion?next=%2Farchives");
  if (!roles.includes("member")) redirect("/espace-membre?erreur=acces-refuse");
  const year = /^\d{4}$/.test(params.annee ?? "") ? params.annee! : "";
  let ids: string[] | null = null;
  if (year) {
    const { data: periods } = await supabase.from("membership_periods").select("member_id").lte("starts_on", `${year}-12-31`).or(`ends_on.is.null,ends_on.gte.${year}-01-01`);
    ids = [...new Set((periods ?? []).map((period) => period.member_id))];
  }
  let query = supabase.from("members").select("id,member_number,first_name,last_name,joined_year,status").neq("status", "active").order("last_name").limit(100);
  if (ids) query = ids.length ? query.in("id", ids) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  const { data: members } = await query;
  return <section className="member-space-page section-pad"><div className="container"><div className="member-space-heading"><div><div className="eyebrow eyebrow-green">MÉMOIRE DE L’ASSOCIATION</div><h1>Archives des membres</h1><p>Les archives sont visibles aux membres connectés selon le réglage de l’association.</p></div><Archive size={23} /></div><form className="member-search-form"><label className="year-filter-label">Présent en année <input name="annee" type="number" min="1900" max="2200" defaultValue={year} placeholder="Ex. 2024" /></label><button type="submit" className="admin-submit">Filtrer</button></form><div className="member-archive-list">{members?.map((member) => <article key={member.id}><div><strong>{member.first_name} {member.last_name}</strong><span>{member.member_number} · depuis {member.joined_year}</span></div><span className="status-chip draft">{memberStatusLabels[member.status as MemberStatus]}</span></article>)}</div>{!members?.length && <div className="member-space-empty"><h2>Les archives ne sont pas accessibles pour le moment.</h2><p>La visibilité des anciens membres est désactivée ou aucune fiche ne correspond à ce filtre.</p></div>}<Link href="/espace-membre" className="text-link">Retour à mon espace</Link></div></section>;
}
