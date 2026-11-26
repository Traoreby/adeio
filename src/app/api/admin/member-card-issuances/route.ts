import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";

const inputSchema = z.object({ memberIds: z.array(z.string().uuid()).min(1).max(100) });

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    return NextResponse.json({ error: "Origine de requête invalide." }, { status: 403 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || new Set(parsed.data?.memberIds).size !== parsed.data?.memberIds.length) {
    return NextResponse.json({ error: "Sélection de membres invalide (100 cartes maximum)." }, { status: 400 });
  }
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return NextResponse.json({ error: "Connectez-vous pour continuer." }, { status: 401 });
  if (!roles.includes("super_admin")) return NextResponse.json({ error: "La délivrance des cartes est réservée au Super Admin." }, { status: 403 });
  if (!await hasRequiredMfa(supabase, user.id)) return NextResponse.json({ error: "Validez votre authentification à deux facteurs." }, { status: 403 });

  const { data, error } = await supabase.rpc("issue_member_cards", { p_member_ids: parsed.data.memberIds });
  if (error) {
    const knownError = error.message || "Les cartes ne peuvent pas être délivrées avec les informations actuelles.";
    return NextResponse.json({ error: knownError }, { status: error.code === "42501" ? 403 : 409 });
  }
  const issuanceIds = (data ?? []).map((row: { issuance_id: string }) => row.issuance_id);
  if (issuanceIds.length !== parsed.data.memberIds.length) {
    return NextResponse.json({ error: "La délivrance n’a pas pu être confirmée pour tous les membres." }, { status: 503 });
  }
  return NextResponse.json({ issuanceIds }, { headers: { "cache-control": "no-store" } });
}
