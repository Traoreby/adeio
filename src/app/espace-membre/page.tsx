import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileText, LockKeyhole, ContactRound, Archive, UserRound } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Espace membre" };

export default async function MemberHomePage() {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Espace membre à configurer</h1><p>Le projet Supabase doit être raccordé avant l’activation des comptes.</p></div></section>;
  if (!user) redirect("/connexion?next=/espace-membre");
  const [{ data: profile }, { data: memberAnnouncements }] = await Promise.all([
    supabase.from("profiles").select("display_name,must_change_password").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("get_visible_announcements", { p_limit: 20 }),
  ]);
  if (profile?.must_change_password) redirect("/mot-de-passe");
  const memberNotices = (memberAnnouncements ?? []) as { id: string; title: string; slug: string; visibility: string }[];
  return <section className="member-home section-pad"><div className="container"><div className="member-welcome"><div><div className="eyebrow eyebrow-green">ESPACE MEMBRE</div><h1>Bonjour{profile?.display_name ? `, ${profile.display_name}` : ""}.</h1><p>Bienvenue dans votre espace ADEIO.</p></div><SignOutButton /></div><div className="member-dashboard-grid"><Card className="member-dashboard-card"><CardContent><span className="pillar-icon"><UserRound size={21} /></span><h2>Mon profil</h2><p>Consultez vos informations et vos périodes de présence à ADEIO.</p><Link href="/espace-membre/profil" className="text-link">Voir ma fiche <ArrowRight size={15} /></Link></CardContent></Card><Card className="member-dashboard-card"><CardContent><span className="pillar-icon"><ContactRound size={21} /></span><h2>Annuaire</h2><p>Retrouvez les membres actuels et leurs numéros ADEIO.</p><Link href="/membres" className="text-link">Consulter l’annuaire <ArrowRight size={15} /></Link></CardContent></Card><Card className="member-dashboard-card"><CardContent><span className="pillar-icon"><Archive size={21} /></span><h2>Archives</h2><p>Consultez les anciennes listes selon les réglages de visibilité.</p><Link href="/archives" className="text-link">Consulter les archives <ArrowRight size={15} /></Link></CardContent></Card><Card className="member-dashboard-card"><CardContent><span className="pillar-icon"><FileText size={21} /></span><h2>Informations ADEIO</h2><p>Les pages publiques et les annonces de l’association sont accessibles à tous.</p><Link href="/actualites" className="text-link">Consulter les actualités <ArrowRight size={15} /></Link></CardContent></Card></div><div className="member-announcements"><div className="member-section-heading"><div><div className="eyebrow eyebrow-green">POUR LES MEMBRES</div><h2>Annonces réservées</h2></div><Link href="/actualites" className="text-link">Voir les actualités <ArrowRight size={15} /></Link></div>{memberNotices.filter((item) => item.visibility === "members").length ? memberNotices.filter((item) => item.visibility === "members").map((item) => <Link className="member-announcement-row" href={`/actualites/${item.slug}`} key={item.id}><span>{item.title}</span><ArrowRight size={15} /></Link>) : <p className="member-empty-note">Aucune annonce réservée aux membres pour le moment.</p>}</div>{roles.some((role) => ["treasurer", "auditor", "admin", "super_admin"].includes(role)) && <Link href="/securite" className="admin-shortcut"><LockKeyhole size={16} /> Configurer l’authentification à deux facteurs</Link>}{roles.includes("admin") || roles.includes("super_admin") ? <Link href="/admin" className="admin-shortcut">Ouvrir l’administration <ArrowRight size={16} /></Link> : null}</div></section>;
}
