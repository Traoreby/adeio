import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { formatFinancialDate } from "@/lib/finance";
import { isFinancialReportData } from "@/lib/financial-report";
import { FinancialReportTable } from "@/components/financial-report-table";

type Props = { params: Promise<{ id: string }> };

export default async function PublishedFinancialReportPage({ params }: Props) {
  const [{ id }, { supabase, user, roles }] = await Promise.all([params, getSignedInUser()]);
  if (!supabase || !user) redirect(`/connexion?next=${encodeURIComponent(`/finances/rapports/${id}`)}`);
  if (!roles.includes("member") && !roles.some((role) => ["treasurer", "auditor", "super_admin"].includes(role))) redirect("/espace-membre?erreur=acces-refuse");
  const { data: report, error } = await supabase.from("financial_reports")
    .select("id,title,period_start,period_end,summary,report_data,published_at,version,author_name")
    .eq("id", id).not("published_at", "is", null).maybeSingle();
  if (error || !report) notFound();
  const data = isFinancialReportData(report.report_data) ? report.report_data : null;

  return <section className="member-space-page section-pad"><div className="container financial-report-public-page">
    <div className="financial-report-public-actions"><Link className="text-link" href="/finances"><ArrowLeft size={16} /> Retour aux finances</Link><div><a className="button-secondary" href={`/api/finances/reports/${report.id}`}><Download size={16} /> PDF</a><a className="button-secondary" href={`/api/finances/reports/${report.id}/excel`}><Download size={16} /> Excel</a></div></div>
    <header className="financial-report-public-heading"><div className="eyebrow eyebrow-green">RAPPORT FINANCIER · INR ₹</div><h1>{report.title}</h1><p>Période du {formatFinancialDate(report.period_start)} au {formatFinancialDate(report.period_end)} · Publié le {formatFinancialDate(report.published_at)}{report.version > 1 ? ` · Version ${report.version}` : ""}</p>{report.author_name && <p>Publié par {report.author_name}</p>}</header>
    {data ? <div className="admin-card financial-report-public-card"><FinancialReportTable data={data} /></div> : <div className="admin-card"><h2>Ancien rapport financier</h2><p>Ce rapport a été publié avant le format de tableau manuel ADEIO.</p>{report.summary && <p>{report.summary}</p>}</div>}
  </div></section>;
}
