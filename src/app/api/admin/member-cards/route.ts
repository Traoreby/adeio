import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import QRCode from "qrcode";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { getConsentedMemberPhotoUrl } from "@/lib/supabase/service";

const inputSchema = z.object({ memberIds: z.array(z.string().uuid()).min(1).max(100) });
const ORANGE = rgb(0.969, 0.498, 0);
const GREEN = rgb(0, 0.620, 0.376);
const DARK = rgb(0.12, 0.16, 0.13);

function fitText(text: string, maxWidth: number, font: PDFFont, size: number) {
  let value = text;
  while (value.length > 2 && font.widthOfTextAtSize(value, size) > maxWidth) value = `${value.slice(0, -2)}…`;
  return value;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Origine de requête invalide." }, { status: 403 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || new Set(parsed.data?.memberIds).size !== parsed.data?.memberIds.length) return NextResponse.json({ error: "Sélection de membres invalide (100 cartes maximum)." }, { status: 400 });
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return NextResponse.json({ error: "Connectez-vous pour continuer." }, { status: 401 });
  if (!roles.some((role) => role === "admin" || role === "super_admin")) return NextResponse.json({ error: "Accès réservé à l’administration." }, { status: 403 });
  if (!await hasRequiredMfa(supabase, user.id)) return NextResponse.json({ error: "Validez votre authentification à deux facteurs." }, { status: 403 });

  const { data: members, error } = await supabase.from("members").select("id,member_number,first_name,last_name,joined_year,status,photo_path,photo_public_consent,executive_members(position:executive_positions(title),term:executive_terms(is_current))").in("id", parsed.data.memberIds);
  if (error || !members || members.length !== parsed.data.memberIds.length) return NextResponse.json({ error: "Un ou plusieurs membres sont introuvables." }, { status: 404 });

  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/, "");
  const prepared = await Promise.all(members.map(async (member) => {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const qr = await QRCode.toBuffer(`${baseUrl}/verification/${token}`, { width: 260, margin: 1, errorCorrectionLevel: "M" });
    const currentPosition = (member.executive_members ?? []).find((assignment: { term?: { is_current?: boolean }[] }) => assignment.term?.[0]?.is_current) as { position?: { title?: string }[] } | undefined;
    let photo: Uint8Array | undefined;
    if (member.photo_public_consent && member.photo_path) {
      const signed = await getConsentedMemberPhotoUrl(member.photo_path);
      if (signed) {
        try {
          const response = await fetch(signed, { signal: AbortSignal.timeout(5000) });
          const type = response.headers.get("content-type") ?? "";
          if (response.ok && type.includes("png")) photo = new Uint8Array(await response.arrayBuffer());
          else if (response.ok && type.includes("jpeg")) photo = new Uint8Array(await response.arrayBuffer());
        } catch { /* Une carte reste imprimable sans la photo distante. */ }
      }
    }
    return { member, tokenHash, qr, photo, position: currentPosition?.position?.[0]?.title ?? "Membre ADEIO" };
  }));

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28, height = 841.89, cardW = 243, cardH = 153, gapX = 24, gapY = 17, marginX = 30, marginY = 39;
  const perPage = 8;
  for (let index = 0; index < prepared.length; index += 1) {
    if (index % perPage === 0) pdf.addPage([width, height]);
    const page = pdf.getPages()[pdf.getPages().length - 1];
    const pageIndex = index % perPage, col = pageIndex % 2, row = Math.floor(pageIndex / 2);
    const x = marginX + col * (cardW + gapX), y = height - marginY - cardH - row * (cardH + gapY);
    page.drawRectangle({ x, y, width: cardW, height: cardH, color: rgb(1, 1, 1), borderColor: rgb(0.86, 0.9, 0.86), borderWidth: 1 });
    page.drawRectangle({ x, y: y + cardH - 5, width: cardW * 0.34, height: 5, color: ORANGE });
    page.drawRectangle({ x: x + cardW * 0.34, y: y + cardH - 5, width: cardW * 0.32, height: 5, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: x + cardW * 0.66, y: y + cardH - 5, width: cardW * 0.34, height: 5, color: GREEN });
    page.drawText("ADEIO", { x: x + 13, y: y + cardH - 25, size: 12, font: bold, color: GREEN });
    page.drawText("CARTE DE MEMBRE", { x: x + 57, y: y + cardH - 24, size: 7, font: bold, color: DARK });
    const qrImage = await pdf.embedPng(prepared[index].qr);
    page.drawImage(qrImage, { x: x + cardW - 74, y: y + 12, width: 62, height: 62 });
    const nameX = x + 13;
    let textX = nameX;
    if (prepared[index].photo) {
      try {
        const photoBytes = prepared[index].photo!;
        const isPng = photoBytes[0] === 137 && photoBytes[1] === 80 && photoBytes[2] === 78 && photoBytes[3] === 71;
        const photo = photoBytes.byteLength > 8 ? (isPng ? await pdf.embedPng(photoBytes) : await pdf.embedJpg(photoBytes)) : null;
        if (photo) { page.drawImage(photo, { x: nameX, y: y + 47, width: 43, height: 50 }); textX = nameX + 52; }
      } catch { /* Photo non décodable : la carte garde son QR et son identité. */ }
    }
    const name = `${prepared[index].member.first_name} ${prepared[index].member.last_name}`;
    page.drawText(fitText(name, x + cardW - 83 - textX, bold, 9), { x: textX, y: y + 82, size: 9, font: bold, color: DARK });
    page.drawText(fitText(prepared[index].member.member_number, 140, regular, 8), { x: textX, y: y + 66, size: 8, font: regular, color: DARK });
    page.drawText(fitText(prepared[index].position, 140, regular, 7), { x: textX, y: y + 53, size: 7, font: regular, color: GREEN });
    page.drawText("KIIT University · Bhubaneswar", { x: nameX, y: y + 18, size: 6.5, font: regular, color: rgb(0.35, 0.39, 0.36) });
  }

  const { error: rotateError } = await supabase.rpc("rotate_member_qr_tokens", {
    p_items: prepared.map(({ member, tokenHash }) => ({ member_id: member.id, token_hash: tokenHash })),
  });
  if (rotateError) return NextResponse.json({ error: "Les QR Codes n’ont pas été activés. Appliquez la migration Phase 2." }, { status: 503 });
  const bytes = await pdf.save();
  return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=cartes-membres-adeio.pdf", "cache-control": "no-store" } });
}
