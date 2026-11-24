import { FileBarChart2, FileText, Upload } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { publishFinancialReportAction } from "@/app/gestion-financiere/actions";
import { formatFinancialDate } from "@/lib/finance";
import { FinanceSubmitButton } from "@/components/finance-submit-button";

type Props = { searchParams: Promise<{ statut?: string; erreur?: string }> };

export default async function FinanceReportsPage({ searchParams }: Props) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const { data: reports } = await supabase.from("financial_reports").select("id,title,period_start,period_end,summary,storage_path,file_name,published_at").order("period_end", { ascending: false }).limit(100);
  const reportCards = await Promise.all((reports ?? []).map(async (report) => {
    const { data } = await supabase.storage.from("financial-reports").createSignedUrl(report.storage_path, 60 * 20, { download: report.file_name });
    return { ...report, url: data?.signedUrl ?? null };
  }));
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">TRANSPARENCE FINANCIÈRE</div><h1>Bilans financiers</h1><p>Les rapports périodiques officiels : résumez une période (recettes, dépenses, solde) et publiez-la aux membres.</p></div><span className="admin-heading-mark"><FileBarChart2 size={20} /></span></div>
    {params.statut === "bilan-publie" && <div role="status" className="form-success finance-alert">Bilan publié ; les membres connectés peuvent maintenant le télécharger.</div>}
    {params.erreur === "rapport-invalide" && <div role="alert" className="form-error finance-alert">Renseignez le titre, la période et un PDF de 10 Mo maximum.</div>}
    {params.erreur === "publication-impossible" && <div role="alert" className="form-error finance-alert">Le bilan n’a pas pu être publié ; le fichier temporaire a été retiré.</div>}
    <div className="admin-card"><div className="admin-card-heading"><div><h2><Upload size={16} /> Publier un bilan PDF</h2><p>Après publication, le document est immuable. Pour une correction, publiez une version mise à jour.</p></div></div><form action={publishFinancialReportAction} className="admin-form finance-form">
      <div><label htmlFor="report-title">Titre du bilan</label><input id="report-title" name="title" required minLength={3} maxLength={160} placeholder="Ex. Bilan financier — 1er trimestre 2027" /></div>
      <div className="admin-form-grid"><div><label htmlFor="period-start">Début de période</label><input id="period-start" name="period_start" type="date" required /></div><div><label htmlFor="period-end">Fin de période</label><input id="period-end" name="period_end" type="date" required /></div></div>
      <div><label htmlFor="report-summary">Résumé (facultatif)</label><textarea id="report-summary" name="summary" maxLength={1000} /></div>
      <div><label htmlFor="report-pdf">Fichier PDF</label><input id="report-pdf" name="report_pdf" type="file" accept="application/pdf" required /><small>PDF uniquement · taille maximum 10 Mo · accès réservé aux membres et rôles financiers.</small></div>
      <FinanceSubmitButton pendingLabel="Publication du bilan…">Publier le bilan</FinanceSubmitButton>
    </form></div>
    <div className="admin-card"><h2><FileText size={16} /> Rapports publiés</h2><div className="admin-list">{reportCards.map((report) => <div className="admin-list-row" key={report.id}><div><h3>{report.title}</h3><p>{formatFinancialDate(report.period_start)} – {formatFinancialDate(report.period_end)}{report.summary ? ` · ${report.summary}` : ""}</p></div>{report.url ? <a className="text-link" href={report.url} target="_blank" rel="noreferrer">Télécharger PDF</a> : <span className="status-chip draft">Lien temporairement indisponible</span>}</div>)}{!reportCards.length && <p className="admin-empty">Aucun bilan publié.</p>}</div></div>
  </>;
}
