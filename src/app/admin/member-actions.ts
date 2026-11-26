"use server";

import { randomInt, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSiteBaseUrl } from "@/lib/site-url";

const memberSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  joinedYear: z.coerce.number().int().min(1900).max(2200),
  exitYear: z.preprocess((value) => value === "" ? Number.NaN : Number(value), z.number().int().min(1900).max(2200)),
  studyProgram: z.string().trim().min(2).max(160),
  institution: z.string().trim().min(2).max(200),
  sex: z.enum(["female", "male", "other", "prefer_not_to_say"]).or(z.literal("")),
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

export type CreateMemberState = { error?: string; confirmExisting?: boolean; email?: string };

const integratedMemberSchema = z.object({
  email: z.string().trim().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  joinedYear: z.coerce.number().int().min(1900).max(2200),
  attachExisting: z.boolean(),
});

async function findAuthUserByEmail(service: NonNullable<ReturnType<typeof createSupabaseServiceClient>>, email: string) {
  const normalizedEmail = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 500 });
    if (error) throw new Error("comptes-indisponibles");
    const match = data.users.find((account) => account.email?.toLowerCase() === normalizedEmail);
    if (match) return match;
    if (data.users.length < 500) return null;
  }
  throw new Error("recherche-comptes-trop-volumineuse");
}

function memberCreationError(error: string): CreateMemberState {
  const messages: Record<string, string> = {
    "comptes-indisponibles": "Impossible de vérifier les comptes existants. Réessayez dans un instant.",
    "recherche-comptes-trop-volumineuse": "La recherche de compte a atteint sa limite. Contactez le Super Admin pour rattacher ce dossier.",
    "numero-indisponible": "Le numéro ADEIO n’a pas pu être attribué. Réessayez.",
    "compte-ineligible": "Ce compte possède déjà une fiche, une réactivation en cours ou un rôle sensible. Aucun changement n’a été effectué.",
    "compte-deja-lie": "Cette adresse est déjà rattachée à une fiche membre. Ouvrez cette fiche pour la gérer.",
    "invitation-impossible": "L’invitation n’a pas pu être envoyée. Vérifiez la configuration e-mail de Supabase.",
    "fiche-impossible": "La fiche n’a pas pu être créée. Si un compte vient d’être invité, il a été annulé automatiquement ; vérifiez l’état avant de réessayer.",
    "compensation-impossible": "La fiche n’a pas pu être créée et le compte provisoire n’a pas pu être annulé automatiquement. Ne relancez pas l’invitation ; contactez le Super Admin pour vérifier ce compte.",
    "email-envoi-secondaire": "La fiche est créée et liée au compte existant, mais l’e-mail n’a pas été envoyé. Utilisez « Renvoyer les instructions » dans Utilisateurs et rôles.",
  };
  return { error: messages[error] ?? "La création n’a pas abouti. Vérifiez les informations puis réessayez." };
}

export async function createIntegratedMemberAction(_previous: CreateMemberState, formData: FormData): Promise<CreateMemberState> {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=%2Fadmin%2Fmembres%2Fnouveau");
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect("/auth/mfa?next=%2Fadmin%2Fmembres%2Fnouveau");

  const parsed = integratedMemberSchema.safeParse({
    email: formData.get("email"),
    firstName: formData.get("first_name"),
    lastName: formData.get("last_name"),
    joinedYear: formData.get("joined_year"),
    attachExisting: formData.get("attach_existing") === "1",
  });
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (!parsed.success || parsed.data.joinedYear > currentYear) return { error: "Vérifiez le nom, l’adresse e-mail et l’année d’adhésion." };
  const confirmedEmail = value(formData, "confirmed_email").trim().toLowerCase();
  if (parsed.data.attachExisting && confirmedEmail !== parsed.data.email.toLowerCase()) {
    return { error: "L’adresse a changé depuis la vérification. Relancez la recherche puis confirmez le compte affiché." };
  }

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Le service serveur Supabase n’est pas configuré. Contactez le Super Admin." };
  const email = parsed.data.email.toLowerCase();
  let existing: Awaited<ReturnType<typeof findAuthUserByEmail>>;
  try { existing = await findAuthUserByEmail(service, email); }
  catch (error) { return memberCreationError(error instanceof Error ? error.message : "comptes-indisponibles"); }

  if (existing) {
    const [{ data: linked }, { data: currentRoles }, { data: onboarding }] = await Promise.all([
      service.from("members").select("id").eq("user_id", existing.id).maybeSingle(),
      service.from("user_roles").select("role").eq("user_id", existing.id),
      service.from("member_onboarding").select("kind,status,member_id").eq("user_id", existing.id).maybeSingle(),
    ]);
    const roleList = (currentRoles ?? []).map((row) => row.role);
    if (linked) return memberCreationError("compte-deja-lie");
    if (roleList.some((role) => role !== "member") || (onboarding && (onboarding.kind !== "new_member" || onboarding.status !== "pending" || onboarding.member_id))) return memberCreationError("compte-ineligible");
    if (!parsed.data.attachExisting) return { confirmExisting: true, email: existing.email ?? email };
  }
  if (!existing && parsed.data.attachExisting) return { error: "Le compte n’est plus disponible. Vérifiez l’adresse et recommencez." };

  let userId: string;
  let newlyInvited = false;
  if (existing) {
    userId = existing.id;
  } else {
    const siteUrl = await getSiteBaseUrl();
    if (!siteUrl) return { error: "Configurez NEXT_PUBLIC_SITE_URL avant l’envoi des invitations." };
    const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?flow=invitation&next=/mot-de-passe`,
      data: { display_name: `${parsed.data.firstName} ${parsed.data.lastName}` },
    });
    if (error || !data.user) {
      if (data.user) {
        const { error: cleanupError } = await service.auth.admin.deleteUser(data.user.id);
        if (cleanupError) return memberCreationError("compensation-impossible");
      }
      if (error?.code === "email_exists") return { confirmExisting: true, email };
      return memberCreationError("invitation-impossible");
    }
    userId = data.user.id;
    newlyInvited = true;
  }

  const { data: memberId, error: createError } = await service.rpc("admin_register_member_invitation", {
    p_user_id: userId,
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_joined_year: parsed.data.joinedYear,
    p_actor_id: user.id,
  });
  if (createError || !memberId) {
    if (newlyInvited) {
      const { error: cleanupError } = await service.auth.admin.deleteUser(userId);
      if (cleanupError) return memberCreationError("compensation-impossible");
    }
    if (createError?.code === "54000") return memberCreationError("numero-indisponible");
    if (createError?.code === "23505") return memberCreationError("compte-deja-lie");
    return memberCreationError("fiche-impossible");
  }

  if (existing) {
    const siteUrl = await getSiteBaseUrl();
    const callback = siteUrl ? `${siteUrl}/auth/callback?flow=${existing.email_confirmed_at ? "recovery" : "signup"}&next=/mot-de-passe` : null;
    let emailError = !callback;
    if (callback && !existing.email_confirmed_at && existing.email) {
      const { error } = await supabase.auth.resend({ type: "signup", email: existing.email, options: { emailRedirectTo: callback } });
      emailError = Boolean(error);
    } else if (callback && existing.email) {
      const { error } = await supabase.auth.resetPasswordForEmail(existing.email, { redirectTo: callback });
      emailError = Boolean(error);
    }
    if (emailError) return memberCreationError("email-envoi-secondaire");
  }

  revalidatePath("/admin/membres");
  revalidatePath("/admin/utilisateurs");
  revalidatePath("/membres");
  revalidatePath("/archives");
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
  const { data: existingDetails } = await supabase.from("member_private_details").select("sex").eq("member_id", id).maybeSingle();
  const sex = input.sex || existingDetails?.sex;
  if (!sex) redirect(`${nextPath}?erreur=formulaire-invalide`);
  const { error } = await supabase.rpc("admin_update_member_profile", {
    p_member_id: id, p_first_name: input.firstName, p_last_name: input.lastName, p_exit_year: input.exitYear,
    p_study_program: input.studyProgram, p_institution: input.institution, p_phone: input.phone,
    p_sex: sex, p_status: input.status, p_user_id: input.userId || null,
    p_photo_public_consent: input.photoConsent,
  });
  if (error) redirect(`${nextPath}?erreur=${encodeURIComponent(error.code === "42501" ? "utiliser-reactivation" : "modification-impossible")}`);
  revalidatePath("/admin/membres"); revalidatePath("/admin/archives"); revalidatePath("/membres"); revalidatePath("/archives"); revalidatePath(nextPath);
  redirect(`${nextPath}?statut=membre-modifie`);
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

async function listMemberPhotoFiles(service: NonNullable<ReturnType<typeof createSupabaseServiceClient>>, folder: string): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await service.storage.from("member-photos").list(folder, { limit: 100, offset });
    if (error) throw new Error("stockage-indisponible");
    for (const item of data) {
      const path = `${folder}/${item.name}`;
      if (item.id === null && item.metadata === null) paths.push(...await listMemberPhotoFiles(service, path));
      else paths.push(path);
    }
    if (data.length < 100) break;
    offset += data.length;
  }
  return paths;
}

function deletionErrorCode(message: string) {
  if (message.includes("MEMBER_CONFIRMATION_MISMATCH")) return "suppression-confirmation";
  if (message.includes("FINANCIAL_DATA_BLOCK") || message.includes("FINANCIAL_CREATOR_DATA_BLOCK")) return "suppression-financiere";
  if (message.includes("AUTH_ACCOUNT_HAS_NON_MEMBER_ROLE") || message.includes("MEMBER_AUTH_LINK_CONFLICT") || message.includes("MEMBER_AUTH_HISTORY_CONFLICT")) return "suppression-role";
  if (message.includes("CANNOT_DELETE_CURRENT_SUPER_ADMIN") || message.includes("SUPER_ADMIN_REQUIRED")) return "suppression-role";
  if (message.includes("MEMBER_NOT_FOUND")) return "membre-introuvable";
  return "suppression-impossible";
}

export async function deleteMemberAction(formData: FormData) {
  const id = value(formData, "member_id");
  if (!z.string().uuid().safeParse(id).success) redirect("/admin/membres?erreur=membre-introuvable");
  const path = `/admin/membres/${id}`;
  const { supabase, roles } = await adminContext(path);
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const expectedNumber = value(formData, "confirm_member_number").trim().toUpperCase();
  if (!/^ADEIO-\d{4}-[A-Z0-9]{4}$/.test(expectedNumber)) redirect(`${path}?erreur=suppression-confirmation`);
  const service = createSupabaseServiceClient();
  if (!service) redirect(`${path}?erreur=suppression-configuration`);

  const { data: preparedRows, error: prepareError } = await supabase.rpc("prepare_member_permanent_deletion", {
    p_member_id: id,
    p_expected_member_number: expectedNumber,
  });
  if (prepareError) redirect(`${path}?erreur=${deletionErrorCode(prepareError.message)}`);
  const prepared = Array.isArray(preparedRows) ? preparedRows[0] : preparedRows;
  if (!prepared) redirect(`${path}?erreur=suppression-impossible`);

  const authUserId = prepared.auth_user_id as string | null;
  const restoreMemberLink = Boolean(prepared.restore_member_link);
  const cancelPreparation = async () => {
    const { error } = await supabase.rpc("cancel_member_permanent_deletion", {
      p_member_id: id,
      p_expected_member_number: expectedNumber,
      p_auth_user_id: authUserId,
      p_restore_member_link: restoreMemberLink,
    });
    return !error;
  };

  if (authUserId) {
    const lookup = await service.auth.admin.getUserById(authUserId);
    if (lookup.data.user) {
      const { error } = await service.auth.admin.deleteUser(authUserId);
      if (error) {
        const restored = await cancelPreparation();
        redirect(`${path}?erreur=${restored ? "suppression-auth" : "suppression-partielle"}`);
      }
    } else if (lookup.error && lookup.error.status !== 404 && lookup.error.code !== "user_not_found") {
      const restored = await cancelPreparation();
      redirect(`${path}?erreur=${restored ? "suppression-auth" : "suppression-partielle"}`);
    }
  }

  try {
    const storedFiles = await listMemberPhotoFiles(service, id);
    const photoPath = typeof prepared.member_photo_path === "string" ? prepared.member_photo_path : null;
    const allPaths = [...new Set([...storedFiles, ...(photoPath ? [photoPath] : [])])];
    for (let index = 0; index < allPaths.length; index += 100) {
      const { error } = await service.storage.from("member-photos").remove(allPaths.slice(index, index + 100));
      if (error) throw new Error("stockage-indisponible");
    }
  } catch {
    redirect(`${path}?erreur=suppression-stockage`);
  }

  const { error: finalizeError } = await supabase.rpc("finalize_member_permanent_deletion", {
    p_member_id: id,
    p_expected_member_number: expectedNumber,
  });
  if (finalizeError) redirect(`${path}?erreur=${deletionErrorCode(finalizeError.message) === "suppression-impossible" ? "suppression-partielle" : deletionErrorCode(finalizeError.message)}`);
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
