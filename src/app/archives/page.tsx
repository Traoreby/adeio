import type { Metadata } from "next";
import Link from "next/link";
import { Archive } from "lucide-react";
import { redirect } from "next/navigation";
import { getSignedInUser } from "@/lib/auth";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";
import { PaginationLinks } from "@/components/pagination-links";

export const metadata: Metadata = { title: "Archives des membres · ADEIO" };
type Props = { searchParams: Promise<{ annee?: string; page?: string }> };

export default async function MemberArchivesPage({ searchParams }: Props) {
  const [{ supabase, user, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Archives indisponibles</h1><p>Le projet Supabase doit être raccordé pour consulter les archives.</p></div></section>;
  if (!user) redirect("/connexion?next=%2Farchives");
  const canManageMembers = roles.includes("admin") || roles.includes("super_admin");
  if (!roles.includes("member") && !canManageMembers) redirect("/espace-membre?erreur=acces-refuse");
  const { data: formerMembersVisible } = canManageMembers
    ? { data: true }
    : await supabase.rpc("setting_enabled", { setting_key: "former_members_visibility" });
  const year = /^\d{4}$/.test(params.annee ?? "") ? params.annee! : "";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const pageSize = 24;
  let ids: string[] | null = null;
  if (year) {
    const { data: periods } = await supabase.from("membership_periods").select("member_id").lte("starts_on", `${year}-12-31`).or(`ends_on.is.null,ends_on.gte.${year}-01-01`);
    ids = [...new Set((periods ?? []).map((period) => period.member_id))];
  }
  let query = supabase.from("members").select("id,member_number,first_name,last_name,joined_year,status", { count: "exact" }).neq("status", "active").order("last_name").order("first_name").range((page - 1) * pageSize, page * pageSize - 1);
  if (ids) query = ids.length ? query.in("id", ids) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  const { data: members, count } = await query;
  return <section className="member-space-page section-pad"><div className="container"><div className="member-space-heading"><div><div className="eyebrow eyebrow-green">MÉMOIRE DE L’ASSOCIATION</div><h1>Archives des membres</h1><p>Les archives des anciens membres sont réservées aux membres connectés et suivent le réglage de visibilité d’ADEIO.</p></div><Archive size={23} /></div><form className="member-search-form"><label className="year-filter-label">Présent en année <input name="annee" type="number" min="1900" max="2200" defaultValue={year} placeholder="Ex. 2024" /></label><button type="submit" className="admin-submit">Filtrer</button>{year && <Link href="/archives" className="text-link">Effacer</Link>}</form><div className="member-archive-list">{members?.map((member) => <article key={member.id}><div><strong>{member.first_name} {member.last_name}</strong><span>{member.member_number} · depuis {member.joined_year}</span></div><span className="status-chip draft">{memberStatusLabels[member.status as MemberStatus]}</span></article>)}</div>{!members?.length && <div className="member-space-empty"><h2>{!canManageMembers && !formerMembersVisible ? "Les archives ne sont pas ouvertes aux membres pour le moment" : year ? "Aucune fiche ne correspond à cette année" : "Aucune fiche d’ancien membre n’a encore été ajoutée"}</h2><p>{!canManageMembers && !formerMembersVisible ? "Un administrateur peut activer leur visibilité dans les paramètres de l’association." : year ? "Essayez une autre année ou effacez le filtre pour voir toutes les archives disponibles." : "Les fiches des anciens membres apparaîtront ici après leur enregistrement dans ADEIO."}</p>{year && <Link href="/archives" className="text-link">Effacer le filtre</Link>}{canManageMembers && <Link href="/admin/membres/nouveau" className="text-link">Ajouter une fiche membre</Link>}</div>}<PaginationLinks pathname="/archives" page={page} hasNext={(count ?? 0) > page * pageSize} query={{ annee: year }} /><Link href="/espace-membre" className="text-link">Retour à mon espace</Link></div></section>;
}
