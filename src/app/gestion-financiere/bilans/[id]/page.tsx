import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileBarChart2 } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { createBlankFinancialReportData, isFinancialReportData } from "@/lib/financial-report";
import { FinancialReportEditor } from "@/components/financial-report-editor";
import { publishManualFinancialReportAction, saveFinancialReportDraftAction } from "@/app/gestion-financiere/actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ statut?: string; erreur?: string }> };

const messages: Record<string, string> = {
  "rapport-invalide": "Vérifiez les champs numériques et les dates. Ajoutez au moins une information avant de publier.",
  "enregistrement-impossible": "Le brouillon n’a pas pu être enregistré. Il a peut-être déjà été publié ou votre session doit être actualisée.",
  "publication-impossible": "Le rapport n’a pas pu être publié. Vérifiez son contenu et réessayez.",
};

export default async function EditFinancialReportPage({ params, searchParams }: Props) {
  const [{ id }, query, { supabase, user, roles }] = await Promise.all([params, searchParams, getSignedInUser()]);
  if (!supabase || !user) return null;
  if (!roles.includes("treasurer") || roles.includes("super_admin")) redirect("/gestion-financiere/bilans");
  const { data: report, error } = await supabase.from("financial_reports")
    .select("id,title,period_start,period_end,published_at,report_data")
    .eq("id", id).maybeSingle();
  if (error || !report) notFound();
  if (report.published_at) redirect(`/finances/rapports/${report.id}`);
  const reportData = isFinancialReportData(report.report_data) ? report.report_data : createBlankFinancialReportData();

  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">BROUILLON · RAPPORT MANUEL</div><h1>{report.title}</h1><p>Renseignez librement les lignes. Les valeurs publiées seront conservées telles quelles.</p></div><span className="admin-heading-mark"><FileBarChart2 size={20} /></span></div>
    {query.statut === "brouillon-cree" && <div role="status" className="form-success finance-alert">Brouillon créé. Vous pouvez compléter le tableau.</div>}
    {query.statut === "brouillon-enregistre" && <div role="status" className="form-success finance-alert">Brouillon enregistré.</div>}
    {query.statut === "nouvelle-version" && <div role="status" className="form-success finance-alert">Nouvelle version créée. La version publiée précédente reste intacte.</div>}
    <p className="financial-report-editor-back"><Link className="text-link" href="/gestion-financiere/bilans"><ArrowLeft size={16} /> Retour à l’historique</Link></p>
    <div className="admin-card"><FinancialReportEditor
      reportId={report.id}
      title={report.title}
      periodStart={report.period_start}
      periodEnd={report.period_end}
      initialData={reportData}
      saveAction={saveFinancialReportDraftAction}
      publishAction={publishManualFinancialReportAction}
      error={query.erreur ? messages[query.erreur] : undefined}
    /></div>
  </>;
}
