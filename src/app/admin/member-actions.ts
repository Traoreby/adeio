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
  exitYear: z.preprocess((value) => value === "" ? Number.NaN : Number(value), z.number().int().min(1900).max(2200)),
  studyProgram: z.string().trim().min(2).max(160),
  institution: z.string().trim().min(2).max(200),
  sex: z.enum(["female", "male", "other", "prefer_not_to_say"]),
  status: z.enum(["active", "former", "suspended", "deceased"]),
  phone: z.string().trim().min(6).max(40),
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
  return { supabase, user, roles };
}

function parseMember(formData: FormData) {
  return memberSchema.safeParse({
    firstName: value(formData, "first_name"),
    lastName: value(formData, "last_name"),
    joinedYear: value(formData, "joined_year"),
    exitYear: value(formData, "exit_year"),
    studyProgram: value(formData, "study_program"),
    institution: value(formData, "institution"),
    sex: value(formData, "sex"),
    status: value(formData, "status"),
    phone: value(formData, "phone"),
    userId: value(formData, "user_id"),
    photoConsent: formData.get("photo_public_consent") === "on",
  });
}

async function validMemberPhoto(entry: FormDataEntryValue | null) {
  if (!(entry instanceof File) || entry.size === 0) return null;
  if (!["image/jpeg", "image/webp"].includes(entry.type) || entry.size > 500_000) return false;
  const header = new Uint8Array(await entry.slice(0, 12).arrayBuffer());
  const validJpeg = entry.type === "image/jpeg" && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const validWebp = entry.type === "image/webp" && String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  return validJpeg || validWebp ? entry : false;
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
  const { supabase } = await adminContext("/admin/membres/nouveau");
  const parsed = parseMember(formData);
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (!parsed.success || parsed.data.exitYear < parsed.data.joinedYear
    || (parsed.data.status === "active" && parsed.data.exitYear <= currentYear)) redirect("/admin/membres/nouveau?erreur=formulaire-invalide");
  const input = parsed.data;
  if (input.userId) {
    const { data: onboarding } = await supabase.from("member_onboarding").select("kind").eq("user_id", input.userId).maybeSingle();
    if (onboarding?.kind === "reactivation") redirect("/admin/membres/nouveau?erreur=compte-en-reactivation");
  }
  const photo = await validMemberPhoto(formData.get("photo"));
  if (photo === false) redirect("/admin/membres/nouveau?erreur=photo-invalide");
  let memberNumber: string;
  try { memberNumber = await nextMemberNumber(supabase, input.joinedYear); }
  catch { redirect("/admin/membres/nouveau?erreur=numero-impossible"); }

  const { data: memberId, error } = await supabase.rpc("admin_create_member", {
    p_member_number: memberNumber, p_first_name: input.firstName, p_last_name: input.lastName,
    p_joined_year: input.joinedYear, p_exit_year: input.exitYear, p_study_program: input.studyProgram,
    p_institution: input.institution, p_phone: input.phone, p_sex: input.sex, p_status: input.status,
    p_user_id: input.userId || null, p_photo_public_consent: input.photoConsent,
  });
  if (error || !memberId) redirect(`/admin/membres/nouveau?erreur=${encodeURIComponent(error?.code === "23505" ? "numero-existant" : "creation-impossible")}`);

  if (photo) {
    const storagePath = `${memberId}/${randomUUID()}.${photo.type === "image/webp" ? "webp" : "jpg"}`;
    const { error: photoUploadError } = await supabase.storage.from("member-photos").upload(storagePath, photo, { contentType: photo.type, upsert: false });
    if (photoUploadError) redirect(`/admin/membres/${memberId}?erreur=photo-impossible`);
    const { error: photoLinkError } = await supabase.from("members").update({ photo_path: storagePath }).eq("id", memberId);
    if (photoLinkError) {
      await supabase.storage.from("member-photos").remove([storagePath]);
      redirect(`/admin/membres/${memberId}?erreur=photo-impossible`);
    }
  }
  revalidatePath("/admin/membres");
  revalidatePath("/admin/archives");
  revalidatePath("/membres");
  revalidatePath("/archives");
  revalidatePath("/");
  redirect(`/admin/membres/${memberId}?statut=membre-cree`);
}

export async function updateMemberAction(formData: FormData) {
  const id = value(formData, "id");
  if (!z.string().uuid().safeParse(id).success) redirect("/admin/membres?erreur=membre-introuvable");
  const nextPath = `/admin/membres/${id}`;
  const { supabase } = await adminContext(nextPath);
  const parsed = parseMember(formData);
  if (!parsed.success || parsed.data.exitYear < parsed.data.joinedYear) redirect(`${nextPath}?erreur=formulaire-invalide`);
  const input = parsed.data;
  const { data: existing } = await supabase.from("members").select("status,joined_year,user_id").eq("id", id).maybeSingle();
  if (!existing) redirect("/admin/membres?erreur=membre-introuvable");
  if (existing.status !== "active" && input.status === "active") redirect(`${nextPath}?erreur=utiliser-reactivation`);
  if (input.status === "active" && input.exitYear <= Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()))) redirect(`${nextPath}?erreur=annee-sortie-invalide`);
  if (input.joinedYear !== existing.joined_year) redirect(`${nextPath}?erreur=annee-initiale-immuable`);
  if (existing.user_id && input.userId !== existing.user_id) redirect(`${nextPath}?erreur=compte-lie-immuable`);
  if (!existing.user_id && input.userId) {
    const { data: onboarding } = await supabase.from("member_onboarding").select("kind").eq("user_id", input.userId).maybeSingle();
    if (onboarding?.kind === "reactivation") redirect(`${nextPath}?erreur=compte-en-reactivation`);
  }
  const { error } = await supabase.rpc("admin_update_member_profile", {
    p_member_id: id, p_first_name: input.firstName, p_last_name: input.lastName, p_exit_year: input.exitYear,
    p_study_program: input.studyProgram, p_institution: input.institution, p_phone: input.phone,
    p_sex: input.sex, p_status: input.status, p_user_id: input.userId || null,
    p_photo_public_consent: input.photoConsent,
  });
  if (error) redirect(`${nextPath}?erreur=${encodeURIComponent(error.code === "42501" ? "utiliser-reactivation" : "modification-impossible")}`);
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
  const photo = await validMemberPhoto(formData.get("photo"));
  if (!photo) redirect(`${path}?erreur=photo-invalide`);
  const { data: previous } = await supabase.from("members").select("photo_path").eq("id", id).single();
  if (!previous) redirect(`${path}?erreur=membre-introuvable`);
  const extension = photo.type === "image/webp" ? "webp" : "jpg";
  const storagePath = `${id}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("member-photos").upload(storagePath, photo, { contentType: photo.type, upsert: false });
  if (uploadError) redirect(`${path}?erreur=photo-impossible`);
  const { error } = await supabase.from("members").update({ photo_path: storagePath }).eq("id", id);
  if (error) {
    await supabase.storage.from("member-photos").remove([storagePath]);
    redirect(`${path}?erreur=photo-impossible`);
  }
  if (previous?.photo_path) await supabase.storage.from("member-photos").remove([previous.photo_path]);
  revalidatePath(path); revalidatePath("/membres"); revalidatePath("/bureau");
  redirect(`${path}?statut=photo-enregistree`);
}

export async function removeMemberPhotoAction(formData: FormData) {
  const id = value(formData, "member_id");
  if (!z.string().uuid().safeParse(id).success) redirect("/admin/membres?erreur=membre-introuvable");
  const path = `/admin/membres/${id}`;
  const { supabase } = await adminContext(path);
  const { data: member } = await supabase.from("members").select("photo_path").eq("id", id).maybeSingle();
  if (!member) redirect(`${path}?erreur=membre-introuvable`);
  const { error } = await supabase.from("members").update({ photo_path: null, photo_public_consent: false }).eq("id", id);
  if (error) redirect(`${path}?erreur=photo-impossible`);
  if (member.photo_path) await supabase.storage.from("member-photos").remove([member.photo_path]);
  revalidatePath(path); revalidatePath("/membres"); revalidatePath("/bureau"); revalidatePath("/verification");
  redirect(`${path}?statut=photo-supprimee`);
}

export async function deleteMemberAction(formData: FormData) {
  const id = value(formData, "member_id");
  if (!z.string().uuid().safeParse(id).success) redirect("/admin/membres?erreur=membre-introuvable");
  const path = `/admin/membres/${id}`;
  const { supabase, roles } = await adminContext(path);
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const { data: member } = await supabase.from("members").select("id,photo_path").eq("id", id).maybeSingle();
  if (!member) redirect("/admin/membres?erreur=membre-introuvable");
  const { data: deleted, error } = await supabase.from("members").delete().eq("id", id).select("id").maybeSingle();
  if (error || !deleted) redirect(`${path}?erreur=suppression-impossible`);
  if (member.photo_path) await supabase.storage.from("member-photos").remove([member.photo_path]);
  revalidatePath("/admin/membres"); revalidatePath("/admin/archives"); revalidatePath("/membres"); revalidatePath("/archives"); revalidatePath("/bureau"); revalidatePath("/");
  redirect("/admin/membres?statut=membre-supprime");
}

export async function anonymizeMemberAction(formData: FormData) {
  const id = value(formData, "member_id");
  if (!z.string().uuid().safeParse(id).success) redirect("/admin/membres?erreur=membre-introuvable");
  const path = `/admin/membres/${id}`;
  const { supabase, roles } = await adminContext(path);
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const { data: member } = await supabase.from("members").select("joined_year").eq("id", id).maybeSingle();
  if (!member) redirect("/admin/membres?erreur=membre-introuvable");
  let anonymizedNumber: string;
  try { anonymizedNumber = await nextMemberNumber(supabase, member.joined_year); }
  catch { redirect(`${path}?erreur=anonymisation-impossible`); }
  const { data: oldPhoto, error } = await supabase.rpc("anonymize_member", { p_member_id: id, p_member_number: anonymizedNumber });
  if (error) redirect(`${path}?erreur=anonymisation-impossible`);
  if (oldPhoto) await supabase.storage.from("member-photos").remove([oldPhoto]);
  revalidatePath(path); revalidatePath("/admin/membres"); revalidatePath("/admin/archives"); revalidatePath("/membres"); revalidatePath("/archives"); revalidatePath("/bureau"); revalidatePath("/");
  redirect(`${path}?statut=membre-anonymise`);
}
