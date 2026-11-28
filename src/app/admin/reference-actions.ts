"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";

const programName = z.string().trim().min(2).max(160);
const institutionName = z.string().trim().min(2).max(200);
const uuid = z.string().uuid();

function value(formData: FormData, key: string) {
  const item = formData.get(key);
  return typeof item === "string" ? item : "";
}

async function requireReferenceAdmin() {
  const next = "/admin/parametres/referentiels";
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect(`/connexion?next=${encodeURIComponent(next)}`);
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect(`/auth/mfa?next=${encodeURIComponent(next)}`);
  return { supabase, user };
}

function resultPath(kind: "filiere" | "etablissement", result: "enregistre" | "desactive" | "reactive" | "doublon" | "impossible") {
  return `/admin/parametres/referentiels?statut=${kind}-${result}`;
}

export async function createStudyProgramAction(formData: FormData) {
  const { supabase, user } = await requireReferenceAdmin();
  const parsed = programName.safeParse(value(formData, "name"));
  if (!parsed.success) redirect(resultPath("filiere", "impossible"));
  const { error } = await supabase.from("study_programs").insert({ name: parsed.data, created_by: user.id, updated_by: user.id });
  if (error) redirect(resultPath("filiere", error.code === "23505" ? "doublon" : "impossible"));
  revalidatePath("/admin/parametres/referentiels");
  revalidatePath("/espace-membre/profil");
  revalidatePath("/admin/membres");
  redirect(resultPath("filiere", "enregistre"));
}

export async function updateStudyProgramAction(formData: FormData) {
  const { supabase, user } = await requireReferenceAdmin();
  const parsed = z.object({ id: uuid, name: programName }).safeParse({ id: value(formData, "id"), name: value(formData, "name") });
  if (!parsed.success) redirect(resultPath("filiere", "impossible"));
  const { error } = await supabase.from("study_programs").update({ name: parsed.data.name, updated_by: user.id }).eq("id", parsed.data.id);
  if (error) redirect(resultPath("filiere", error.code === "23505" ? "doublon" : "impossible"));
  revalidatePath("/admin/parametres/referentiels");
  revalidatePath("/espace-membre/profil");
  revalidatePath("/admin/membres");
  redirect(resultPath("filiere", "enregistre"));
}

export async function setStudyProgramActiveAction(formData: FormData) {
  const { supabase, user } = await requireReferenceAdmin();
  const parsed = z.object({ id: uuid, active: z.enum(["true", "false"]) }).safeParse({ id: value(formData, "id"), active: value(formData, "active") });
  if (!parsed.success) redirect(resultPath("filiere", "impossible"));
  const { error } = await supabase.from("study_programs").update({ is_active: parsed.data.active === "true", updated_by: user.id }).eq("id", parsed.data.id);
  if (error) redirect(resultPath("filiere", "impossible"));
  revalidatePath("/admin/parametres/referentiels");
  revalidatePath("/espace-membre/profil");
  redirect(resultPath("filiere", parsed.data.active === "true" ? "reactive" : "desactive"));
}

export async function createInstitutionAction(formData: FormData) {
  const { supabase, user } = await requireReferenceAdmin();
  const parsed = institutionName.safeParse(value(formData, "name"));
  if (!parsed.success) redirect(resultPath("etablissement", "impossible"));
  const { error } = await supabase.from("member_institutions").insert({ name: parsed.data, created_by: user.id, updated_by: user.id });
  if (error) redirect(resultPath("etablissement", error.code === "23505" ? "doublon" : "impossible"));
  revalidatePath("/admin/parametres/referentiels");
  revalidatePath("/espace-membre/profil");
  revalidatePath("/admin/membres");
  redirect(resultPath("etablissement", "enregistre"));
}

export async function updateInstitutionAction(formData: FormData) {
  const { supabase, user } = await requireReferenceAdmin();
  const parsed = z.object({ id: uuid, name: institutionName }).safeParse({ id: value(formData, "id"), name: value(formData, "name") });
  if (!parsed.success) redirect(resultPath("etablissement", "impossible"));
  const { error } = await supabase.from("member_institutions").update({ name: parsed.data.name, updated_by: user.id }).eq("id", parsed.data.id);
  if (error) redirect(resultPath("etablissement", error.code === "23505" ? "doublon" : "impossible"));
  revalidatePath("/admin/parametres/referentiels");
  revalidatePath("/espace-membre/profil");
  revalidatePath("/admin/membres");
  redirect(resultPath("etablissement", "enregistre"));
}

export async function setInstitutionActiveAction(formData: FormData) {
  const { supabase, user } = await requireReferenceAdmin();
  const parsed = z.object({ id: uuid, active: z.enum(["true", "false"]) }).safeParse({ id: value(formData, "id"), active: value(formData, "active") });
  if (!parsed.success) redirect(resultPath("etablissement", "impossible"));
  const { error } = await supabase.from("member_institutions").update({ is_active: parsed.data.active === "true", updated_by: user.id }).eq("id", parsed.data.id);
  if (error) redirect(resultPath("etablissement", "impossible"));
  revalidatePath("/admin/parametres/referentiels");
  revalidatePath("/espace-membre/profil");
  redirect(resultPath("etablissement", parsed.data.active === "true" ? "reactive" : "desactive"));
}
