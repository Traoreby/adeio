import { NextResponse } from "next/server";
import { getSignedInUser } from "@/lib/auth";
import { financialReportRubricLabel, isFinancialReportData, type FinancialReportCell, type FinancialReportData } from "@/lib/financial-report";

type RouteProps = { params: Promise<{ id: string }> };

function escapeXml(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlCell(value: string, style = "Cell") {
  const isNumber = value !== "" && /^\d+(?:\.\d+)?$/.test(value);
  return `<Cell ss:StyleID="${style}"><Data ss:Type="${isNumber ? "Number" : "String"}">${escapeXml(value)}</Data></Cell>`;
}

function cellValues(cell: FinancialReportCell, fallback = "") {
  return [cell.label || fallback, cell.quantity, cell.unitPrice, cell.amount, cell.percent];
}

function sideRows(data: FinancialReportData, side: "emplois" | "ressources") {
  const rows: { style: string; cells: string[] }[] = [];
  const sectionNames = data[side].sections;
  sectionNames.forEach((section, index) => {
    rows.push({ style: "Rubric", cells: [financialReportRubricLabel(side, index, section.title), "", "", "", ""] });
    section.rows.forEach((row) => rows.push({ style: "Cell", cells: cellValues(row) }));
    rows.push({ style: "Subtotal", cells: cellValues(section.subtotal, `Sous-total ${section.title}`) });
  });
  rows.push({ style: "Total", cells: cellValues(data[side].total, `TOTAL ${side.toUpperCase()}`) });
  return rows;
}

function excelXml(title: string, start: string, end: string, data: FinancialReportData) {
  const left = sideRows(data, "emplois");
  const right = sideRows(data, "ressources");
  const max = Math.max(left.length, right.length);
  const header = ["Libellés", "Qté", "P.U", "Montant (ROUPÉE / INR ₹)", "%"];
  const rows = [
    `<Row><Cell ss:StyleID="Title" ss:MergeAcross="9"><Data ss:Type="String">${escapeXml(title)}</Data></Cell></Row>`,
    `<Row><Cell ss:StyleID="Meta" ss:MergeAcross="9"><Data ss:Type="String">${escapeXml(`Période : ${start} au ${end}`)}</Data></Cell></Row>`,
    `<Row>${xmlCell("EMPLOIS", "Band")}${Array.from({ length: 4 }, () => `<Cell ss:StyleID="Band"/>`).join("")}<Cell ss:StyleID="Band"> <Data ss:Type="String">RESSOURCES</Data></Cell>${Array.from({ length: 4 }, () => `<Cell ss:StyleID="Band"/>`).join("")}</Row>`,
    `<Row>${header.map((value) => xmlCell(value, "Head")).join("")}${header.map((value) => xmlCell(value, "Head")).join("")}</Row>`,
    ...Array.from({ length: max }, (_, index) => {
      const leftRow = left[index] ?? { style: "Cell", cells: ["", "", "", "", ""] };
      const rightRow = right[index] ?? { style: "Cell", cells: ["", "", "", "", ""] };
      return `<Row>${leftRow.cells.map((value) => xmlCell(value, leftRow.style)).join("")}${rightRow.cells.map((value) => xmlCell(value, rightRow.style)).join("")}</Row>`;
    }),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/></Borders></Style><Style ss:ID="Title"><Font ss:Bold="1" ss:Size="14"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/></Style><Style ss:ID="Meta"><Font ss:Size="10"/></Style><Style ss:ID="Band"><Font ss:Bold="1" ss:Size="12"/><Interior ss:Color="#20B8B3" ss:Pattern="Solid"/></Style><Style ss:ID="Head"><Font ss:Bold="1"/><Interior ss:Color="#D8EBF5" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style><Style ss:ID="Cell"/><Style ss:ID="Rubric"><Font ss:Bold="1"/><Interior ss:Color="#D8EBF5" ss:Pattern="Solid"/></Style><Style ss:ID="Subtotal"><Font ss:Bold="1"/><Interior ss:Color="#D8EBF5" ss:Pattern="Solid"/></Style><Style ss:ID="Total"><Font ss:Bold="1"/><Interior ss:Color="#20B8B3" ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="Rapport ADEIO"><Table ss:ExpandedColumnCount="10" ss:ExpandedRowCount="${max + 4}">${rows}</Table></Worksheet></Workbook>`;
}

function legacyData(report: { total_income_inr: number | null; total_expense_inr: number | null; net_balance_inr: number | null; transaction_count: number | null }): FinancialReportData {
  const total: FinancialReportCell = { label: "Ancienne synthèse INR", quantity: String(report.transaction_count ?? ""), unitPrice: "", amount: String(report.net_balance_inr ?? ""), percent: "" };
  return {
    emplois: { sections: [], total: { ...total, label: "Dépenses", amount: String(report.total_expense_inr ?? "") } },
    ressources: { sections: [], total: { ...total, label: "Recettes", amount: String(report.total_income_inr ?? "") } },
  };
}

export async function GET(_request: Request, { params }: RouteProps) {
  const [{ id }, { supabase, user, roles }] = await Promise.all([params, getSignedInUser()]);
  if (!supabase || !user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  if (!roles.includes("member") && !roles.some((role) => ["treasurer", "auditor", "super_admin"].includes(role))) return NextResponse.json({ error: "Accès réservé aux membres." }, { status: 403 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Rapport introuvable." }, { status: 404 });
  const { data: report, error } = await supabase.from("financial_reports")
    .select("id,title,period_start,period_end,report_data,total_income_inr,total_expense_inr,net_balance_inr,transaction_count,published_at")
    .eq("id", id).not("published_at", "is", null).maybeSingle();
  if (error || !report) return NextResponse.json({ error: "Rapport introuvable." }, { status: 404 });
  const data = isFinancialReportData(report.report_data) ? report.report_data : legacyData(report);
  const xml = excelXml(report.title, report.period_start, report.period_end, data);
  return new NextResponse(xml, { headers: {
    "Content-Type": "application/vnd.ms-excel; charset=utf-8",
    "Content-Disposition": `attachment; filename="adeio-rapport-${report.period_start}-${report.period_end}.xls"`,
    "Cache-Control": "private, no-store",
  } });
}
