import { redirect } from "next/navigation";
import { getSignedInUser } from "@/lib/auth";
import { PaginationLinks } from "@/components/pagination-links";
import { formatFinancialDate } from "@/lib/finance";

type Props = { searchParams: Promise<{ page?: string }> };

export default async function AuditPage({ searchParams }: Props) {
  const [{ supabase, user, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase || !user) redirect("/connexion?next=%2Fadmin%2Faudit");
  if (!roles.includes("super_admin")) redirect("/admin?erreur=acces-refuse");
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const pageSize = 50;
  const { data: entries, count } = await supabase.from("audit_log").select("id,actor_id,action,target_table,target_id,before_value,after_value,created_at", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);

  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">TRAÇABILITÉ</div><h1>Journal d’audit</h1><p>Modifications des données ADEIO, de la plus récente à la plus ancienne.</p></div></div>
    <div className="admin-card"><div className="admin-card-heading"><div><h2>{count ?? 0} événement(s)</h2><p>Les valeurs avant et après sont visibles uniquement au super-administrateur.</p></div></div>
      <div className="admin-list">{entries?.map((entry) => <details className="audit-entry" key={entry.id}><summary><span className={`status-chip ${entry.action === "DELETE" ? "draft" : ""}`}>{entry.action}</span><strong>{entry.target_table}</strong><code>{entry.target_id}</code><time dateTime={entry.created_at}>{formatFinancialDate(entry.created_at.slice(0, 10))} · {new Date(entry.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time></summary><div className="audit-entry-meta">Compte : <code>{entry.actor_id ?? "Compte supprimé"}</code></div><div className="audit-json-grid"><div><h3>Avant</h3><pre>{entry.before_value ? JSON.stringify(entry.before_value, null, 2) : "—"}</pre></div><div><h3>Après</h3><pre>{entry.after_value ? JSON.stringify(entry.after_value, null, 2) : "—"}</pre></div></div></details>)}{!entries?.length && <p className="admin-empty">Aucun événement d’audit enregistré.</p>}</div>
      <PaginationLinks pathname="/admin/audit" page={page} hasNext={(count ?? 0) > page * pageSize} />
    </div>
  </>;
}
