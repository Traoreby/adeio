"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { issueMemberToken } from "@/lib/member-qr-crypto";
import { getSiteBaseUrl } from "@/lib/site-url";

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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

async function sendEmailChangeConfirmation(to: string, newEmail: string, actionLink: string, audience: "current" | "new") {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ADEIO_AUTH_FROM_EMAIL?.trim();
  if (!apiKey || !from) return "email-provider-manquant";
  const isCurrent = audience === "current";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: isCurrent ? "Confirmez le changement d’adresse ADEIO" : "Confirmez votre nouvelle adresse ADEIO",
        html: `<p>Une demande de changement d’adresse e-mail a été faite pour votre compte ADEIO.</p><p>Nouvelle adresse demandée : <strong>${escapeHtml(newEmail)}</strong></p><p><a href="${escapeHtml(actionLink)}">${isCurrent ? "Autoriser la demande" : "Confirmer la nouvelle adresse"}</a></p><p>Votre adresse ne changera qu’après les confirmations requises par Supabase. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message et contactez l’administration ADEIO.</p>`,
      }),
      cache: "no-store",
    });
    return response.ok ? null : "envoi-confirmation-impossible";
  } catch {
    return "envoi-confirmation-impossible";
  }
}

export async function setFormerMembersVisibilityAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/parametres");
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect("/auth/mfa?next=%2Fadmin%2Fparametres");

  const parsed = z.enum(["true", "false"]).safeParse(toStringValue(formData, "visible"));
  if (!parsed.success) redirect("/admin/parametres?erreur=reglage-invalide");
  const visible = parsed.data === "true";
  const { error } = await supabase.from("settings").upsert({
    key: "former_members_visibility",
    value: visible,
    updated_by: user.id,
  });
  if (error) redirect("/admin/parametres?erreur=modification-impossible");

  revalidatePath("/admin/parametres");
  revalidatePath("/membres");
  revalidatePath("/archives");
  redirect(`/admin/parametres?statut=${visible ? "archives-visibles" : "archives-masquees"}`);
}

export async function setFinancialReceiptThresholdAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/parametres");
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect("/auth/mfa?next=%2Fadmin%2Fparametres");
  const raw = toStringValue(formData, "threshold_fcfa").replace(/[\s\u00a0]/g, "");
  if (raw && !/^\d{1,13}$/.test(raw)) redirect("/admin/parametres?erreur=seuil-invalide");
  const thresholdFcfa = raw ? Number(raw) : null;
  if (thresholdFcfa !== null && thresholdFcfa < 1) redirect("/admin/parametres?erreur=seuil-invalide");
  const { error } = await supabase.from("settings").upsert({
    key: "financial_receipt_required_threshold_fcfa",
    value: { thresholdFcfa },
    updated_by: user.id,
  });
  if (error) redirect("/admin/parametres?erreur=modification-impossible");
  revalidatePath("/admin/parametres");
  revalidatePath("/gestion-financiere/operations/nouvelle");
  redirect("/admin/parametres?statut=seuil-justificatif-enregistre");
}

export async function enableMemberLifecycleAction() {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=%2Fadmin%2Fparametres");
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect("/auth/mfa?next=%2Fadmin%2Fparametres");
  const { error } = await supabase.rpc("enable_member_lifecycle");
  if (error) redirect(`/admin/parametres?erreur=${encodeURIComponent(error.code === "23514" ? "annees-sortie-a-corriger" : "activation-archivage-impossible")}`);
  revalidatePath("/admin/parametres");
  revalidatePath("/admin/membres");
  revalidatePath("/admin/archives");
  revalidatePath("/membres");
  revalidatePath("/archives");
  redirect("/admin/parametres?statut=archivage-automatique-active");
}

export async function pauseMemberLifecycleAction() {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=%2Fadmin%2Fparametres");
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect("/auth/mfa?next=%2Fadmin%2Fparametres");
  const { error } = await supabase.from("settings").upsert({
    key: "member_lifecycle_enforced", value: { enabled: false }, updated_by: user.id,
  });
  if (error) redirect("/admin/parametres?erreur=activation-archivage-impossible");
  revalidatePath("/admin/parametres");
  revalidatePath("/membres");
  redirect("/admin/parametres?statut=archivage-automatique-pause");
}

async function sendExistingMemberAccessEmail(supabase: NonNullable<Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>>, userId: string, flow: "invitation" | "reactivation" = "invitation") {
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) return "service-serveur-manquant";
  const { data, error } = await serviceClient.auth.admin.getUserById(userId);
  const email = data.user?.email;
  if (error || !email) return "compte-email-introuvable";
  const siteUrl = await getSiteBaseUrl();
  if (!siteUrl) return "url-site-manquante";
  if (!data.user.email_confirmed_at) {
    const callback = `${siteUrl}/auth/verify?flow=signup&next=/mot-de-passe`;
    const { error: resendError } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: callback } });
    return resendError ? "envoi-email-impossible" : null;
  }
  const callback = `${siteUrl}/auth/verify?flow=${flow === "reactivation" ? "reactivation" : "recovery"}&next=/mot-de-passe`;
  const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback });
  return recoveryError ? "envoi-email-impossible" : null;
}

export async function resendMemberAccessEmailAction(formData: FormData) {
  const requestedPath = toStringValue(formData, "return_to");
  const memberReturnPath = /^\/admin\/membres\/[0-9a-f-]{36}$/i.test(requestedPath) ? requestedPath : null;
  const redirectPath = memberReturnPath ?? "/admin/utilisateurs";
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect(`/connexion?next=${encodeURIComponent(redirectPath)}`);
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect(`/auth/mfa?next=${encodeURIComponent(redirectPath)}`);
  const target = z.string().uuid().safeParse(toStringValue(formData, "user_id"));
  if (!target.success) redirect(`${redirectPath}?erreur=compte-introuvable`);
  const error = await sendExistingMemberAccessEmail(supabase, target.data);
  if (error) redirect(`${redirectPath}?erreur=${memberReturnPath ? `reactivation-email-${error}` : error}`);
  revalidatePath("/admin/utilisateurs");
  redirect(`${redirectPath}?statut=${memberReturnPath ? "instructions-renvoyees" : "email-acces-renvoye"}`);
}

export async function changeAuthEmailAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin/utilisateurs");
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect("/auth/mfa?next=%2Fadmin%2Futilisateurs");
  const parsed = z.object({ userId: idSchema, newEmail: z.string().trim().email().max(254) }).safeParse({
    userId: toStringValue(formData, "user_id"),
    newEmail: toStringValue(formData, "new_email"),
  });
  if (!parsed.success) redirect("/admin/utilisateurs?erreur=formulaire-invalide");
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) redirect("/admin/utilisateurs?erreur=service-serveur-manquant");
  const { data: target, error: findError } = await serviceClient.auth.admin.getUserById(parsed.data.userId);
  if (findError || !target.user?.email) redirect("/admin/utilisateurs?erreur=compte-introuvable");
  if (target.user.id === user.id) redirect("/admin/utilisateurs?erreur=utilisez-profil-securite");
  const oldEmail = target.user.email;
  const newEmail = parsed.data.newEmail.toLowerCase();
  if (oldEmail.toLowerCase() === newEmail) redirect("/admin/utilisateurs?erreur=email-identique");
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.ADEIO_AUTH_FROM_EMAIL?.trim()) {
    redirect("/admin/utilisateurs?erreur=email-provider-manquant");
  }
  const siteUrl = await getSiteBaseUrl();
  if (!siteUrl) redirect("/admin/utilisateurs?erreur=url-site-manquante");
  const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent("/connexion?email-change=confirmed")}`;
  const [{ data: currentLink, error: currentLinkError }, { data: newLink, error: newLinkError }] = await Promise.all([
    serviceClient.auth.admin.generateLink({ type: "email_change_current", email: oldEmail, newEmail, options: { redirectTo } }),
    serviceClient.auth.admin.generateLink({ type: "email_change_new", email: oldEmail, newEmail, options: { redirectTo } }),
  ]);
  if (newLinkError?.code === "email_exists") redirect("/admin/utilisateurs?erreur=email-deja-utilise");
  if (currentLinkError || newLinkError || !currentLink.properties.action_link || !newLink.properties.action_link) {
    redirect("/admin/utilisateurs?erreur=confirmation-supabase-impossible");
  }
  const newAddressError = await sendEmailChangeConfirmation(newEmail, newEmail, newLink.properties.action_link, "new");
  if (newAddressError) redirect(`/admin/utilisateurs?erreur=${newAddressError}`);
  const currentAddressError = await sendEmailChangeConfirmation(oldEmail, newEmail, currentLink.properties.action_link, "current");
  if (currentAddressError) redirect(`/admin/utilisateurs?erreur=${currentAddressError}`);
  await serviceClient.from("audit_log").insert({
    actor_id: user.id,
    action: "UPDATE",
    target_table: "auth.users",
    target_id: parsed.data.userId,
    before_value: { email: oldEmail },
    after_value: { requested_email: newEmail, confirmation_requested: true, confirmation_required_on_current_and_new_addresses: true },
  });
  revalidatePath("/admin/utilisateurs");
  revalidatePath("/admin/membres");
  redirect("/admin/utilisateurs?statut=changement-email-demarre");
}

export async function startMemberReactivationAction(formData: FormData) {
  const id = z.string().uuid().safeParse(toStringValue(formData, "member_id"));
  if (!id.success) redirect("/admin/archives?erreur=membre-introuvable");
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect(`/connexion?next=${encodeURIComponent(`/admin/membres/${id.data}`)}`);
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect(`/auth/mfa?next=${encodeURIComponent(`/admin/membres/${id.data}`)}`);
  const { data: linkedUser, error } = await supabase.rpc("start_member_reactivation", { p_member_id: id.data });
  if (error || !linkedUser) redirect(`/admin/membres/${id.data}?erreur=reactivation-impossible`);
  const emailError = await sendExistingMemberAccessEmail(supabase, linkedUser, "reactivation");
  revalidatePath(`/admin/membres/${id.data}`);
  revalidatePath("/admin/archives");
  redirect(emailError
    ? `/admin/membres/${id.data}?erreur=reactivation-email-${emailError}`
    : `/admin/membres/${id.data}?statut=reactivation-demarree`);
}

export async function confirmMemberReactivationAction(formData: FormData) {
  const id = z.string().uuid().safeParse(toStringValue(formData, "member_id"));
  if (!id.success) redirect("/admin/archives?erreur=membre-introuvable");
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect(`/connexion?next=${encodeURIComponent(`/admin/membres/${id.data}`)}`);
  if (!roles.some((role) => role === "admin" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect(`/auth/mfa?next=${encodeURIComponent(`/admin/membres/${id.data}`)}`);
  let token: ReturnType<typeof issueMemberToken>;
  try { token = issueMemberToken(); }
  catch { redirect(`/admin/membres/${id.data}?erreur=cle-chiffrement-qr-manquante`); }
  const { error } = await supabase.rpc("confirm_member_reactivation", {
    p_member_id: id.data,
    p_token_hash: token.tokenHash,
    p_encrypted_token: token.encryptedToken,
    p_nonce: token.nonce,
    p_tag: token.tag,
    p_key_version: token.keyVersion,
  });
  if (error) redirect(`/admin/membres/${id.data}?erreur=reactivation-impossible`);
  revalidatePath(`/admin/membres/${id.data}`);
  revalidatePath("/admin/membres");
  revalidatePath("/admin/archives");
  revalidatePath("/membres");
  revalidatePath("/archives");
  revalidatePath("/verification");
  redirect(`/admin/membres/${id.data}?statut=membre-reactive-qr-emis`);
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
