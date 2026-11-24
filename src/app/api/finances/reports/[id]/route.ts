import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSignedInUser } from "@/lib/auth";

type RouteProps = { params: Promise<{ id: string }> };
type Snapshot = { total_income_fcfa: number; total_expense_fcfa: number; net_balance_fcfa: number; transaction_count: number };

function wrap(text: string, maxLength = 88) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxLength) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export async function GET(_request: Request, { params }: RouteProps) {
  const [{ id }, { supabase, user, roles }] = await Promise.all([params, getSignedInUser()]);
  if (!supabase || !user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  if (!roles.includes("member") && !roles.some((role) => ["treasurer", "auditor", "super_admin"].includes(role))) {
    return NextResponse.json({ error: "Accès réservé aux membres." }, { status: 403 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Bilan introuvable." }, { status: 404 });
  }
  const { data: report, error } = await supabase.from("financial_reports")
    .select("id,title,period_start,period_end,summary,total_income_fcfa,total_expense_fcfa,net_balance_fcfa,transaction_count")
    .eq("id", id).maybeSingle();
  if (error || !report) return NextResponse.json({ error: "Bilan introuvable." }, { status: 404 });

  let snapshot = report as typeof report & Partial<Snapshot>;
  if ([snapshot.total_income_fcfa, snapshot.total_expense_fcfa, snapshot.net_balance_fcfa, snapshot.transaction_count].some((value) => typeof value !== "number")) {
    const { data } = await supabase.rpc("get_financial_summary", { p_from: report.period_start, p_to: report.period_end });
    if (data?.[0]) snapshot = { ...snapshot, ...data[0] };
  }

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const margin = 54;
  const green = rgb(0.0, 0.41, 0.25);
  let y = 780;
  page.drawText("ADEIO · RAPPORT FINANCIER", { x: margin, y, size: 11, font: bold, color: green });
  y -= 36;
  for (const line of wrap(report.title, 56)) {
    page.drawText(line, { x: margin, y, size: 20, font: bold, color: rgb(0.1, 0.14, 0.12) });
    y -= 27;
  }
  y -= 8;
  page.drawText(`Période : ${report.period_start} au ${report.period_end}`, { x: margin, y, size: 11, font: regular, color: rgb(0.25, 0.3, 0.27) });
  y -= 34;
  page.drawText("SYNTHÈSE", { x: margin, y, size: 10, font: bold, color: green });
  y -= 22;
  const metrics: [string, number | undefined][] = [
    ["Recettes", snapshot.total_income_fcfa],
    ["Dépenses", snapshot.total_expense_fcfa],
    ["Résultat net", snapshot.net_balance_fcfa],
    ["Opérations publiées", snapshot.transaction_count],
  ];
  for (const [label, amount] of metrics) {
    const value = typeof amount === "number" ? `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA` : "—";
    page.drawText(label, { x: margin, y, size: 12, font: regular, color: rgb(0.18, 0.23, 0.2) });
    page.drawText(value, { x: 340, y, size: 12, font: bold, color: rgb(0.1, 0.14, 0.12) });
    y -= 25;
  }
  if (report.summary) {
    y -= 12;
    page.drawText("NOTE", { x: margin, y, size: 10, font: bold, color: green });
    y -= 20;
    for (const line of wrap(report.summary)) {
      if (y < 90) break;
      page.drawText(line, { x: margin, y, size: 10, font: regular, color: rgb(0.25, 0.3, 0.27) });
      y -= 15;
    }
  }
  page.drawText("Document ADEIO généré à la demande · KIIT University, Bhubaneswar, Odisha, Inde", {
    x: margin, y: 40, size: 8, font: regular, color: rgb(0.35, 0.39, 0.36),
  });
  const bytes = await pdf.save();
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const filename = `adeio-bilan-${report.period_start}-${report.period_end}.pdf`;
  return new NextResponse(body, { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  } });
}
