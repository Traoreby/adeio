import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Origine de requête invalide." }, { status: 403 });
  const parsed = z.object({ memberId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Fiche membre invalide." }, { status: 400 });
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return NextResponse.json({ error: "Connectez-vous pour continuer." }, { status: 401 });
  if (!roles.some((role) => role === "admin" || role === "super_admin")) return NextResponse.json({ error: "Accès réservé à l’administration." }, { status: 403 });
  if (!await hasRequiredMfa(supabase, user.id)) return NextResponse.json({ error: "Validez votre authentification à deux facteurs." }, { status: 403 });
  const { error } = await supabase.rpc("revoke_member_qr", { p_member_id: parsed.data.memberId });
  if (error) return NextResponse.json({ error: "Le QR Code n’a pas pu être désactivé." }, { status: 500 });
  return NextResponse.json({ ok: true, message: "QR désactivé. Cet ancien lien de vérification ne sera plus jamais valide." });
}
