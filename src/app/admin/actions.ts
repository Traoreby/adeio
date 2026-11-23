"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const announcementSchema = z.object({
  title: z.string().trim().min(3, "Le titre doit contenir au moins 3 caractères.").max(140),
  slug: z.string().trim().min(3).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Utilisez uniquement des lettres minuscules, chiffres et tirets."),
  summary: z.string().trim().max(280).optional(),
  body: z.string().trim().min(10, "Le texte doit contenir au moins 10 caractères."),
  visibility: z.enum(["public", "members"]),
});

function toStringValue(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

const idSchema = z.string().uuid();

export async function inviteMemberAccountAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/utilisateurs");
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect("/auth/mfa?next=%2Fadmin%2Futilisateurs");
  const parsed = z.object({ email: z.string().trim().email().max(254), displayName: z.string().trim().min(2).max(120) }).safeParse({
    email: toStringValue(formData, "email"),
    displayName: toStringValue(formData, "display_name"),
  });
  if (!parsed.success) redirect("/admin/utilisateurs?erreur=formulaire-invalide");
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) redirect("/admin/utilisateurs?erreur=cle-serveur-manquante");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const { error } = await serviceClient.auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo: `${siteUrl}/auth/callback?next=/mot-de-passe`,
    data: { display_name: parsed.data.displayName },
  });
  if (error) redirect(`/admin/utilisateurs?erreur=${encodeURIComponent(error.code === "email_exists" ? "email-deja-utilise" : "invitation-impossible")}`);
  revalidatePath("/admin/utilisateurs");
  redirect("/admin/utilisateurs?statut=invitation-envoyee");
}

export async function assignUserRoleAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/utilisateurs");
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const parsed = z.object({ userId: idSchema, role: z.enum(["member", "treasurer", "auditor", "admin", "super_admin"]) }).safeParse({
    userId: toStringValue(formData, "user_id"),
    role: toStringValue(formData, "role"),
  });
  if (!parsed.success) redirect("/admin/utilisateurs?erreur=formulaire-invalide");
  const { error } = await supabase.from("user_roles").insert({ user_id: parsed.data.userId, role: parsed.data.role, created_by: user.id });
  if (error && error.code !== "23505") redirect("/admin/utilisateurs?erreur=role-impossible");
  revalidatePath("/admin/utilisateurs");
  redirect(`/admin/utilisateurs?statut=${error?.code === "23505" ? "role-existant" : "role-attribue"}`);
}

export async function removeUserRoleAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/utilisateurs");
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const parsed = z.object({ userId: idSchema, role: z.enum(["member", "treasurer", "auditor", "admin", "super_admin"]) }).safeParse({
    userId: toStringValue(formData, "user_id"),
    role: toStringValue(formData, "role"),
  });
  if (!parsed.success) redirect("/admin/utilisateurs?erreur=formulaire-invalide");
  const { error } = await supabase.from("user_roles").delete().eq("user_id", parsed.data.userId).eq("role", parsed.data.role);
  if (error) redirect(`/admin/utilisateurs?erreur=${encodeURIComponent(error.code === "55000" ? "dernier-super-admin" : "role-impossible")}`);
  revalidatePath("/admin/utilisateurs");
  redirect("/admin/utilisateurs?statut=role-retire");
}

export async function createAnnouncementAction(formData: FormData) {
  const { supabase, user } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/annonces");
  const parsed = announcementSchema.safeParse({
    title: toStringValue(formData, "title"),
    slug: toStringValue(formData, "slug"),
    summary: toStringValue(formData, "summary"),
    body: toStringValue(formData, "body"),
    visibility: toStringValue(formData, "visibility"),
  });
  if (!parsed.success) redirect("/admin/annonces?erreur=formulaire-invalide");
  const isPublished = formData.get("is_published") === "on";
  const isPinned = formData.get("is_pinned") === "on";
  const { error } = await supabase.from("announcements").insert({
    ...parsed.data,
    summary: parsed.data.summary || null,
    is_published: isPublished,
    is_pinned: isPinned,
    published_at: isPublished ? new Date().toISOString() : null,
    created_by: user.id,
  });
  if (error) redirect(`/admin/annonces?erreur=${encodeURIComponent(error.code === "23505" ? "slug-existant" : "creation-impossible")}`);
  revalidatePath("/actualites");
  revalidatePath("/");
  revalidatePath("/admin/annonces");
  redirect("/admin/annonces?statut=annonce-creee");
}

export async function setAnnouncementPublicationAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/annonces");
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const id = toStringValue(formData, "id");
  if (!idSchema.safeParse(id).success) redirect("/admin/annonces?erreur=modification-impossible");
  const isPublished = toStringValue(formData, "is_published") === "true";
  const { error } = await supabase.from("announcements").update({
    is_published: isPublished,
    published_at: isPublished ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) redirect("/admin/annonces?erreur=modification-impossible");
  revalidatePath("/actualites"); revalidatePath("/"); revalidatePath("/admin/annonces");
  redirect("/admin/annonces?statut=publication-modifiee");
}

export async function setAnnouncementPinnedAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/annonces");
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const id = toStringValue(formData, "id");
  if (!idSchema.safeParse(id).success) redirect("/admin/annonces?erreur=modification-impossible");
  const isPinned = toStringValue(formData, "is_pinned") === "true";
  const { error } = await supabase.from("announcements").update({ is_pinned: isPinned }).eq("id", id);
  if (error) redirect("/admin/annonces?erreur=modification-impossible");
  revalidatePath("/actualites"); revalidatePath("/"); revalidatePath("/admin/annonces");
  redirect("/admin/annonces?statut=annonce-modifiee");
}

const termSchema = z.object({
  title: z.string().trim().min(3).max(120),
  startsOn: z.string().date(),
  endsOn: z.string().date().optional().or(z.literal("")),
});

export async function startExecutiveTermAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/bureau");
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const parsed = termSchema.safeParse({
    title: toStringValue(formData, "title"),
    startsOn: toStringValue(formData, "starts_on"),
    endsOn: toStringValue(formData, "ends_on"),
  });
  if (!parsed.success) redirect("/admin/bureau?erreur=formulaire-invalide");
  const { data, error } = await supabase.rpc("start_executive_term", {
    p_term_title: parsed.data.title,
    p_starts_on: parsed.data.startsOn,
    p_ends_on: parsed.data.endsOn || null,
  });
  if (error) redirect("/admin/bureau?erreur=creation-impossible");
  revalidatePath("/bureau"); revalidatePath("/admin/bureau");
  redirect(`/admin/bureau?statut=mandat-cree&term=${encodeURIComponent(String(data))}`);
}

export async function assignExecutiveMemberAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/bureau");
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const ids = z.object({ memberId: idSchema, positionId: idSchema, termId: idSchema }).safeParse({
    memberId: toStringValue(formData, "member_id"),
    positionId: toStringValue(formData, "position_id"),
    termId: toStringValue(formData, "term_id"),
  });
  if (!ids.success) redirect("/admin/bureau?erreur=formulaire-invalide");
  const { memberId, positionId, termId } = ids.data;
  const { error } = await supabase.from("executive_members").insert({ term_id: termId, member_id: memberId, position_id: positionId });
  if (error) redirect(`/admin/bureau?erreur=${encodeURIComponent(error.code === "23505" ? "fonction-deja-attribuee" : "affectation-impossible")}`);
  revalidatePath("/bureau"); revalidatePath("/admin/bureau");
  redirect("/admin/bureau?statut=affectation-ajoutee");
}

export async function removeExecutiveMemberAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/bureau");
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const id = toStringValue(formData, "id");
  if (!idSchema.safeParse(id).success) redirect("/admin/bureau?erreur=suppression-impossible");
  const { error } = await supabase.from("executive_members").delete().eq("id", id);
  if (error) redirect("/admin/bureau?erreur=suppression-impossible");
  revalidatePath("/bureau"); revalidatePath("/admin/bureau");
  redirect("/admin/bureau?statut=affectation-retiree");
}
