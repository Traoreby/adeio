import Link from "next/link";
import { ArrowRight, CalendarDays, Newspaper, UsersRound } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { deleteStorageOrphanAction } from "@/app/admin/storage-actions";

type Props = { searchParams: Promise<{ stockage?: string }> };
type StorageUsage = { bucket_id: string; used_bytes: number; object_count: number; alert_threshold_bytes: number };
type StorageOrphan = { bucket_id: "member-photos" | "financial-attachments" | "financial-reports"; object_name: string; size_bytes: number; created_at: string };

export default async function AdminDashboardPage({ searchParams }: Props) {
  const [{ supabase, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const [{ count: memberCount }, { data: announcements }, { data: term }] = await Promise.all([
    supabase.from("members").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("announcements").select("id,title,is_published,created_at").order("created_at", { ascending: false }).limit(4),
    supabase.from("executive_terms").select("title,starts_on").eq("is_current", true).maybeSingle(),
  ]);
  let storageUsage: StorageUsage[] = [];
  let storageOrphans: StorageOrphan[] = [];
  let storageAvailable = false;
  if (roles.includes("super_admin")) {
    const [{ data: usage, error: usageError }, { data: orphans, error: orphanError }] = await Promise.all([
      supabase.rpc("get_adeio_storage_usage"),
      supabase.rpc("get_adeio_storage_orphans", { p_limit: 25 }),
    ]);
    storageAvailable = !usageError && !orphanError;
    storageUsage = (usage ?? []) as StorageUsage[];
    storageOrphans = (orphans ?? []) as StorageOrphan[];
  }
  const storageStatus: Record<string, string> = {
    nettoye: "Le fichier orphelin a été supprimé.",
    "plus-orphelin": "Le fichier est maintenant référencé ou n’existe plus; aucun objet n’a été supprimé.",
    "suppression-impossible": "Le fichier n’a pas pu être supprimé.",
    erreur: "La demande de suppression n’est pas valide.",
  };
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">TABLEAU DE BORD</div><h1>Vue d’ensemble</h1><p>Les repères essentiels de l’administration ADEIO.</p></div></div>
    <div className="admin-stats"><div className="admin-stat"><span><UsersRound size={13} /> Membres actifs</span><strong>{memberCount ?? "—"}</strong></div><div className="admin-stat"><span><Newspaper size={13} /> Annonces publiées</span><strong>{announcements?.filter((item) => item.is_published).length ?? 0}</strong></div><div className="admin-stat"><span><CalendarDays size={13} /> Mandat en cours</span><strong>{term?.starts_on ? new Date(term.starts_on).getFullYear() : "À définir"}</strong></div></div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2>Dernières annonces</h2><p>Création et publication des informations officielles.</p></div><Link href="/admin/annonces" className="text-link">Gérer les annonces <ArrowRight size={15} /></Link></div><div className="admin-list">{announcements?.length ? announcements.map((item) => <div className="admin-list-row" key={item.id}><div><h3>{item.title}</h3><p>Créée le {formatDate(item.created_at)}</p></div><span className={`status-chip ${item.is_published ? "" : "draft"}`}>{item.is_published ? "Publiée" : "Brouillon"}</span></div>) : <div className="admin-empty">Aucune annonce créée pour le moment.</div>}</div></div>
    {roles.includes("super_admin") && <div className="admin-card storage-admin-card"><h2>Espace de stockage Supabase</h2><p>Usage suivi sur les buckets privés de photos, justificatifs et anciens bilans PDF. Chaque alerte se déclenche à 70 % du seuil de suivi de 1 Go.</p>{params.stockage && storageStatus[params.stockage] && <p role={params.stockage === "nettoye" ? "status" : "alert"} className={params.stockage === "nettoye" ? "form-success" : "form-error"}>{storageStatus[params.stockage]}</p>}{!storageAvailable ? <div className="admin-empty">Le suivi sera disponible après application de la migration de stockage.</div> : <><div className="storage-usage-grid">{storageUsage.map((bucket) => { const used = Number(bucket.used_bytes) || 0; const threshold = Number(bucket.alert_threshold_bytes) || 1_073_741_824; const percent = Math.min(100, used / threshold * 100); const label = bucket.bucket_id === "member-photos" ? "Photos des membres" : bucket.bucket_id === "financial-attachments" ? "Justificatifs financiers" : "Bilans PDF historiques"; return <div className="storage-usage-item" key={bucket.bucket_id}><div><strong>{label}</strong><span>{(used / 1_048_576).toFixed(1)} Mo / 1 024 Mo · {Number(bucket.object_count) || 0} fichier(s)</span></div><div className="storage-meter" role="progressbar" aria-label={`Espace utilisé par ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span className={percent >= 70 ? "is-warning" : ""} style={{ width: `${percent}%` }} /></div>{percent >= 70 && <strong className="storage-warning">Alerte · {Math.round(percent)} % utilisés</strong>}</div>; })}</div><p className="storage-admin-help">Vous pouvez aussi consulter les valeurs détaillées dans Supabase, rubrique Usage puis Storage.</p><h3>Fichiers orphelins repérés (25 maximum)</h3>{storageOrphans.length ? <div className="admin-list">{storageOrphans.map((file) => <div className="admin-list-row storage-orphan-row" key={`${file.bucket_id}/${file.object_name}`}><div><strong>{file.bucket_id}</strong><p title={file.object_name}>{file.object_name}</p><small>{Math.ceil(Number(file.size_bytes) / 1000)} Ko · {formatDate(file.created_at)}</small></div><form action={deleteStorageOrphanAction}><input type="hidden" name="bucket" value={file.bucket_id} /><input type="hidden" name="name" value={file.object_name} /><button className="text-action danger-action" type="submit">Supprimer l’orphelin</button></form></div>)}</div> : <div className="admin-empty">Aucun fichier orphelin trouvé dans ces buckets.</div>}</>}</div>}
    <div className="admin-card"><h2>À compléter pour la mise en service</h2><p>Ajoutez la composition validée du bureau, configurez les coordonnées officielles et invitez les premiers comptes via Supabase Auth.</p><Link href="/admin/bureau" className="text-link">Configurer le bureau exécutif <ArrowRight size={15} /></Link></div>
  </>;
}
