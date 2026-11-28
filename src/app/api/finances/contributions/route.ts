import { NextRequest, NextResponse } from "next/server";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  if (!roles.some((role) => ["treasurer", "auditor", "super_admin"].includes(role))) {
    return NextResponse.json({ error: "Accès réservé au personnel financier." }, { status: 403 });
  }
  if (!await hasRequiredMfa(supabase, user.id)) return NextResponse.json({ error: "Authentification renforcée requise." }, { status: 403 });

  const memberId = request.nextUrl.searchParams.get("member_id") ?? "";
  const year = Number(request.nextUrl.searchParams.get("year"));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memberId) || !Number.isInteger(year) || year < 1900 || year > 2200) {
    return NextResponse.json({ error: "Le membre ou l’année sélectionnée est invalide." }, { status: 400 });
  }
  const { data: months, error } = await supabase.rpc("get_contribution_month_breakdown", { p_member_id: memberId, p_year: year });
  if (error) return NextResponse.json({ error: "Les soldes mensuels n’ont pas pu être consultés." }, { status: 500 });
  return NextResponse.json({ months: months ?? [] }, { headers: { "cache-control": "private, no-store" } });
}
