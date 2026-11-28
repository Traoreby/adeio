import { FileBarChart2, FileText } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { publishFinancialReportAction } from "@/app/gestion-financiere/actions";
import { formatFinancialDate } from "@/lib/finance";
import { FinanceSubmitButton } from "@/components/finance-submit-button";
import { PaginationLinks } from "@/components/pagination-links";

type Props = { searchParams: Promise<{ statut?: string; erreur?: string; page?: string }> };

export default async function FinanceReportsPage({ searchParams }: Props) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const pageSize = 20;
  const { data: reportRows } = await supabase.from("financial_reports").select("id,title,period_start,period_end,summary,published_at,total_income_inr,total_expense_inr,net_balance_inr,transaction_count").order("period_end", { ascending: false }).order("id", { ascending: false }).range((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  const reports = (reportRows ?? []).slice(0, pageSize);
  const reportCards = reports.map((report) => ({ ...report, canDownloadInr: report.total_income_inr !== null && report.total_expense_inr !== null && report.net_balance_inr !== null && report.transaction_count !== null, url: `/api/finances/reports/${report.id}` }));
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">TRANSPARENCE FINANCIÈRE</div><h1>Bilans financiers</h1><p>Les rapports périodiques officiels : résumez une période (recettes, dépenses, solde) et publiez-la aux membres.</p></div><span className="admin-heading-mark"><FileBarChart2 size={20} /></span></div>
    {params.statut === "bilan-publie" && <div role="status" className="form-success finance-alert">Bilan publié ; les membres connectés peuvent maintenant le télécharger.</div>}
    {params.erreur === "rapport-invalide" && <div role="alert" className="form-error finance-alert">Renseignez le titre, la période et un PDF de 10 Mo maximum.</div>}
    {params.erreur === "publication-impossible" && <div role="alert" className="form-error finance-alert">Le bilan n’a pas pu être publié ; le fichier temporaire a été retiré.</div>}
    <div className="admin-card"><div className="admin-card-heading"><div><h2><FileBarChart2 size={16} /> Publier un bilan</h2><p>Le PDF est généré à la demande. Les totaux de la période sont conservés avec le rapport; aucun fichier PDF n’est stocké.</p></div></div><form action={publishFinancialReportAction} className="admin-form finance-form">
      <div><label htmlFor="report-title">Titre du bilan</label><input id="report-title" name="title" required minLength={3} maxLength={160} placeholder="Ex. Bilan financier — 1er trimestre 2027" /></div>
      <div className="admin-form-grid"><div><label htmlFor="period-start">Début de période</label><input id="period-start" name="period_start" type="date" required /></div><div><label htmlFor="period-end">Fin de période</label><input id="period-end" name="period_end" type="date" required /></div></div>
      <div><label htmlFor="report-summary">Résumé (facultatif)</label><textarea id="report-summary" name="summary" maxLength={1000} /></div>
      <FinanceSubmitButton pendingLabel="Publication du bilan…">Publier le bilan</FinanceSubmitButton>
    </form></div>
    <div className="admin-card"><h2><FileText size={16} /> Rapports publiés</h2><p>Page {page} · {reportCards.length} rapport(s) affiché(s).</p><div className="admin-list">{reportCards.map((report) => <div className="admin-list-row" key={report.id}><div><h3>{report.title}</h3><p>{formatFinancialDate(report.period_start)} – {formatFinancialDate(report.period_end)}{report.summary ? ` · ${report.summary}` : ""}</p></div>{report.canDownloadInr ? <a className="text-link" href={report.url} target="_blank" rel="noreferrer">Télécharger PDF</a> : <span className="status-chip draft">Instantané INR manquant · republiez le bilan</span>}</div>)}{!reportCards.length && <p className="admin-empty">Aucun bilan publié.</p>}</div><PaginationLinks pathname="/gestion-financiere/bilans" page={page} hasNext={(reportRows?.length ?? 0) > pageSize} /></div>
  </>;
}
