import { randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";

const importRowSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  joinedYear: z.coerce.number().int().min(1900).max(2200),
  exitYear: z.number().int().min(1900).max(2200),
  status: z.enum(["active", "former", "suspended", "deceased"]).default("active"),
  phone: z.string().trim().min(6).max(40),
  studyProgram: z.string().trim().min(2).max(160),
  institution: z.string().trim().min(2).max(200),
  sex: z.enum(["female", "male", "other", "prefer_not_to_say"]),
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
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  for (let index = 0; index < body.rows.length; index += 1) {
    const parsed = importRowSchema.safeParse(body.rows[index]);
    const rowNumber = index + 2;
    if (!parsed.success || parsed.data.exitYear < parsed.data.joinedYear || (parsed.data.status === "active" && parsed.data.exitYear <= currentYear)) {
      report.push({ row: rowNumber, ok: false, message: parsed.success ? "Vérifiez l’année de sortie ; elle doit être future pour un membre actif." : parsed.error.issues[0]?.message ?? "Ligne invalide." });
      continue;
    }
    const item = parsed.data;
    try {
      const memberNumber = await generateMemberNumber(supabase, item.joinedYear);
      const { error } = await supabase.rpc("admin_create_member", {
        p_member_number: memberNumber, p_first_name: item.firstName, p_last_name: item.lastName,
        p_joined_year: item.joinedYear, p_exit_year: item.exitYear, p_study_program: item.studyProgram,
        p_institution: item.institution, p_phone: item.phone, p_sex: item.sex,
        p_status: item.status, p_user_id: null, p_photo_public_consent: false,
      });
      if (error) throw new Error(error.code === "23505" ? "Doublon détecté." : "La fiche ou son historique n’a pas pu être créé.");
      report.push({ row: rowNumber, ok: true, message: `Importé : ${memberNumber}` });
    } catch (error) {
      report.push({ row: rowNumber, ok: false, message: error instanceof Error ? error.message : "Échec de l’import." });
    }
  }
  return NextResponse.json({ report, imported: report.filter((item) => item.ok).length, rejected: report.filter((item) => !item.ok).length });
}
