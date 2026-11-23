import Link from "next/link";
import { ArrowRight, CalendarDays, Newspaper, UsersRound } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { formatDate } from "@/lib/utils";

export default async function AdminDashboardPage() {
  const { supabase } = await getSignedInUser();
  if (!supabase) return null;
  const [{ count: memberCount }, { data: announcements }, { data: term }] = await Promise.all([
    supabase.from("members").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("announcements").select("id,title,is_published,created_at").order("created_at", { ascending: false }).limit(4),
    supabase.from("executive_terms").select("title,starts_on").eq("is_current", true).maybeSingle(),
  ]);
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">TABLEAU DE BORD</div><h1>Vue d’ensemble</h1><p>Les repères essentiels de l’administration ADEIO.</p></div></div>
    <div className="admin-stats"><div className="admin-stat"><span><UsersRound size={13} /> Membres actifs</span><strong>{memberCount ?? "—"}</strong></div><div className="admin-stat"><span><Newspaper size={13} /> Annonces publiées</span><strong>{announcements?.filter((item) => item.is_published).length ?? 0}</strong></div><div className="admin-stat"><span><CalendarDays size={13} /> Mandat en cours</span><strong>{term?.starts_on ? new Date(term.starts_on).getFullYear() : "À définir"}</strong></div></div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2>Dernières annonces</h2><p>Création et publication des informations officielles.</p></div><Link href="/admin/annonces" className="text-link">Gérer les annonces <ArrowRight size={15} /></Link></div><div className="admin-list">{announcements?.length ? announcements.map((item) => <div className="admin-list-row" key={item.id}><div><h3>{item.title}</h3><p>Créée le {formatDate(item.created_at)}</p></div><span className={`status-chip ${item.is_published ? "" : "draft"}`}>{item.is_published ? "Publiée" : "Brouillon"}</span></div>) : <div className="admin-empty">Aucune annonce créée pour le moment.</div>}</div></div>
    <div className="admin-card"><h2>À compléter pour la mise en service</h2><p>Ajoutez la composition validée du bureau, configurez les coordonnées officielles et invitez les premiers comptes via Supabase Auth.</p><Link href="/admin/bureau" className="text-link">Configurer le bureau exécutif <ArrowRight size={15} /></Link></div>
  </>;
}
