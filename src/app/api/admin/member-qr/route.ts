import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";

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
  const { data: member, error: memberError } = await supabase.from("members").select("id,member_number").eq("id", parsed.data.memberId).maybeSingle();
  if (memberError || !member) return NextResponse.json({ error: "Membre introuvable." }, { status: 404 });

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { error } = await supabase.rpc("rotate_member_qr_tokens", { p_items: [{ member_id: member.id, token_hash: tokenHash }] });
  if (error) return NextResponse.json({ error: "Le QR Code n’a pas pu être émis. Appliquez la migration Phase 2." }, { status: 503 });
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/, "");
  const verificationUrl = `${baseUrl}/verification/${token}`;
  const image = await QRCode.toDataURL(verificationUrl, { width: 280, margin: 2, errorCorrectionLevel: "M" });
  return NextResponse.json({ verificationUrl, image, memberNumber: member.member_number });
}
