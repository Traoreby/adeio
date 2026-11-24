import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { financeDirectionLabels, financeMethodLabels, formatFcfa, formatFinancialDate } from "@/lib/finance";

export const runtime = "nodejs";

function safeCsv(value: string | number) {
  let text = String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const finance = roles.some((role) => ["treasurer", "auditor", "super_admin"].includes(role));
  if (!roles.includes("member") && !finance) return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  if (finance && !await hasRequiredMfa(supabase, user.id)) return NextResponse.json({ error: "Authentification renforcée requise." }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const format = params.get("format") === "pdf" ? "pdf" : "csv";
  const start = /^\d{4}-\d{2}-\d{2}$/.test(params.get("de") ?? "") ? params.get("de")! : "";
  const end = /^\d{4}-\d{2}-\d{2}$/.test(params.get("a") ?? "") ? params.get("a")! : "";
  const direction = params.get("type") === "income" || params.get("type") === "expense" ? params.get("type")! : "";
  const pageSize = 1000;
  const rows: Array<{ occurred_on: string; direction: "income" | "expense"; label: string; amount_fcfa: number; payment_method: keyof typeof financeMethodLabels; transaction_categories: { name: string }[] }> = [];
  for (let page = 0; page < 20; page += 1) {
    let query = supabase.from("financial_transactions").select("occurred_on,direction,label,amount_fcfa,payment_method,transaction_categories(name)").eq("is_published", true).order("occurred_on", { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1);
    if (start) query = query.gte("occurred_on", start);
    if (end) query = query.lte("occurred_on", end);
    if (direction) query = query.eq("direction", direction);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: "L’export n’a pas pu être généré." }, { status: 500 });
    rows.push(...((data ?? []) as unknown as typeof rows));
    if ((data?.length ?? 0) < pageSize) break;
  }

  const income = rows.filter((row) => row.direction === "income").reduce((sum, row) => sum + row.amount_fcfa, 0);
  const expense = rows.filter((row) => row.direction === "expense").reduce((sum, row) => sum + row.amount_fcfa, 0);
  const date = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const lines = [
      ["Date", "Nature", "Libellé", "Catégorie", "Moyen de paiement", "Montant FCFA"].map(safeCsv).join(";"),
      ...rows.map((row) => [row.occurred_on, financeDirectionLabels[row.direction], row.label, row.transaction_categories?.[0]?.name ?? "", financeMethodLabels[row.payment_method], row.amount_fcfa].map(safeCsv).join(";")),
    ];
    return new NextResponse(`\uFEFF${lines.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="adeio-finances-${date}.csv"`, "Cache-Control": "private, no-store" } });
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([842, 595]);
  let y = 550;
  const draw = (text: string, x: number, size = 10, strong = false) => page.drawText(text.slice(0, 150), { x, y, size, font: strong ? bold : font, color: rgb(0.1, 0.17, 0.13) });
  draw("ADEIO — État des finances publiées", 42, 18, true); y -= 22;
  draw(`Généré le ${date} · ${rows.length} opérations`, 42, 10); y -= 18;
  draw(`Total des recettes : ${formatFcfa(income)}     Total des dépenses : ${formatFcfa(expense)}     Solde net : ${formatFcfa(income - expense)}`, 42, 10, true); y -= 28;
  draw("Date", 42, 9, true); draw("Nature", 120, 9, true); draw("Libellé", 210, 9, true); draw("Catégorie", 505, 9, true); draw("Montant", 700, 9, true); y -= 18;
  for (const row of rows.slice(0, 250)) {
    if (y < 44) { page = pdf.addPage([842, 595]); y = 550; }
    draw(formatFinancialDate(row.occurred_on), 42, 8);
    draw(financeDirectionLabels[row.direction], 120, 8);
    draw(row.label, 210, 8);
    draw(row.transaction_categories?.[0]?.name ?? "—", 505, 8);
    draw(formatFcfa(row.amount_fcfa), 700, 8);
    y -= 16;
  }
  if (rows.length > 250) {
    if (y < 54) { page = pdf.addPage([842, 595]); y = 550; }
    draw("Aperçu limité à 250 lignes. Téléchargez le CSV pour l’historique complet.", 42, 9, true);
  }
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="adeio-finances-${date}.pdf"`, "Cache-Control": "private, no-store" } });
}
