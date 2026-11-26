"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInUser } from "@/lib/auth";

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  joinedYear: z.coerce.number().int().min(1900).max(2200),
  exitYear: z.coerce.number().int().min(1900).max(2200),
  studyProgram: z.string().trim().min(2).max(160),
  institution: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(6).max(40),
  sex: z.enum(["female", "male"]).or(z.literal("")),
});

const textValue = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

async function validPhoto(entry: FormDataEntryValue | null) {
  if (!(entry instanceof File) || entry.size === 0) return null;
  if (!["image/jpeg", "image/webp"].includes(entry.type) || entry.size > 500_000) return false;
  const header = new Uint8Array(await entry.slice(0, 12).arrayBuffer());
  const validJpeg = entry.type === "image/jpeg" && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const validWebp = entry.type === "image/webp" && String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  return validJpeg || validWebp ? entry : false;
}

export async function saveOwnMemberProfileAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=%2Fespace-membre%2Fprofil");
  if (!roles.includes("member")) redirect("/espace-membre?erreur=acces-refuse");
  if (roles.includes("admin") || roles.includes("super_admin")) redirect("/admin");

  const parsed = profileSchema.safeParse({
    firstName: textValue(formData, "first_name"),
    lastName: textValue(formData, "last_name"),
    joinedYear: textValue(formData, "joined_year"),
    exitYear: textValue(formData, "exit_year"),
    studyProgram: textValue(formData, "study_program"),
    institution: textValue(formData, "institution"),
    phone: textValue(formData, "phone"),
    sex: textValue(formData, "sex"),
  });
  if (!parsed.success) redirect("/espace-membre/profil?erreur=profil-invalide");
  const input = parsed.data;
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (input.exitYear <= currentYear || input.exitYear < input.joinedYear) redirect("/espace-membre/profil?erreur=annee-sortie-invalide");

  const photo = await validPhoto(formData.get("photo"));
  if (photo === false) redirect("/espace-membre/profil?erreur=photo-invalide");
  const [{ data: member }, { data: onboarding }, { data: profile }] = await Promise.all([
    supabase.from("members").select("id,joined_year,photo_path,status").eq("user_id", user.id).maybeSingle(),
    supabase.from("member_onboarding").select("kind,status,member_id").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("must_change_password").eq("user_id", user.id).maybeSingle(),
  ]);
  if (profile?.must_change_password) redirect("/mot-de-passe");
  const isReactivation = member?.status === "former" && onboarding?.kind === "reactivation" && onboarding.status === "pending";
  if (member?.status === "former" && !isReactivation) redirect("/espace-membre/profil?erreur=reactivation-requise");
  if (isReactivation && !photo) redirect("/espace-membre/profil?erreur=photo-reactivation-requise");

  const { data: memberId, error: saveError } = await supabase.rpc("complete_own_member_profile", {
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_joined_year: input.joinedYear,
    p_exit_year: input.exitYear,
    p_study_program: input.studyProgram,
    p_institution: input.institution,
    p_phone: input.phone,
    p_sex: input.sex || null,
  });
  if (saveError || !memberId) {
    const message = saveError?.message?.includes("arrivée à échéance") ? "annee-sortie-atteinte"
      : saveError?.message?.includes("années validées") ? "annees-validees-verrouillees"
      : saveError?.code === "42501" ? "dossier-introuvable" : "enregistrement-impossible";
    redirect(`/espace-membre/profil?erreur=${message}`);
  }

  let previousPhotoPath: string | null = member?.photo_path ?? null;
  if (photo) {
    const storagePath = `${memberId}/${randomUUID()}.${photo.type === "image/webp" ? "webp" : "jpg"}`;
    const { error: uploadError } = await supabase.storage.from("member-photos").upload(storagePath, photo, { contentType: photo.type, upsert: false });
    if (uploadError) redirect("/espace-membre/profil?erreur=photo-envoi-impossible");
    const { data: previous, error: photoLinkError } = await supabase.rpc("set_own_member_photo", { p_storage_path: storagePath });
    if (photoLinkError) {
      await supabase.storage.from("member-photos").remove([storagePath]);
      redirect("/espace-membre/profil?erreur=photo-liaison-impossible");
    }
    previousPhotoPath = typeof previous === "string" ? previous : previousPhotoPath;
    if (previousPhotoPath && previousPhotoPath !== storagePath) await supabase.storage.from("member-photos").remove([previousPhotoPath]);
  }

  const { error: consentError } = await supabase.rpc("set_own_member_photo_consent", { p_consent: formData.get("photo_public_consent") === "on" });
  if (consentError) redirect("/espace-membre/profil?erreur=consentement-impossible");

  if (isReactivation) {
    const { error } = await supabase.rpc("submit_own_reactivation_profile");
    if (error) redirect("/espace-membre/profil?erreur=reactivation-envoi-impossible");
  }

  revalidatePath("/espace-membre");
  revalidatePath("/espace-membre/profil");
  revalidatePath("/membres");
  revalidatePath("/archives");
  revalidatePath("/admin/membres");
  redirect(`/espace-membre/profil?statut=${isReactivation ? "reactivation-soumise" : "profil-enregistre"}`);
}
