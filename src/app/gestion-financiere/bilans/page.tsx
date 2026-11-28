import Link from "next/link";
import { FileBarChart2, FileText, Plus } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { formatFinancialDate } from "@/lib/finance";
import { FinanceSubmitButton } from "@/components/finance-submit-button";
import { PaginationLinks } from "@/components/pagination-links";
import { createFinancialReportDraftAction, createFinancialReportVersionAction } from "@/app/gestion-financiere/actions";

type Props = { searchParams: Promise<{ statut?: string; erreur?: string; page?: string }> };

const statusMessages: Record<string, string> = {
  "brouillon-cree": "Le brouillon a été créé.",
  "brouillon-enregistre": "Le brouillon a été enregistré.",
  "rapport-publie": "Le rapport a été publié et est disponible aux membres.",
  "nouvelle-version": "Une nouvelle version de travail a été créée.",
};
const errorMessages: Record<string, string> = {
  "periode-invalide": "Vérifiez les dates de début et de fin du rapport.",
  "creation-impossible": "Le brouillon n’a pas pu être créé. Vérifiez les droits du Trésorier et réessayez.",
  "version-impossible": "La nouvelle version n’a pas pu être créée.",
  "version-existe": "Une nouvelle version existe déjà à partir de ce rapport. Ouvrez le brouillon le plus récent.",
  "rapport-invalide": "La période ou le contenu du rapport est invalide. Ouvrez le brouillon, vérifiez les valeurs et réessayez.",
};

export default async function FinanceReportsPage({ searchParams }: Props) {
  const [{ supabase, user, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase || !user) return null;
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const pageSize = 20;
  const { data: reportRows } = await supabase.from("financial_reports")
    .select("id,title,period_start,period_end,published_at,created_at,updated_at,created_by,author_name,published_by,version,previous_version_id,report_data")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  const reports = (reportRows ?? []).slice(0, pageSize);
  const authorIds = [...new Set(reports.map((report) => report.created_by).filter((id): id is string => Boolean(id)))];
  const { data: authors } = authorIds.length
    ? await supabase.from("profiles").select("user_id,display_name").in("user_id", authorIds)
    : { data: [] as { user_id: string; display_name: string | null }[] };
  const names = new Map((authors ?? []).map((author) => [author.user_id, author.display_name]));
  const canCreate = roles.includes("treasurer") && !roles.includes("super_admin");

  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">TRANSPARENCE FINANCIÈRE</div><h1>Bilans financiers</h1><p>Créez un rapport manuel unique pour l’association, enregistrez un brouillon ou publiez-le directement aux membres.</p></div><span className="admin-heading-mark"><FileBarChart2 size={20} /></span></div>
    {params.statut && statusMessages[params.statut] && <div role="status" className="form-success finance-alert">{statusMessages[params.statut]}</div>}
    {params.erreur && errorMessages[params.erreur] && <div role="alert" className="form-error finance-alert">{errorMessages[params.erreur]}</div>}
    {canCreate && <div className="admin-card financial-report-create-card">
      <div className="admin-card-heading"><div><h2><Plus size={18} /> Nouveau rapport financier</h2><p>Choisissez la période. Le tableau sera saisi manuellement et ne sera pas alimenté depuis le livre de caisse.</p></div></div>
      <form action={createFinancialReportDraftAction} className="admin-form finance-form financial-report-create-form">
        <div className="admin-form-grid"><div><label htmlFor="report-period-start">Date de début</label><input id="report-period-start" name="period_start" type="date" required /></div><div><label htmlFor="report-period-end">Date de fin</label><input id="report-period-end" name="period_end" type="date" required /></div></div>
        <p className="financial-report-title-preview">Titre généré automatiquement : <strong>RAPPORT FINANCIER [DATE DE DÉBUT] AU [DATE DE FIN]</strong></p>
        <FinanceSubmitButton pendingLabel="Création du brouillon…">Créer un brouillon</FinanceSubmitButton>
      </form>
    </div>}

    <div className="admin-card">
      <div className="admin-card-heading"><div><h2><FileText size={17} /> Historique des rapports</h2><p>Les rapports publiés sont figés. Toute correction passe par une nouvelle version.</p></div></div>
      <div className="admin-list financial-report-history-list">{reports.map((report) => {
        const isPublished = Boolean(report.published_at);
        const author = report.author_name?.trim() || (report.created_by ? names.get(report.created_by)?.trim() : null) || "Auteur non renseigné";
        return <article className="admin-list-row financial-report-history-row" key={report.id}>
          <div className="financial-report-history-copy"><div className="financial-report-history-title"><h3>{report.title}</h3><span className={`status-chip ${isPublished ? "active" : "draft"}`}>{isPublished ? "Publié" : "Brouillon"}</span><span className="financial-report-version">Version {report.version ?? 1}</span></div>
            <p>Période : {formatFinancialDate(report.period_start)} – {formatFinancialDate(report.period_end)} · Créé le {formatFinancialDate(report.created_at)} · {author}{report.published_at ? ` · Publié le ${formatFinancialDate(report.published_at)}` : ""}</p>
            {report.previous_version_id && <small>Version précédente conservée dans l’historique.</small>}
          </div>
          <div className="financial-report-history-actions">
            {isPublished ? <><Link className="button-secondary" href={`/finances/rapports/${report.id}`}>Consulter</Link><a className="text-link" href={`/api/finances/reports/${report.id}`} target="_blank" rel="noreferrer">PDF</a><a className="text-link" href={`/api/finances/reports/${report.id}/excel`}>Excel</a>
              {canCreate && <form action={createFinancialReportVersionAction}><input type="hidden" name="report_id" value={report.id} /><button className="button-secondary" type="submit">Nouvelle version</button></form>}
            </> : canCreate ? <Link className="button-secondary" href={`/gestion-financiere/bilans/${report.id}`}>Ouvrir le brouillon</Link> : <span>En préparation par le Trésorier</span>}
          </div>
        </article>;
      })}{!reports.length && <p className="admin-empty">Aucun rapport n’a encore été créé.</p>}</div>
      <PaginationLinks pathname="/gestion-financiere/bilans" page={page} hasNext={(reportRows?.length ?? 0) > pageSize} />
    </div>
  </>;
}
