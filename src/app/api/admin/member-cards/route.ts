import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import QRCode from "qrcode";
import sharp from "sharp";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { decryptMemberToken, type EncryptedMemberToken } from "@/lib/member-qr-crypto";
import { createSupabaseServiceClient, getMemberPhotoUrls } from "@/lib/supabase/service";
import { getSiteBaseUrl } from "@/lib/site-url";

const inputSchema = z.object({ issuanceIds: z.array(z.string().uuid()).min(1).max(100) });
const ORANGE = rgb(0.969, 0.498, 0);
const GREEN = rgb(0, 0.620, 0.376);
const DARK = rgb(0.12, 0.16, 0.13);
const MUTED = rgb(0.32, 0.37, 0.33);

type CardSnapshot = {
  first_name: string;
  last_name: string;
  member_number: string;
  joined_year: number;
  study_program: string;
  institution: string;
  status: string;
  photo_path: string | null;
  issued_on: string;
  valid_until: string;
  association: string;
  site_url: string;
};
type Issuance = {
  id: string;
  member_id: string;
  qr_token_id: string;
  signature_storage_path: string;
  seal_storage_path: string;
  issued_at: string;
  issued_on: string;
  valid_until: string;
  member_snapshot: CardSnapshot;
};
type PreparedCard = {
  issuance: Issuance;
  qr: Buffer;
  photo?: Uint8Array;
  photoMissing: boolean;
  signature: Uint8Array;
  seal: Uint8Array;
};

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

function drawImageContained(page: PDFPage, image: PDFImage, x: number, y: number, maxWidth: number, maxHeight: number, opacity = 1) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: x + (maxWidth - width) / 2,
    y: y + (maxHeight - height) / 2,
    width,
    height,
    opacity,
  });
}

function drawCenteredText(page: PDFPage, text: string, x: number, y: number, width: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>) {
  const fitted = fitText(text, width, font, size);
  const textWidth = font.widthOfTextAtSize(fitted, size);
  page.drawText(fitted, { x: x + Math.max(0, (width - textWidth) / 2), y, size, font, color });
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00+05:30`).toLocaleDateString("fr-FR", { timeZone: "Asia/Kolkata" });
}

async function loadPng(url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7000) });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.startsWith("image/png")) throw new Error("Un élément officiel n’a pas pu être chargé.");
  return new Uint8Array(await response.arrayBuffer());
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Origine de requête invalide." }, { status: 403 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || new Set(parsed.data?.issuanceIds).size !== parsed.data?.issuanceIds.length) {
    return NextResponse.json({ error: "Sélection de cartes invalide (100 maximum)." }, { status: 400 });
  }
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return NextResponse.json({ error: "Connectez-vous pour continuer." }, { status: 401 });
  if (!roles.includes("super_admin")) return NextResponse.json({ error: "La génération des cartes délivrées est réservée au Super Admin." }, { status: 403 });
  if (!await hasRequiredMfa(supabase, user.id)) return NextResponse.json({ error: "Validez votre authentification à deux facteurs." }, { status: 403 });

  const { data: rows, error } = await supabase.from("member_card_issuances")
    .select("id,member_id,qr_token_id,signature_storage_path,seal_storage_path,issued_at,issued_on,valid_until,member_snapshot")
    .in("id", parsed.data.issuanceIds);
  if (error || !rows || rows.length !== parsed.data.issuanceIds.length) {
    return NextResponse.json({ error: "Une carte délivrée est introuvable ou vous n’êtes pas autorisé à la consulter." }, { status: 404 });
  }
  const issuances = rows as unknown as Issuance[];
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Le service sécurisé de cartes n’est pas configuré." }, { status: 503 });
  const baseUrl = await getSiteBaseUrl();
  if (!baseUrl) return NextResponse.json({ error: "L’URL publique du site n’est pas configurée." }, { status: 503 });

  const tokenIds = issuances.map((item) => item.qr_token_id);
  const [{ data: tokens, error: tokenError }, photoUrls, { data: signedAssets, error: assetError }] = await Promise.all([
    service.from("member_qr_tokens").select("id,token_hash,encrypted_token,encryption_nonce,encryption_tag,encryption_key_version,revoked_at").in("id", tokenIds),
    getMemberPhotoUrls(issuances.map((item) => item.member_snapshot.photo_path)),
    service.storage.from("member-card-official-assets").createSignedUrls(
      [...new Set(issuances.flatMap((item) => [item.signature_storage_path, item.seal_storage_path]))], 300,
    ),
  ]);
  if (tokenError || assetError || !tokens || !signedAssets) return NextResponse.json({ error: "Les ressources sécurisées n’ont pas pu être chargées." }, { status: 503 });
  const tokensById = new Map(tokens.map((token) => [token.id, token]));
  const signedByPath = new Map(signedAssets.flatMap((item) => item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : []));
  if (issuances.some((item) => !tokensById.has(item.qr_token_id) || !signedByPath.has(item.signature_storage_path) || !signedByPath.has(item.seal_storage_path))) {
    return NextResponse.json({ error: "Le QR ou un élément officiel lié à une carte n’est plus disponible." }, { status: 409 });
  }
  if (issuances.some((item) => tokensById.get(item.qr_token_id)?.revoked_at)) {
    return NextResponse.json({ error: "Le QR de cette carte a été révoqué. Elle ne peut plus être réimprimée comme carte active." }, { status: 409 });
  }

  let prepared: PreparedCard[];
  try {
    prepared = await Promise.all(issuances.map(async (issuance) => {
      const stored = tokensById.get(issuance.qr_token_id)!;
      const token = decryptMemberToken({
        tokenHash: stored.token_hash,
        encryptedToken: stored.encrypted_token,
        nonce: stored.encryption_nonce,
        tag: stored.encryption_tag,
        keyVersion: stored.encryption_key_version,
      } satisfies EncryptedMemberToken);
      const qr = await QRCode.toBuffer(`${baseUrl}/verification/${token}`, { width: 260, margin: 1, errorCorrectionLevel: "M" });
      let photo: Uint8Array | undefined;
      const photoPath = issuance.member_snapshot.photo_path;
      const signedPhoto = photoPath ? photoUrls.get(photoPath) : undefined;
      if (signedPhoto) {
        const response = await fetch(signedPhoto, { cache: "no-store", signal: AbortSignal.timeout(7000) }).catch(() => null);
        const type = response?.headers.get("content-type") ?? "";
        if (response?.ok && type.startsWith("image/")) {
          photo = new Uint8Array(await sharp(Buffer.from(await response.arrayBuffer())).jpeg({ quality: 85 }).toBuffer());
        }
      }
      const [signature, seal] = await Promise.all([
        loadPng(signedByPath.get(issuance.signature_storage_path)!),
        loadPng(signedByPath.get(issuance.seal_storage_path)!),
      ]);
      return { issuance, qr, photo, photoMissing: !photo, signature, seal };
    }));
  } catch (prepareError) {
    const message = prepareError instanceof Error ? prepareError.message : "Le PDF n’a pas pu être préparé.";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoBytes = await readFile(join(process.cwd(), "public", "adeio-logo.jpeg"));
  const logo = await pdf.embedJpg(logoBytes);
  const pageCount = Math.ceil(prepared.length / 8);
  for (let sheet = 0; sheet < pageCount; sheet += 1) {
    const pageMembers = prepared.slice(sheet * 8, (sheet + 1) * 8);
    const front = pdf.addPage([595.28, 841.89]);
    const back = pdf.addPage([595.28, 841.89]);
    for (let localIndex = 0; localIndex < pageMembers.length; localIndex += 1) {
      const item = pageMembers[localIndex];
      const snap = item.issuance.member_snapshot;
      const { cardW, cardH, x, y } = cardPosition(localIndex);
      drawShell(front, x, y, cardW, cardH);
      drawShell(back, x, y, cardW, cardH);
      drawImageContained(back, logo, x + 80, y + 39, 67, 67, 0.08);

      front.drawText("ADEIO", { x: x + 13, y: y + cardH - 25, size: 12, font: bold, color: GREEN });
      front.drawText("CARTE DE MEMBRE", { x: x + 57, y: y + cardH - 24, size: 7, font: bold, color: DARK });
      const qrImage = await pdf.embedPng(item.qr);
      front.drawImage(qrImage, { x: x + cardW - 70, y: y + 13, width: 58, height: 58 });
      const photoX = x + 13;
      let textX = photoX;
      if (item.photo) {
        try {
          const photo = await pdf.embedJpg(item.photo);
          front.drawImage(photo, { x: photoX, y: y + 48, width: 43, height: 50 });
          textX = photoX + 52;
        } catch { /* Si l’image est illisible, le PDF conserve une vignette de remplacement. */ }
      }
      if (!item.photo) {
        front.drawRectangle({ x: photoX, y: y + 48, width: 43, height: 50, color: rgb(0.94, 0.96, 0.94) });
        front.drawCircle({ x: photoX + 21.5, y: y + 81, size: 7, color: rgb(0.68, 0.73, 0.69) });
        front.drawEllipse({ x: photoX + 21.5, y: y + 59, xScale: 13, yScale: 8, color: rgb(0.68, 0.73, 0.69) });
        textX = photoX + 52;
      }
      front.drawText(fitText(`${snap.first_name} ${snap.last_name}`, x + cardW - 83 - textX, bold, 9), { x: textX, y: y + 83, size: 9, font: bold, color: DARK });
      front.drawText(fitText(snap.member_number, 140, regular, 8), { x: textX, y: y + 68, size: 8, font: regular, color: DARK });
      front.drawText(fitText(snap.study_program, 140, regular, 7), { x: textX, y: y + 55, size: 7, font: regular, color: GREEN });
      front.drawText(fitText(snap.status, 140, bold, 6.5), { x: textX, y: y + 43, size: 6.5, font: bold, color: GREEN });
      front.drawText(fitText(snap.institution, 205, regular, 6.5), { x: photoX, y: y + 32, size: 6.5, font: regular, color: MUTED });
      front.drawText(`${snap.status} · ADHÉSION ${snap.joined_year}`, { x: photoX, y: y + 17, size: 6.5, font: bold, color: GREEN });

      back.drawText("ASSOCIATION DES ÉTUDIANTS", { x: x + 14, y: y + cardH - 29, size: 8, font: bold, color: DARK });
      back.drawText("IVOIRIENS DE L’ODISHA", { x: x + 14, y: y + cardH - 43, size: 8, font: bold, color: DARK });
      back.drawText("KIIT University · Bhubaneswar, Inde", { x: x + 14, y: y + cardH - 58, size: 6.7, font: regular, color: MUTED });
      back.drawText("adeio.vercel.app", { x: x + 14, y: y + cardH - 69, size: 6.2, font: bold, color: GREEN });
      back.drawText("Scannez le QR pour vérifier", { x: x + 14, y: y + cardH - 80, size: 5.7, font: regular, color: MUTED });
      back.drawText("l’authenticité et la validité.", { x: x + 14, y: y + cardH - 89, size: 5.7, font: regular, color: MUTED });
      back.drawText("NUMÉRO ADEIO", { x: x + 14, y: y + 55, size: 6.5, font: bold, color: GREEN });
      back.drawText(fitText(snap.member_number, 108, bold, 9.5), { x: x + 14, y: y + 42, size: 9.5, font: bold, color: DARK });
      back.drawText(`Adhésion : ${snap.joined_year}`, { x: x + 14, y: y + 30, size: 7, font: regular, color: MUTED });
      back.drawText(`Délivrée le ${formatDate(item.issuance.issued_on)}`, { x: x + 14, y: y + 19, size: 6.3, font: regular, color: MUTED });
      back.drawText(`Valide jusqu’au ${formatDate(item.issuance.valid_until)}`, { x: x + 14, y: y + 8, size: 6.3, font: bold, color: GREEN });
      const signature = await pdf.embedPng(item.signature);
      const seal = await pdf.embedPng(item.seal);

      // Bloc officiel compact, dans les marges de sécurité et sans déformer les PNG.
      const officialX = x + 124;
      const officialY = y + 12;
      const officialW = 108;
      const officialH = 77;
      back.drawRectangle({
        x: officialX,
        y: officialY,
        width: officialW,
        height: officialH,
        color: rgb(0.975, 0.985, 0.975),
        borderColor: rgb(0.84, 0.89, 0.85),
        borderWidth: 0.65,
      });
      back.drawRectangle({ x: officialX, y: officialY + officialH - 2, width: officialW / 2, height: 2, color: ORANGE });
      back.drawRectangle({ x: officialX + officialW / 2, y: officialY + officialH - 2, width: officialW / 2, height: 2, color: GREEN });
      drawCenteredText(back, "VALIDATION OFFICIELLE", officialX + 4, officialY + officialH - 11, officialW - 8, bold, 5.1, GREEN);

      const signatureX = officialX + 4;
      const signatureW = 48;
      drawImageContained(back, signature, signatureX, officialY + 31, signatureW, 26);
      back.drawLine({ start: { x: signatureX + 1, y: officialY + 28 }, end: { x: signatureX + signatureW - 1, y: officialY + 28 }, thickness: 0.55, color: rgb(0.55, 0.61, 0.56) });
      drawCenteredText(back, "Signature autorisée", signatureX, officialY + 16, signatureW, regular, 4.7, MUTED);

      const sealX = officialX + 56;
      const sealW = 48;
      drawImageContained(back, seal, sealX + 2, officialY + 24, sealW - 4, 42);
      drawCenteredText(back, "Cachet officiel ADEIO", sealX, officialY + 16, sealW, regular, 4.4, MUTED);
    }
  }

  const bytes = await pdf.save();
  const photoWarnings = prepared.filter((item) => item.photoMissing).length;
  return new NextResponse(new Uint8Array(bytes), { headers: {
    "content-type": "application/pdf",
    "content-disposition": "attachment; filename=cartes-membres-adeio-recto-verso.pdf",
    "cache-control": "no-store",
    "x-adeio-photo-warning": String(photoWarnings),
  } });
}
