import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { issueMemberToken } from "@/lib/member-qr-crypto";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Origine de requête invalide." }, { status: 403 });
  const payload = await request.json().catch(() => null);
  const parsed = z.object({ memberId: z.string().uuid() }).safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Fiche membre invalide." }, { status: 400 });
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return NextResponse.json({ error: "Connectez-vous pour continuer." }, { status: 401 });
  if (!roles.some((role) => role === "admin" || role === "super_admin")) return NextResponse.json({ error: "Accès réservé à l’administration." }, { status: 403 });
  if (!await hasRequiredMfa(supabase, user.id)) return NextResponse.json({ error: "Validez votre authentification à deux facteurs." }, { status: 403 });
  const { data: member, error: memberError } = await supabase.from("members").select("id").eq("id", parsed.data.memberId).maybeSingle();
  if (memberError || !member) return NextResponse.json({ error: "Membre introuvable." }, { status: 404 });
  let token: ReturnType<typeof issueMemberToken>;
  try { token = issueMemberToken(); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "La clé de chiffrement QR manque." }, { status: 503 }); }
  const { error } = await supabase.rpc("issue_member_qr", {
    p_member_id: member.id,
    p_token_hash: token.tokenHash,
    p_encrypted_token: token.encryptedToken,
    p_nonce: token.nonce,
    p_tag: token.tag,
    p_key_version: token.keyVersion,
  });
  if (error) return NextResponse.json({ error: error.message.includes("active") ? "Seul un membre actif avec un profil à jour peut recevoir une carte." : "Le QR Code n’a pas pu être émis. Vérifiez la migration et la clé de chiffrement." }, { status: 503 });
  return NextResponse.json({ ok: true, message: "QR émis. Le téléchargement de la carte se fait séparément." });
}
