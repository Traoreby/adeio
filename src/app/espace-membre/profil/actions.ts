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
  studyProgramId: z.string().uuid(),
  institutionId: z.string().uuid(),
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

export type MemberProfileActionResult = { error?: string; success?: string; redirectTo?: string };

export async function saveOwnMemberProfileAction(_previous: MemberProfileActionResult, formData: FormData): Promise<MemberProfileActionResult> {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=%2Fespace-membre%2Fprofil");
  if (!roles.includes("member")) redirect("/espace-membre?erreur=acces-refuse");
  if (roles.includes("admin") || roles.includes("super_admin")) redirect("/admin");

  const parsed = profileSchema.safeParse({
    firstName: textValue(formData, "first_name"),
    lastName: textValue(formData, "last_name"),
    joinedYear: textValue(formData, "joined_year"),
    exitYear: textValue(formData, "exit_year"),
    studyProgramId: textValue(formData, "study_program_id"),
    institutionId: textValue(formData, "institution_id"),
    phone: textValue(formData, "phone"),
    sex: textValue(formData, "sex"),
  });
  if (!parsed.success) return { error: "Complétez tous les champs obligatoires avec des valeurs valides." };
  const input = parsed.data;
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (input.exitYear < currentYear || input.exitYear < input.joinedYear) return { error: "L’année de fin de cycle ne peut pas être antérieure à l’année en cours ni à l’année d’adhésion." };

  // FormData is untrusted: resolve submitted IDs against the active references
  // before calling the profile RPC. The database trigger validates active names
  // again when it writes the education period.
  const [{ data: studyProgram, error: studyProgramError }, { data: institution, error: institutionError }] = await Promise.all([
    supabase.from("study_programs").select("id,name").eq("id", input.studyProgramId).eq("is_active", true).maybeSingle(),
    supabase.from("member_institutions").select("id,name").eq("id", input.institutionId).eq("is_active", true).maybeSingle(),
  ]);
  if (studyProgramError || institutionError) return { error: "Les listes de filières et d’établissements n’ont pas pu être vérifiées. Réessayez." };
  if (!studyProgram) return { error: "Choisissez une filière active dans la liste. Si elle manque, contactez l’administration ADEIO." };
  if (!institution) return { error: "Choisissez un établissement actif dans la liste. Si celui-ci manque, contactez l’administration ADEIO." };

  const photo = await validPhoto(formData.get("photo"));
  if (photo === false) return { error: "La photo doit être une image WebP ou JPEG compressée de 500 Ko maximum." };
  const [{ data: member, error: memberError }, { data: onboarding, error: onboardingError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.from("members").select("id,joined_year,photo_path,status").eq("user_id", user.id).maybeSingle(),
    supabase.from("member_onboarding").select("kind,status,member_id").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("must_change_password").eq("user_id", user.id).maybeSingle(),
  ]);
  if (memberError || onboardingError || profileError) return { error: "Le dossier membre n’a pas pu être chargé. Réessayez dans quelques instants." };
  if (profile?.must_change_password) redirect("/mot-de-passe");
  const isReactivation = member?.status === "former" && onboarding?.kind === "reactivation" && onboarding.status === "pending";
  if (member?.status === "former" && !isReactivation) return { error: "Votre compte est archivé. Contactez l’administration pour demander une réactivation." };
  if (isReactivation && !photo) return { error: "Pour demander la réactivation, une nouvelle photo doit être prise ou importée." };

  try {
    const { data: memberId, error: saveError } = await supabase.rpc("complete_own_member_profile", {
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_joined_year: input.joinedYear,
      p_exit_year: input.exitYear,
      p_study_program: studyProgram.name,
      p_institution: institution.name,
      p_phone: input.phone,
      p_sex: input.sex || null,
    });
    if (saveError || !memberId) {
      if (saveError?.message?.includes("filière active")) return { error: "Choisissez une filière active dans la liste. Si elle manque, contactez l’administration ADEIO." };
      if (saveError?.message?.includes("établissement actif")) return { error: "Choisissez un établissement actif dans la liste. Si celui-ci manque, contactez l’administration ADEIO." };
      if (saveError?.message?.includes("arrivée à échéance")) return { error: "Votre année de fin de cycle est atteinte. Seule l’administration peut décider d’une réactivation." };
      if (saveError?.message?.includes("années validées")) return { error: "Vos années ont été validées et sont verrouillées. Contactez le Super Admin pour demander une correction." };
      if (saveError?.code === "42501") return { error: "Aucun dossier ADEIO en attente n’est associé à ce compte. Contactez l’administration." };
      return { error: "Le profil n’a pas pu être enregistré. Vérifiez votre connexion puis réessayez." };
    }
    revalidatePath("/espace-membre");
    revalidatePath("/espace-membre/profil");
    revalidatePath("/membres");
    revalidatePath("/archives");
    revalidatePath("/admin/membres");

    let previousPhotoPath: string | null = member?.photo_path ?? null;
    if (photo) {
      const storagePath = `${memberId}/${randomUUID()}.${photo.type === "image/webp" ? "webp" : "jpg"}`;
      const { error: uploadError } = await supabase.storage.from("member-photos").upload(storagePath, photo, { contentType: photo.type, upsert: false });
      if (uploadError) return { error: "Le profil a été enregistré, mais le transfert de la photo a échoué. Vérifiez votre connexion puis réessayez." };
      const { data: previous, error: photoLinkError } = await supabase.rpc("set_own_member_photo", { p_storage_path: storagePath });
      if (photoLinkError) {
        await supabase.storage.from("member-photos").remove([storagePath]);
        return { error: "Le profil a été enregistré, mais la photo n’a pas pu être associée à votre fiche. Réessayez." };
      }
      previousPhotoPath = typeof previous === "string" ? previous : previousPhotoPath;
      if (previousPhotoPath && previousPhotoPath !== storagePath) await supabase.storage.from("member-photos").remove([previousPhotoPath]);
    }

    const { error: consentError } = await supabase.rpc("set_own_member_photo_consent", { p_consent: formData.get("photo_public_consent") === "on" });
    if (consentError) return { error: "Le profil est enregistré, mais le consentement photo n’a pas pu être mis à jour." };

    if (isReactivation) {
      const { error } = await supabase.rpc("submit_own_reactivation_profile");
      if (error) return { error: "Le profil a été mis à jour, mais la demande de réactivation n’a pas pu être transmise. Contactez l’administration." };
    }

    return {
      success: isReactivation
        ? "Votre profil et votre nouvelle photo ont été transmis à l’administration pour validation."
        : "Votre profil a été enregistré.",
      redirectTo: `/espace-membre/profil?statut=${isReactivation ? "reactivation-soumise" : "profil-enregistre"}`,
    };
  } catch {
    return { error: "Une erreur technique a interrompu l’enregistrement. Vos champs sont conservés : vérifiez votre connexion puis réessayez." };
  }
}
