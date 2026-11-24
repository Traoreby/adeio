import { NextResponse } from "next/server";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { formatFinancialDate } from "@/lib/finance";

function cell(value: string | number) {
  let text = String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  if (!roles.some((role) => ["treasurer", "auditor", "super_admin"].includes(role))) return NextResponse.json({ error: "Accès réservé au personnel financier." }, { status: 403 });
  if (!await hasRequiredMfa(supabase, user.id)) return NextResponse.json({ error: "Authentification renforcée requise." }, { status: 403 });
  const asOf = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from("contribution_dues").select("id,member_id,due_on,period_start,period_end,amount_due_fcfa,members(member_number,first_name,last_name),contribution_allocations(amount_fcfa)").lte("due_on", asOf).order("due_on").limit(10000);
  if (error) return NextResponse.json({ error: "L’export des échéances n’a pas pu être généré." }, { status: 500 });
  const overdue = (data ?? []).map((due) => ({ ...due, remaining: due.amount_due_fcfa - (due.contribution_allocations ?? []).reduce((sum, allocation) => sum + allocation.amount_fcfa, 0) })).filter((due) => due.remaining > 0);
  const lines = [
    ["Membre", "Numéro ADEIO", "Échéance", "Période du", "Période au", "Montant dû FCFA", "Reste FCFA"].map(cell).join(";"),
    ...overdue.map((due) => [
      `${due.members?.[0]?.first_name ?? ""} ${due.members?.[0]?.last_name ?? ""}`.trim(), due.members?.[0]?.member_number ?? "",
      formatFinancialDate(due.due_on), formatFinancialDate(due.period_start), formatFinancialDate(due.period_end), due.amount_due_fcfa, due.remaining,
    ].map(cell).join(";")),
  ];
  return new NextResponse(`\uFEFF${lines.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="adeio-arrieres-${asOf}.csv"`, "Cache-Control": "private, no-store" } });
}
