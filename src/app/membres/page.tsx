import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Search, UserRound } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { getConsentedMemberPhotoUrl } from "@/lib/supabase/service";
import { memberStatusLabels } from "@/lib/members";

export const metadata: Metadata = { title: "Annuaire des membres · ADEIO" };
type Props = { searchParams: Promise<{ q?: string; annee?: string }> };

export default async function MemberDirectoryPage({ searchParams }: Props) {
  const [{ supabase, user, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Annuaire indisponible</h1><p>Le projet Supabase doit être raccordé avant l’activation des données membres.</p></div></section>;
  if (!user) redirect("/connexion?next=%2Fmembres");
  if (!roles.includes("member")) redirect("/espace-membre?erreur=acces-refuse");
  const query = (params.q ?? "").trim().replace(/[^\p{L}\p{N}\s-]/gu, " ").slice(0, 80);
  const year = /^\d{4}$/.test(params.annee ?? "") ? params.annee! : "";
  let ids: string[] | null = null;
  if (year) {
    const { data: periods } = await supabase.from("membership_periods").select("member_id").lte("starts_on", `${year}-12-31`).or(`ends_on.is.null,ends_on.gte.${year}-01-01`);
    ids = [...new Set((periods ?? []).map((period) => period.member_id))];
  }
  let memberQuery = supabase.from("members").select("id,member_number,first_name,last_name,joined_year,status,photo_path,photo_public_consent").eq("status", "active").order("last_name").limit(100);
  if (query) memberQuery = memberQuery.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,member_number.ilike.%${query}%`);
  if (ids) memberQuery = ids.length ? memberQuery.in("id", ids) : memberQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  const { data: members } = await memberQuery;
  const cards = await Promise.all((members ?? []).map(async (member) => ({ ...member, photoUrl: member.photo_public_consent ? await getConsentedMemberPhotoUrl(member.photo_path) : null })));
  return <section className="member-space-page section-pad"><div className="container"><div className="member-space-heading"><div><div className="eyebrow eyebrow-green">COMMUNAUTÉ ADEIO</div><h1>Annuaire des membres</h1><p>Annuaire réservé aux membres connectés. Les coordonnées personnelles n’y figurent pas.</p></div><Link href="/espace-membre" className="text-link">Mon espace membre</Link></div>
    <form className="member-search-form"><label><Search size={17} /><input name="q" defaultValue={query} placeholder="Rechercher par nom ou numéro ADEIO" aria-label="Rechercher un membre" /></label><label className="year-filter-label">Présent en année <input name="annee" type="number" min="1900" max="2200" defaultValue={year} placeholder="Ex. 2024" /></label><button type="submit" className="admin-submit">Rechercher</button></form>
    <div className="member-directory-grid">{cards.map((member) => <article className="member-directory-card" key={member.id}><div className="member-directory-avatar">{member.photoUrl ? <Image src={member.photoUrl} alt={`Photo de ${member.first_name} ${member.last_name}`} fill sizes="72px" /> : <UserRound size={28} />}</div><div><span className="status-chip">{memberStatusLabels.active}</span><h2>{member.first_name} {member.last_name}</h2><p>{member.member_number}</p><small>Membre depuis {member.joined_year}</small></div></article>)}</div>
    {!cards.length && <div className="member-space-empty">Aucun membre actif ne correspond à votre recherche.</div>}
    <p className="member-directory-footnote">Affichage limité aux 100 premiers résultats. Pour toute correction de vos propres informations, contactez l’administration ADEIO.</p>
  </div></section>;
}
