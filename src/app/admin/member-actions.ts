"use server";

import { randomInt, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";

const memberSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  joinedYear: z.coerce.number().int().min(1900).max(2200),
  exitYear: z.preprocess((value) => value === "" ? undefined : Number(value), z.number().int().min(1900).max(2200).optional()),
  status: z.enum(["active", "former", "suspended", "deceased"]),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  phone: z.string().trim().max(40).optional(),
  userId: z.union([z.string().uuid(), z.literal("")]).optional(),
  photoConsent: z.boolean(),
});

function value(form: FormData, key: string) {
  const entry = form.get(key);
  return typeof entry === "string" ? entry : "";
}

async function adminContext(nextPath: string) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect(`/connexion?next=${encodeURIComponent(nextPath)}`);
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect(`/auth/mfa?next=${encodeURIComponent(nextPath)}`);
  return { supabase, user };
}

function parseMember(formData: FormData) {
  return memberSchema.safeParse({
    firstName: value(formData, "first_name"),
    lastName: value(formData, "last_name"),
    joinedYear: value(formData, "joined_year"),
    exitYear: value(formData, "exit_year"),
    status: value(formData, "status"),
    email: value(formData, "email"),
    phone: value(formData, "phone"),
    userId: value(formData, "user_id"),
    photoConsent: formData.get("photo_public_consent") === "on",
  });
}

async function nextMemberNumber(supabase: NonNullable<Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>>, year: number) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = randomInt(0, 36 ** 4).toString(36).toUpperCase().padStart(4, "0");
    const number = `ADEIO-${year}-${suffix}`;
    const { data } = await supabase.from("members").select("id").eq("member_number", number).maybeSingle();
    if (!data) return number;
  }
  throw new Error("Impossible de générer un numéro membre unique.");
}

export async function createMemberAction(formData: FormData) {
  const { supabase, user } = await adminContext("/admin/membres/nouveau");
  const parsed = parseMember(formData);
  if (!parsed.success || (parsed.data.exitYear && parsed.data.exitYear < parsed.data.joinedYear)) redirect("/admin/membres/nouveau?erreur=formulaire-invalide");
  const input = parsed.data;
  let memberNumber: string;
  try { memberNumber = await nextMemberNumber(supabase, input.joinedYear); }
  catch { redirect("/admin/membres/nouveau?erreur=numero-impossible"); }

  const { data: member, error } = await supabase.from("members").insert({
    member_number: memberNumber,
    first_name: input.firstName,
    last_name: input.lastName,
    joined_year: input.joinedYear,
    status: input.status,
    user_id: input.userId || null,
    photo_public_consent: input.photoConsent,
    created_by: user.id,
  }).select("id").single();
  if (error || !member) redirect(`/admin/membres/nouveau?erreur=${encodeURIComponent(error?.code === "23505" ? "numero-existant" : "creation-impossible")}`);

  const { error: periodError } = await supabase.from("membership_periods").insert({
    member_id: member.id,
    starts_on: `${input.joinedYear}-01-01`,
    ends_on: input.exitYear ? `${input.exitYear}-12-31` : null,
    created_by: user.id,
  });
  const { error: detailsError } = await supabase.from("member_private_details").upsert({ member_id: member.id, email: input.email || null, phone: input.phone || null });
  if (periodError || detailsError) {
    await supabase.from("members").delete().eq("id", member.id);
    redirect("/admin/membres/nouveau?erreur=creation-impossible");
  }
  revalidatePath("/admin/membres");
  revalidatePath("/admin/archives");
  revalidatePath("/membres");
  revalidatePath("/archives");
  revalidatePath("/");
  redirect(`/admin/membres/${member.id}?statut=membre-cree`);
}

export async function updateMemberAction(formData: FormData) {
  const id = value(formData, "id");
  if (!z.string().uuid().safeParse(id).success) redirect("/admin/membres?erreur=membre-introuvable");
  const nextPath = `/admin/membres/${id}`;
  const { supabase } = await adminContext(nextPath);
  const parsed = parseMember(formData);
  if (!parsed.success || (parsed.data.exitYear && parsed.data.exitYear < parsed.data.joinedYear)) redirect(`${nextPath}?erreur=formulaire-invalide`);
  const input = parsed.data;
  const { error } = await supabase.from("members").update({
    first_name: input.firstName, last_name: input.lastName, joined_year: input.joinedYear,
    status: input.status, user_id: input.userId || null, photo_public_consent: input.photoConsent,
  }).eq("id", id);
  if (error) redirect(`${nextPath}?erreur=modification-impossible`);
  const { error: detailError } = await supabase.from("member_private_details").upsert({ member_id: id, email: input.email || null, phone: input.phone || null });
  if (detailError) redirect(`${nextPath}?erreur=modification-impossible`);
  // Conserver les intervalles historiques ; mettre à jour uniquement l'intervalle initial créé avec la fiche.
  const { data: periods } = await supabase.from("membership_periods").select("id,starts_on,ends_on").eq("member_id", id).order("starts_on", { ascending: true }).limit(1);
  if (periods?.[0]) {
    const initial = periods[0];
    const { error: periodError } = await supabase.from("membership_periods").update({
      starts_on: `${input.joinedYear}-01-01`,
      ends_on: input.exitYear ? `${input.exitYear}-12-31` : null,
    }).eq("id", initial.id);
    if (periodError) redirect(`${nextPath}?erreur=modification-impossible`);
  }
  revalidatePath("/admin/membres"); revalidatePath("/admin/archives"); revalidatePath("/membres"); revalidatePath("/archives"); revalidatePath(nextPath);
  redirect(`${nextPath}?statut=membre-modifie`);
}

export async function addMembershipPeriodAction(formData: FormData) {
  const id = value(formData, "member_id");
  if (!z.string().uuid().safeParse(id).success) redirect("/admin/membres?erreur=membre-introuvable");
  const path = `/admin/membres/${id}`;
  const { supabase, user } = await adminContext(path);
  const parsed = z.object({ startsOn: z.string().date(), endsOn: z.union([z.string().date(), z.literal("")]), note: z.string().trim().max(200) }).safeParse({
    startsOn: value(formData, "starts_on"), endsOn: value(formData, "ends_on"), note: value(formData, "note"),
  });
  if (!parsed.success || (parsed.data.endsOn && parsed.data.endsOn < parsed.data.startsOn)) redirect(`${path}?erreur=periode-invalide`);
  const { error } = await supabase.from("membership_periods").insert({ member_id: id, starts_on: parsed.data.startsOn, ends_on: parsed.data.endsOn || null, note: parsed.data.note || null, created_by: user.id });
  if (error) redirect(`${path}?erreur=periode-impossible`);
  revalidatePath(path); revalidatePath("/admin/archives"); revalidatePath("/archives");
  redirect(`${path}?statut=periode-ajoutee`);
}

export async function uploadMemberPhotoAction(formData: FormData) {
  const id = value(formData, "member_id");
  if (!z.string().uuid().safeParse(id).success) redirect("/admin/membres?erreur=membre-introuvable");
  const path = `/admin/membres/${id}`;
  const { supabase } = await adminContext(path);
  const file = formData.get("photo");
  if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 850_000) redirect(`${path}?erreur=photo-invalide`);
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storagePath = `${id}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("member-photos").upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) redirect(`${path}?erreur=photo-impossible`);
  const { data: previous } = await supabase.from("members").select("photo_path").eq("id", id).single();
  const { error } = await supabase.from("members").update({ photo_path: storagePath }).eq("id", id);
  if (error) {
    await supabase.storage.from("member-photos").remove([storagePath]);
    redirect(`${path}?erreur=photo-impossible`);
  }
  if (previous?.photo_path) await supabase.storage.from("member-photos").remove([previous.photo_path]);
  revalidatePath(path); revalidatePath("/membres"); revalidatePath("/bureau");
  redirect(`${path}?statut=photo-enregistree`);
}
