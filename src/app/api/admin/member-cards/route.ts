import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import QRCode from "qrcode";
import sharp from "sharp";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { decryptMemberToken, type EncryptedMemberToken } from "@/lib/member-qr-crypto";
import { getConsentedMemberPhotoUrl, createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSiteBaseUrl } from "@/lib/site-url";

const inputSchema = z.object({ memberIds: z.array(z.string().uuid()).min(1).max(100) });
const ORANGE = rgb(0.969, 0.498, 0);
const GREEN = rgb(0, 0.620, 0.376);
const DARK = rgb(0.12, 0.16, 0.13);
const MUTED = rgb(0.32, 0.37, 0.33);

function fitText(text: string, maxWidth: number, font: PDFFont, size: number) {
  let value = text;
  while (value.length > 2 && font.widthOfTextAtSize(value, size) > maxWidth) value = `${value.slice(0, -2)}…`;
  return value;
}

function cardPosition(index: number) {
  const width = 595.28, height = 841.89, cardW = 243, cardH = 153, gapX = 24, gapY = 17, marginX = 30, marginY = 39;
  const pageIndex = index % 8;
  const col = pageIndex % 2, row = Math.floor(pageIndex / 2);
  return { width, height, cardW, cardH, x: marginX + col * (cardW + gapX), y: height - marginY - cardH - row * (cardH + gapY) };
}

function drawShell(page: PDFPage, x: number, y: number, cardW: number, cardH: number) {
  page.drawRectangle({ x, y, width: cardW, height: cardH, color: rgb(1, 1, 1), borderColor: rgb(0.83, 0.88, 0.84), borderWidth: 1 });
  page.drawRectangle({ x, y: y + cardH - 5, width: cardW * 0.34, height: 5, color: ORANGE });
  page.drawRectangle({ x: x + cardW * 0.34, y: y + cardH - 5, width: cardW * 0.32, height: 5, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: x + cardW * 0.66, y: y + cardH - 5, width: cardW * 0.34, height: 5, color: GREEN });
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

  const { data: members, error } = await supabase.from("members").select("id,member_number,first_name,last_name,joined_year,exit_year,status,reactivation_photo_required,photo_path,photo_public_consent,member_education_periods(study_program,institution,is_current),executive_members(position:executive_positions(title),term:executive_terms(is_current))").in("id", parsed.data.memberIds);
  if (error || !members || members.length !== parsed.data.memberIds.length) return NextResponse.json({ error: "Un ou plusieurs membres sont introuvables." }, { status: 404 });
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (members.some((member) => member.status !== "active" || member.reactivation_photo_required || member.exit_year === null || member.exit_year <= currentYear)) {
    return NextResponse.json({ error: "Une carte ne peut être générée que pour un membre actif dont l’année de sortie n’est pas atteinte." }, { status: 409 });
  }

  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Le service sécurisé de cartes n’est pas configuré." }, { status: 503 });
  const { data: tokens, error: tokenError } = await serviceClient.from("member_qr_tokens")
    .select("member_id,token_hash,encrypted_token,encryption_nonce,encryption_tag,encryption_key_version")
    .in("member_id", parsed.data.memberIds).is("revoked_at", null);
  if (tokenError) return NextResponse.json({ error: "Les QR actifs n’ont pas pu être lus côté serveur." }, { status: 503 });
  const tokenByMember = new Map((tokens ?? []).map((token) => [token.member_id, token]));
  if (members.some((member) => {
    const token = tokenByMember.get(member.id);
    return !token?.encrypted_token || !token.encryption_nonce || !token.encryption_tag || !token.encryption_key_version;
  })) {
    return NextResponse.json({ error: "Certains QR sont historiques et ne sont pas réimprimables. Réémettez-les explicitement depuis la fiche membre, puis relancez le PDF." }, { status: 409 });
  }

  const baseUrl = await getSiteBaseUrl();
  if (!baseUrl) return NextResponse.json({ error: "L’URL publique du site n’est pas configurée." }, { status: 503 });
  let prepared;
  try {
    prepared = await Promise.all(members.map(async (member) => {
      const stored = tokenByMember.get(member.id)!;
      const token = decryptMemberToken({
        tokenHash: stored.token_hash,
        encryptedToken: stored.encrypted_token!,
        nonce: stored.encryption_nonce!,
        tag: stored.encryption_tag!,
        keyVersion: stored.encryption_key_version!,
      } satisfies EncryptedMemberToken);
      const qr = await QRCode.toBuffer(`${baseUrl}/verification/${token}`, { width: 260, margin: 1, errorCorrectionLevel: "M" });
      const education = (member.member_education_periods ?? []).find((item: { is_current: boolean }) => item.is_current) as { study_program?: string; institution?: string } | undefined;
      const currentPosition = (member.executive_members ?? []).find((assignment: { term?: { is_current?: boolean }[] }) => assignment.term?.[0]?.is_current) as { position?: { title?: string }[] } | undefined;
      let photo: Uint8Array | undefined;
      if (member.photo_path) {
        const signed = await getConsentedMemberPhotoUrl(member.photo_path);
        if (signed) {
          try {
            const response = await fetch(signed, { signal: AbortSignal.timeout(5000) });
            const type = response.headers.get("content-type") ?? "";
            if (response.ok && type.startsWith("image/")) {
              photo = new Uint8Array(await sharp(Buffer.from(await response.arrayBuffer())).jpeg({ quality: 85 }).toBuffer());
            }
          } catch { /* Le QR et les informations imprimées restent vérifiables. */ }
        }
      }
      return { member, qr, photo, education, position: currentPosition?.position?.[0]?.title ?? "Membre ADEIO" };
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Le PDF n’a pas pu être préparé. Vérifiez la clé de chiffrement." }, { status: 503 });
  }

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageCount = Math.ceil(prepared.length / 8);
  for (let sheet = 0; sheet < pageCount; sheet += 1) {
    const pageMembers = prepared.slice(sheet * 8, (sheet + 1) * 8);
    const front = pdf.addPage([595.28, 841.89]);
    const back = pdf.addPage([595.28, 841.89]);
    for (let localIndex = 0; localIndex < pageMembers.length; localIndex += 1) {
      const item = pageMembers[localIndex];
      const { cardW, cardH, x, y } = cardPosition(localIndex);
      drawShell(front, x, y, cardW, cardH);
      drawShell(back, x, y, cardW, cardH);

      front.drawText("ADEIO", { x: x + 13, y: y + cardH - 25, size: 12, font: bold, color: GREEN });
      front.drawText("CARTE DE MEMBRE", { x: x + 57, y: y + cardH - 24, size: 7, font: bold, color: DARK });
      const qrImage = await pdf.embedPng(item.qr);
      front.drawImage(qrImage, { x: x + cardW - 70, y: y + 13, width: 58, height: 58 });
      const photoX = x + 13;
      let textX = photoX;
      if (item.photo) {
        try {
          const photo = await pdf.embedJpg(item.photo);
          if (photo) { front.drawImage(photo, { x: photoX, y: y + 48, width: 43, height: 50 }); textX = photoX + 52; }
        } catch { /* Une photo non décodable ne bloque pas l’impression de la carte. */ }
      }
      const name = `${item.member.first_name} ${item.member.last_name}`;
      front.drawText(fitText(name, x + cardW - 83 - textX, bold, 9), { x: textX, y: y + 83, size: 9, font: bold, color: DARK });
      front.drawText(fitText(item.member.member_number, 140, regular, 8), { x: textX, y: y + 68, size: 8, font: regular, color: DARK });
      front.drawText(fitText(item.education?.study_program ?? "Étudiant ADEIO", 140, regular, 7), { x: textX, y: y + 55, size: 7, font: regular, color: GREEN });
      front.drawText(fitText(item.education?.institution ?? "KIIT University", 140, regular, 6.5), { x: photoX, y: y + 32, size: 6.5, font: regular, color: MUTED });
      front.drawText(`MEMBRE ACTIF · ADHÉSION ${item.member.joined_year}`, { x: photoX, y: y + 17, size: 6.5, font: bold, color: GREEN });

      back.drawText("ASSOCIATION DES ÉTUDIANTS", { x: x + 14, y: y + cardH - 29, size: 8, font: bold, color: DARK });
      back.drawText("IVOIRIENS DE L’ODISHA", { x: x + 14, y: y + cardH - 43, size: 8, font: bold, color: DARK });
      back.drawText("KIIT University · Bhubaneswar, Inde", { x: x + 14, y: y + cardH - 65, size: 7, font: regular, color: MUTED });
      back.drawText("NUMÉRO ADEIO", { x: x + 14, y: y + 61, size: 6.5, font: bold, color: GREEN });
      back.drawText(fitText(item.member.member_number, 210, bold, 10), { x: x + 14, y: y + 44, size: 10, font: bold, color: DARK });
      back.drawText(`Adhésion initiale : ${item.member.joined_year}`, { x: x + 14, y: y + 28, size: 7, font: regular, color: MUTED });
      back.drawText(item.member.exit_year ? `Valide jusqu’au 31/12/${item.member.exit_year - 1}` : "Validité liée au statut actif", { x: x + 14, y: y + 15, size: 7, font: regular, color: MUTED });
      back.drawText("Vérifiez le QR code imprimé au recto.", { x: x + cardW - 135, y: y + 15, size: 6.5, font: regular, color: GREEN });
    }
  }

  const bytes = await pdf.save();
  return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=cartes-membres-adeio-recto-verso.pdf", "cache-control": "no-store" } });
}
