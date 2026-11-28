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
  const { data, error } = await supabase.rpc("get_finance_overdue_export_inr", { p_as_of: asOf });
  if (error) return NextResponse.json({ error: "L’export des échéances n’a pas pu être généré." }, { status: 500 });
  const overdueMembers = (data ?? []) as { member_number: string; first_name: string; last_name: string; overdue_periods: number; oldest_due_on: string; overdue_amount_inr: number }[];
  const lines = [
    ["Membre", "Numéro ADEIO", "Nombre de périodes", "Échéance la plus ancienne", "Montant restant INR"].map(cell).join(";"),
    ...overdueMembers.map((member) => [
      `${member.first_name} ${member.last_name}`.trim(), member.member_number,
      member.overdue_periods, formatFinancialDate(member.oldest_due_on), member.overdue_amount_inr,
    ].map(cell).join(";")),
  ];
  return new NextResponse(`\uFEFF${lines.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="adeio-arrieres-${asOf}.csv"`, "Cache-Control": "private, no-store" } });
}
