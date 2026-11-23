import { randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";

const importRowSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  joinedYear: z.coerce.number().int().min(1900).max(2200),
  exitYear: z.union([z.number().int().min(1900).max(2200), z.null()]).optional(),
  status: z.enum(["active", "former", "suspended", "deceased"]).default("active"),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  phone: z.string().trim().max(40).optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function generateMemberNumber(supabase: NonNullable<Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>>, year: number) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = randomInt(0, 36 ** 4).toString(36).toUpperCase().padStart(4, "0");
    const number = `ADEIO-${year}-${suffix}`;
    const { data } = await supabase.from("members").select("id").eq("member_number", number).maybeSingle();
    if (!data) return number;
  }
  throw new Error("Numéro membre indisponible.");
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) return jsonError("Origine de requête invalide.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return jsonError("Format de requête invalide.", 415);
  if (Number(request.headers.get("content-length") ?? 0) > 1_000_000) return jsonError("Le fichier dépasse la taille autorisée.", 413);

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 250) return jsonError("L’import doit contenir de 1 à 250 lignes.", 400);
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return jsonError("Connectez-vous pour continuer.", 401);
  if (!roles.some((role) => role === "admin" || role === "super_admin")) return jsonError("Accès réservé à l’administration.", 403);
  if (!await hasRequiredMfa(supabase, user.id)) return jsonError("Validez votre authentification à deux facteurs.", 403);

  const report: { row: number; ok: boolean; message: string }[] = [];
  for (let index = 0; index < body.rows.length; index += 1) {
    const parsed = importRowSchema.safeParse(body.rows[index]);
    const rowNumber = index + 2;
    if (!parsed.success || (parsed.data.exitYear && parsed.data.exitYear < parsed.data.joinedYear)) {
      report.push({ row: rowNumber, ok: false, message: parsed.success ? "L’année de sortie précède l’année d’entrée." : parsed.error.issues[0]?.message ?? "Ligne invalide." });
      continue;
    }
    const item = parsed.data;
    try {
      const memberNumber = await generateMemberNumber(supabase, item.joinedYear);
      const { data: member, error } = await supabase.from("members").insert({
        member_number: memberNumber, first_name: item.firstName, last_name: item.lastName,
        joined_year: item.joinedYear, status: item.status, created_by: user.id,
      }).select("id").single();
      if (error || !member) throw new Error(error?.code === "23505" ? "Doublon détecté." : "La fiche membre n’a pas été créée.");
      const { error: periodError } = await supabase.from("membership_periods").insert({
        member_id: member.id, starts_on: `${item.joinedYear}-01-01`, ends_on: item.exitYear ? `${item.exitYear}-12-31` : null, created_by: user.id,
      });
      const { error: detailError } = await supabase.from("member_private_details").insert({ member_id: member.id, email: item.email || null, phone: item.phone || null });
      if (periodError || detailError) {
        await supabase.from("members").delete().eq("id", member.id);
        throw new Error("La période ou les coordonnées n’ont pas été enregistrées.");
      }
      report.push({ row: rowNumber, ok: true, message: `Importé : ${memberNumber}` });
    } catch (error) {
      report.push({ row: rowNumber, ok: false, message: error instanceof Error ? error.message : "Échec de l’import." });
    }
  }
  return NextResponse.json({ report, imported: report.filter((item) => item.ok).length, rejected: report.filter((item) => !item.ok).length });
}
