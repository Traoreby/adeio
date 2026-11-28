import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { getSignedInUser } from "@/lib/auth";
import { financialReportRubricLabel, isFinancialReportData, type FinancialReportCell, type FinancialReportData } from "@/lib/financial-report";

type RouteProps = { params: Promise<{ id: string }> };
const pageWidth = 841.89;
const pageHeight = 595.28;
const turquoise = rgb(0.12, 0.69, 0.68);
const lightBlue = rgb(0.83, 0.91, 0.96);
const black = rgb(0.08, 0.1, 0.09);
const columns = ["Libellés", "Qté", "P.U", "Montant (ROUPÉE / INR)", "%"];
const widths = [166, 39, 58, 94, 36];

function text(value: string | null | undefined) {
  return (value ?? "").replace(/[₹]/g, "INR ").replace(/[\u0000-\u001f]/g, " ").trim();
}

function tableRows(data: FinancialReportData, side: "emplois" | "ressources") {
  const table = data[side];
  const rows: { kind: "rubric" | "entry" | "subtotal" | "total"; cells: string[] }[] = [];
  table.sections.forEach((section, index) => {
    rows.push({ kind: "rubric", cells: [text(financialReportRubricLabel(side, index, section.title)), "", "", "", ""] });
    section.rows.forEach((row) => rows.push({ kind: "entry", cells: cellStrings(row) }));
    rows.push({ kind: "subtotal", cells: cellStrings(section.subtotal, `Sous-total ${section.title}`) });
  });
  rows.push({ kind: "total", cells: cellStrings(table.total, `TOTAL ${side.toUpperCase()}`) });
  return rows;
}

function cellStrings(cell: FinancialReportCell, defaultLabel = "") {
  return [text(cell.label || defaultLabel), text(cell.quantity), text(cell.unitPrice), text(cell.amount), text(cell.percent)];
}

function truncate(value: string, font: PDFFont, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

function drawHeader(page: PDFPage, regular: PDFFont, bold: PDFFont, title: string, period: string, pageNumber: number) {
  page.drawText("ADEIO · RAPPORT FINANCIER (INR)", { x: 22, y: pageHeight - 25, size: 8, font: bold, color: black });
  page.drawText(truncate(title, bold, 12, pageWidth - 90), { x: 22, y: pageHeight - 43, size: 12, font: bold, color: black });
  page.drawText(period, { x: 22, y: pageHeight - 57, size: 8, font: regular, color: black });
  page.drawText(`Page ${pageNumber}`, { x: pageWidth - 52, y: pageHeight - 25, size: 8, font: regular, color: black });
}

function drawTable(page: PDFPage, x: number, title: string, rows: ReturnType<typeof tableRows>, regular: PDFFont, bold: PDFFont) {
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  let y = pageHeight - 78;
  page.drawRectangle({ x, y: y - 18, width: tableWidth, height: 18, color: turquoise, borderColor: black, borderWidth: 0.7 });
  page.drawText(title, { x: x + 5, y: y - 12.5, size: 9, font: bold, color: black });
  y -= 18;
  let columnX = x;
  columns.forEach((heading, index) => {
    page.drawRectangle({ x: columnX, y: y - 19, width: widths[index], height: 19, color: lightBlue, borderColor: black, borderWidth: 0.6 });
    page.drawText(heading, { x: columnX + 3, y: y - 13.5, size: 6.5, font: bold, color: black });
    columnX += widths[index];
  });
  y -= 19;
  for (const row of rows) {
    const height = row.kind === "rubric" ? 15 : 13;
    const fill = row.kind === "rubric" || row.kind === "subtotal" ? lightBlue : row.kind === "total" ? turquoise : undefined;
    let rowX = x;
    row.cells.forEach((value, index) => {
      if (fill) page.drawRectangle({ x: rowX, y: y - height, width: widths[index], height, color: fill });
      page.drawRectangle({ x: rowX, y: y - height, width: widths[index], height, borderColor: black, borderWidth: 0.5 });
      const font = row.kind === "rubric" || row.kind === "subtotal" || row.kind === "total" ? bold : regular;
      const fontSize = row.kind === "rubric" ? 6.2 : 6;
      page.drawText(truncate(value, font, fontSize, widths[index] - 6), { x: rowX + 3, y: y - height + 4, size: fontSize, font, color: black });
      rowX += widths[index];
    });
    y -= height;
  }
}

async function createManualPdf(report: { title: string; period_start: string; period_end: string; report_data: FinancialReportData }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const leftRows = tableRows(report.report_data, "emplois");
  const rightRows = tableRows(report.report_data, "ressources");
  const pageRows = 28;
  const pageCount = Math.max(Math.ceil(leftRows.length / pageRows), Math.ceil(rightRows.length / pageRows), 1);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    drawHeader(page, regular, bold, report.title, `${report.period_start} au ${report.period_end}`, pageIndex + 1);
    drawTable(page, 22, "EMPLOIS", leftRows.slice(pageIndex * pageRows, (pageIndex + 1) * pageRows), regular, bold);
    drawTable(page, 432, "RESSOURCES", rightRows.slice(pageIndex * pageRows, (pageIndex + 1) * pageRows), regular, bold);
    page.drawText("Document comptable ADEIO · Valeurs saisies manuellement · Montants en roupies indiennes (INR)", { x: 22, y: 18, size: 7, font: regular, color: black });
  }
  return pdf.save();
}

async function createLegacyPdf(report: { title: string; period_start: string; period_end: string; summary: string | null; total_income_inr: number | null; total_expense_inr: number | null; net_balance_inr: number | null; transaction_count: number | null }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const margin = 54;
  let y = 780;
  page.drawText("ADEIO · RAPPORT FINANCIER ARCHIVÉ", { x: margin, y, size: 11, font: bold, color: rgb(0.0, 0.41, 0.25) });
  y -= 36;
  page.drawText(text(report.title), { x: margin, y, size: 16, font: bold, color: black });
  y -= 30;
  page.drawText(`Période : ${report.period_start} au ${report.period_end}`, { x: margin, y, size: 11, font: regular, color: black });
  y -= 30;
  const metrics: [string, number | null][] = [["Recettes (INR)", report.total_income_inr], ["Dépenses (INR)", report.total_expense_inr], ["Résultat net (INR)", report.net_balance_inr], ["Opérations", report.transaction_count]];
  for (const [label, amount] of metrics) { page.drawText(label, { x: margin, y, size: 12, font: regular, color: black }); page.drawText(String(amount ?? "—"), { x: 340, y, size: 12, font: bold, color: black }); y -= 25; }
  if (report.summary) page.drawText(text(report.summary).slice(0, 500), { x: margin, y: y - 10, size: 10, font: regular, color: black });
  return pdf.save();
}

export async function GET(_request: Request, { params }: RouteProps) {
  const [{ id }, { supabase, user, roles }] = await Promise.all([params, getSignedInUser()]);
  if (!supabase || !user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  if (!roles.includes("member") && !roles.some((role) => ["treasurer", "auditor", "super_admin"].includes(role))) return NextResponse.json({ error: "Accès réservé aux membres." }, { status: 403 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Rapport introuvable." }, { status: 404 });
  const { data: report, error } = await supabase.from("financial_reports")
    .select("id,title,period_start,period_end,summary,report_data,total_income_inr,total_expense_inr,net_balance_inr,transaction_count,published_at")
    .eq("id", id).not("published_at", "is", null).maybeSingle();
  if (error || !report) return NextResponse.json({ error: "Rapport introuvable." }, { status: 404 });
  const bytes = isFinancialReportData(report.report_data)
    ? await createManualPdf({ ...report, report_data: report.report_data })
    : await createLegacyPdf(report);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new NextResponse(body, { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="adeio-rapport-${report.period_start}-${report.period_end}.pdf"`,
    "Cache-Control": "private, no-store",
  } });
}
