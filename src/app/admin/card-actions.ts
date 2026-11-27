"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const memberIdSchema = z.string().uuid();

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function requireCardSuperAdmin(nextPath: string) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect(`/connexion?next=${encodeURIComponent(nextPath)}`);
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect(`/auth/mfa?next=${encodeURIComponent(nextPath)}`);
  return { supabase, user };
}

export async function reviewMemberCardAction(formData: FormData) {
  const memberId = memberIdSchema.safeParse(field(formData, "member_id"));
  if (!memberId.success) redirect("/admin/membres?erreur=membre-introuvable");
  const path = `/admin/membres/${memberId.data}`;
  const { supabase } = await requireCardSuperAdmin(path);
  const parsed = z.object({
    joinedYear: z.coerce.number().int().min(1900).max(2200),
    exitYear: z.coerce.number().int().min(1900).max(2200),
  }).safeParse({
    joinedYear: field(formData, "joined_year"),
    exitYear: field(formData, "exit_year"),
  });
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (!parsed.success || parsed.data.joinedYear > currentYear || parsed.data.exitYear < parsed.data.joinedYear || parsed.data.exitYear < currentYear) {
    redirect(`${path}?erreur=validation-carte-invalide`);
  }
  const { error } = await supabase.rpc("review_member_card", {
    p_member_id: memberId.data,
    p_decision: "approved",
    p_joined_year: parsed.data.joinedYear,
    p_exit_year: parsed.data.exitYear,
    p_comment: null,
  });
  if (error) {
    const errorKey = error.code === "42501"
      ? "acces-refuse"
      : error.code === "23514"
        ? "validation-carte-invalide"
        : error.code === "P0002"
          ? "membre-introuvable"
          : "validation-carte-impossible";
    redirect(`${path}?erreur=${errorKey}`);
  }
  revalidatePath(path);
  revalidatePath("/admin/qr-codes");
  redirect(`${path}?statut=carte-informations-validees`);
}

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export async function uploadMemberCardOfficialAssetAction(formData: FormData) {
  const kind = z.enum(["signature", "seal"]).safeParse(field(formData, "asset_kind"));
  if (!kind.success) redirect("/admin/parametres/carte-membre?erreur=fichier-invalide");
  const { supabase } = await requireCardSuperAdmin("/admin/parametres/carte-membre");
  const value = formData.get("asset");
  if (!(value instanceof File) || value.size < 8 || value.size > 1024 * 1024 || value.type !== "image/png") {
    redirect("/admin/parametres/carte-membre?erreur=png-invalide");
  }
  const header = new Uint8Array(await value.slice(0, 8).arrayBuffer());
  if (!pngSignature.every((byte, index) => header[index] === byte)) redirect("/admin/parametres/carte-membre?erreur=png-invalide");
  const service = createSupabaseServiceClient();
  if (!service) redirect("/admin/parametres/carte-membre?erreur=service-indisponible");

  const path = `${kind.data}/${randomUUID()}.png`;
  const { error: uploadError } = await service.storage.from("member-card-official-assets").upload(path, value, {
    contentType: "image/png",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) redirect("/admin/parametres/carte-membre?erreur=upload-impossible");

  const { error: registerError } = await supabase.rpc("set_member_card_official_asset", {
    p_asset_kind: kind.data,
    p_storage_path: path,
  });
  if (registerError) {
    await service.storage.from("member-card-official-assets").remove([path]);
    redirect("/admin/parametres/carte-membre?erreur=enregistrement-impossible");
  }
  revalidatePath("/admin/parametres/carte-membre");
  revalidatePath("/admin/qr-codes");
  redirect(`/admin/parametres/carte-membre?statut=${kind.data}-enregistre`);
}
