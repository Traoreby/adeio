import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { issueMemberToken } from "@/lib/member-qr-crypto";

const inputSchema = z.object({ memberIds: z.array(z.string().uuid()).min(1).max(100) });

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Origine de requête invalide." }, { status: 403 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || new Set(parsed.data?.memberIds).size !== parsed.data?.memberIds.length) return NextResponse.json({ error: "Sélection de membres invalide (100 membres maximum)." }, { status: 400 });

  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return NextResponse.json({ error: "Connectez-vous pour continuer." }, { status: 401 });
  if (!roles.some((role) => role === "admin" || role === "super_admin")) return NextResponse.json({ error: "Accès réservé à l’administration." }, { status: 403 });
  if (!await hasRequiredMfa(supabase, user.id)) return NextResponse.json({ error: "Validez votre authentification à deux facteurs." }, { status: 403 });

  const { data: members, error } = await supabase.from("members")
    .select("id,status,exit_year,reactivation_photo_required")
    .in("id", parsed.data.memberIds);
  if (error || !members || members.length !== parsed.data.memberIds.length) return NextResponse.json({ error: "Un ou plusieurs membres sont introuvables." }, { status: 404 });
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (members.some((member) => member.status !== "active" || member.reactivation_photo_required || member.exit_year === null || member.exit_year <= currentYear)) {
    return NextResponse.json({ error: "La sélection contient un membre inactif ou dont le profil doit être actualisé." }, { status: 409 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const write = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      void (async () => {
        const failed: { memberId: string; reason: string }[] = [];
        let issued = 0;
        for (let offset = 0; offset < members.length; offset += 10) {
          const chunk = members.slice(offset, offset + 10);
          const results = await Promise.all(chunk.map(async (member) => {
            try {
              const token = issueMemberToken();
              const { error: issueError } = await supabase.rpc("issue_member_qr", {
                p_member_id: member.id,
                p_token_hash: token.tokenHash,
                p_encrypted_token: token.encryptedToken,
                p_nonce: token.nonce,
                p_tag: token.tag,
                p_key_version: token.keyVersion,
              });
              return { memberId: member.id, ok: !issueError, reason: issueError ? "Le QR n’a pas pu être émis." : undefined };
            } catch {
              return { memberId: member.id, ok: false, reason: "ADEIO_QR_ENCRYPTION_KEY_V1 est absente ou invalide sur le serveur." };
            }
          }));
          issued += results.filter((result) => result.ok).length;
          failed.push(...results.filter((result): result is { memberId: string; ok: false; reason: string } => !result.ok));
          write({ type: "progress", completed: Math.min(offset + chunk.length, members.length), total: members.length, issued });
        }
        write({ type: "complete", issued, failed, message: `${issued} QR émis sur ${members.length}. Les QR existants des membres traités ont été définitivement révoqués.` });
        controller.close();
      })().catch(() => {
        write({ type: "error", message: "Le traitement du lot a été interrompu. Vérifiez les fiches avant de relancer pour éviter une réémission inutile." });
        controller.close();
      });
    },
  });
  return new NextResponse(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
