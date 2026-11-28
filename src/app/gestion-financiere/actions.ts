"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";
import { createBlankFinancialReportData, FINANCIAL_REPORT_SECTIONS, financialReportTitle, type FinancialReportData } from "@/lib/financial-report";

const financeRoles = ["treasurer", "auditor", "super_admin"] as const;
const methods = ["cash", "mobile_money", "bank_transfer", "other"] as const;

async function requireFinanceUser(path: string) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect(`/connexion?next=${encodeURIComponent(path)}`);
  if (!roles.some((role) => financeRoles.includes(role as (typeof financeRoles)[number]))) {
    redirect("/espace-membre?erreur=acces-refuse");
  }
  if (!await hasRequiredMfa(supabase, user.id)) redirect(`/auth/mfa?next=${encodeURIComponent(path)}`);
  return { supabase, user, roles };
}

function value(formData: FormData, key: string) {
  const field = formData.get(key);
  return typeof field === "string" ? field.trim() : "";
}

function toAmount(raw: string) {
  const normalized = raw.replace(/[\s,\u00a0]/g, "");
  return /^\d{1,13}$/.test(normalized) ? Number(normalized) : Number.NaN;
}

async function allowedUpload(file: FormDataEntryValue | null, types: string[]) {
  if (!(file instanceof File) || file.size === 0) return null;
  const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "";
  const maxSize = file.type === "application/pdf" ? 2_000_000 : 1_000_000;
  if (!extension || file.size > maxSize || !types.includes(file.type)) return null;
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const validSignature = file.type === "application/pdf"
    ? String.fromCharCode(...header.slice(0, 5)) === "%PDF-"
    : file.type === "image/jpeg"
      ? header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
      : file.type === "image/webp" && String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  return validSignature ? { file, extension } : null;
}

export async function createFinancialTransactionAction(formData: FormData) {
  const path = "/gestion-financiere/operations/nouvelle";
  const { supabase, user } = await requireFinanceUser(path);
  const parsed = z.object({
    occurredOn: z.string().date(),
    direction: z.enum(["income", "expense"]),
    categoryId: z.string().uuid(),
    label: z.string().trim().min(3).max(180),
    amount: z.number().int().positive().max(1_000_000_000_000),
    method: z.enum(methods),
    correctionOf: z.string().uuid().optional(),
  }).safeParse({
    occurredOn: value(formData, "occurred_on"),
    direction: value(formData, "direction"),
    categoryId: value(formData, "category_id"),
    label: value(formData, "label"),
    amount: toAmount(value(formData, "amount_inr")),
    method: value(formData, "payment_method"),
    correctionOf: value(formData, "correction_of") || undefined,
  });
  if (!parsed.success) redirect(`${path}?erreur=formulaire-invalide`);

  const { data: category } = await supabase.from("transaction_categories").select("id,direction,is_active").eq("id", parsed.data.categoryId).maybeSingle();
  if (!category?.is_active || category.direction !== parsed.data.direction) redirect(`${path}?erreur=categorie-invalide`);
  if (parsed.data.correctionOf) {
    const { data: original } = await supabase.from("financial_transactions").select("id,direction,is_published,currency_code").eq("id", parsed.data.correctionOf).maybeSingle();
    if (!original?.is_published || original.currency_code !== "INR" || original.direction === parsed.data.direction) redirect(`${path}?erreur=correction-invalide`);
  }

  const rawAttachment = formData.get("attachment");
  const attachment = await allowedUpload(rawAttachment, ["application/pdf", "image/jpeg", "image/webp"]);
  if (rawAttachment instanceof File && rawAttachment.size > 0 && !attachment) redirect(`${path}?erreur=justificatif-invalide`);
  const { data: thresholdSetting } = await supabase.from("settings").select("value").eq("key", "financial_receipt_required_threshold_inr").maybeSingle();
  const thresholdValue = thresholdSetting?.value && typeof thresholdSetting.value === "object" ? thresholdSetting.value.thresholdInr : null;
  const requiredThreshold = typeof thresholdValue === "number" && thresholdValue > 0 ? thresholdValue : null;
  if (requiredThreshold !== null && parsed.data.amount > requiredThreshold && !attachment) redirect(`${path}?erreur=justificatif-obligatoire`);

  const { data: transaction, error: insertError } = await supabase.from("financial_transactions").insert({
    occurred_on: parsed.data.occurredOn,
    direction: parsed.data.direction,
    category_id: parsed.data.categoryId,
    label: parsed.data.label,
    amount_inr: parsed.data.amount,
    currency_code: "INR",
    payment_method: parsed.data.method,
    correction_of: parsed.data.correctionOf ?? null,
    created_by: user.id,
  }).select("id").single();
  if (insertError || !transaction) redirect(`${path}?erreur=enregistrement-impossible`);

  let storagePath: string | null = null;
  if (attachment) {
    storagePath = `${user.id}/${transaction.id}/${crypto.randomUUID()}.${attachment.extension}`;
    const { error: uploadError } = await supabase.storage.from("financial-attachments").upload(storagePath, attachment.file, {
      contentType: attachment.file.type,
      upsert: false,
    });
    if (uploadError) {
      await supabase.from("financial_transactions").delete().eq("id", transaction.id);
      redirect(`${path}?erreur=justificatif-impossible`);
    }
    const { error: attachmentError } = await supabase.from("financial_attachments").insert({
      transaction_id: transaction.id,
      storage_path: storagePath,
      file_name: attachment.file.name.slice(0, 180),
      mime_type: attachment.file.type,
      created_by: user.id,
    });
    if (attachmentError) {
      await supabase.storage.from("financial-attachments").remove([storagePath]);
      await supabase.from("financial_transactions").delete().eq("id", transaction.id);
      redirect(`${path}?erreur=justificatif-impossible`);
    }
  }

  const { error: publishError } = await supabase.from("financial_transactions").update({ is_published: true, published_at: new Date().toISOString() }).eq("id", transaction.id);
  if (publishError) {
    if (storagePath) {
      await supabase.from("financial_attachments").delete().eq("transaction_id", transaction.id);
      await supabase.storage.from("financial-attachments").remove([storagePath]);
    }
    await supabase.from("financial_transactions").delete().eq("id", transaction.id);
    redirect(`${path}?erreur=publication-impossible`);
  }

  revalidatePath("/gestion-financiere");
  revalidatePath("/gestion-financiere/operations");
  revalidatePath("/finances");
  redirect("/gestion-financiere/operations?statut=operation-publiee");
}

export async function createContributionPlanAction(formData: FormData) {
  const path = "/gestion-financiere/cotisations";
  const { supabase, roles } = await requireFinanceUser(path);
  if (!roles.some((role) => role === "treasurer" || role === "super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const parsed = z.object({
    termId: z.string().uuid(),
    amountInr: z.number().int().positive().max(1_000_000_000_000),
  }).safeParse({
    termId: value(formData, "term_id"),
    amountInr: toAmount(value(formData, "amount_inr")),
  });
  if (!parsed.success) redirect(`${path}?erreur=plan-invalide`);
  const { error } = await supabase.rpc("create_contribution_plan_for_term", { p_term_id: parsed.data.termId, p_amount_inr: parsed.data.amountInr });
  if (error) redirect(`${path}?erreur=${error.code === "23505" ? "plan-deja-existant" : "plan-invalide"}`);
  revalidatePath(path);
  redirect(`${path}?statut=plan-cree`);
}

export async function activateContributionPlanAction(formData: FormData) {
  const path = "/gestion-financiere/cotisations";
  const { supabase } = await requireFinanceUser(path);
  const planId = value(formData, "plan_id");
  if (!z.string().uuid().safeParse(planId).success) redirect(`${path}?erreur=plan-invalide`);
  const { error } = await supabase.rpc("set_contribution_plan_active", { p_plan_id: planId });
  if (error) redirect(`${path}?erreur=plan-invalide`);
  revalidatePath(path);
  redirect(`${path}?statut=plan-active`);
}

export async function requestContributionTariffChangeAction(formData: FormData) {
  const path = "/gestion-financiere/cotisations";
  const { supabase } = await requireFinanceUser(path);
  const parsed = z.object({ planId: z.string().uuid(), newAmount: z.number().int().positive().max(1_000_000_000_000), effectiveFrom: z.string().date(), reason: z.string().trim().min(5).max(1000) }).safeParse({
    planId: value(formData, "plan_id"), newAmount: toAmount(value(formData, "new_amount_inr")), effectiveFrom: value(formData, "effective_from"), reason: value(formData, "reason"),
  });
  if (!parsed.success) redirect(`${path}?erreur=tarif-invalide`);
  const { error } = await supabase.rpc("create_contribution_tariff_change_request", { p_plan_id: parsed.data.planId, p_new_amount_inr: parsed.data.newAmount, p_effective_from: parsed.data.effectiveFrom, p_reason: parsed.data.reason });
  if (error) redirect(`${path}?erreur=tarif-invalide`);
  revalidatePath(path);
  redirect(`${path}?statut=tarif-demande`);
}

export async function reviewContributionTariffChangeAction(formData: FormData) {
  const path = "/gestion-financiere/cotisations";
  const { supabase, roles } = await requireFinanceUser(path);
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  const parsed = z.object({ requestId: z.string().uuid(), approve: z.enum(["true", "false"]), note: z.string().max(1000) }).safeParse({ requestId: value(formData, "request_id"), approve: value(formData, "approve"), note: value(formData, "review_note") });
  if (!parsed.success) redirect(`${path}?erreur=tarif-invalide`);
  const { error } = await supabase.rpc("review_contribution_tariff_change", { p_request_id: parsed.data.requestId, p_approve: parsed.data.approve === "true", p_review_note: parsed.data.note || null });
  if (error) redirect(`${path}?erreur=tarif-invalide`);
  revalidatePath(path);
  redirect(`${path}?statut=${parsed.data.approve === "true" ? "tarif-approuve" : "tarif-refuse"}`);
}

export async function generateContributionDuesAction(formData: FormData) {
  const path = "/gestion-financiere/cotisations";
  const { supabase } = await requireFinanceUser(path);
  const parsed = z.object({ planId: z.string().uuid(), year: z.number().int().min(1900).max(2200) }).safeParse({
    planId: value(formData, "plan_id"),
    year: Number(value(formData, "financial_year")),
  });
  if (!parsed.success) redirect(`${path}?erreur=plan-invalide`);
  const { data, error } = await supabase.rpc("generate_contribution_dues_inr", { p_plan_id: parsed.data.planId, p_year: parsed.data.year });
  if (error) redirect(`${path}?erreur=generation-impossible`);
  revalidatePath(path);
  revalidatePath("/espace-membre/cotisations");
  redirect(`${path}?annee=${parsed.data.year}&statut=${encodeURIComponent(`${data ?? 0}-mois-de-cotisation-genere(s)`)}`);
}

export async function recordContributionPaymentAction(formData: FormData) {
  const path = "/gestion-financiere/cotisations";
  const { supabase } = await requireFinanceUser(path);
  const parsed = z.object({
    memberId: z.string().uuid(),
    paidOn: z.string().date(),
    amountInr: z.number().int().positive().max(1_000_000_000_000),
    method: z.enum(["cash", "online"]),
    financialYear: z.number().int().min(1900).max(2200),
    allocations: z.array(z.object({ due_id: z.string().uuid(), amount_inr: z.number().int().positive().max(1_000_000_000_000) })).min(1).max(12),
    note: z.string().max(500),
  }).safeParse({
    memberId: value(formData, "member_id"),
    paidOn: value(formData, "paid_on"),
    amountInr: toAmount(value(formData, "amount_inr")),
    method: value(formData, "payment_method"),
    financialYear: Number(value(formData, "financial_year")),
    allocations: (() => { try { return JSON.parse(value(formData, "allocations_json")); } catch { return null; } })(),
    note: value(formData, "note"),
  });
  if (!parsed.success) redirect(`${path}?erreur=paiement-invalide`);
  if (parsed.data.allocations.reduce((sum, item) => sum + item.amount_inr, 0) !== parsed.data.amountInr) redirect(`${path}?erreur=repartition-invalide`);
  const { data, error } = await supabase.rpc("record_contribution_payment_manual", {
    p_member_id: parsed.data.memberId,
    p_paid_on: parsed.data.paidOn,
    p_amount_inr: parsed.data.amountInr,
    p_payment_method: parsed.data.method,
    p_financial_year: parsed.data.financialYear,
    p_allocations: parsed.data.allocations,
    p_note: parsed.data.note || null,
  });
  if (error) redirect(`${path}?annee=${parsed.data.financialYear}&erreur=${error.code === "23514" ? "repartition-invalide" : "paiement-impossible"}`);
  const reference = data?.[0]?.payment_reference;
  revalidatePath("/gestion-financiere");
  revalidatePath("/gestion-financiere/cotisations");
  revalidatePath("/gestion-financiere/operations");
  revalidatePath("/finances");
  revalidatePath("/espace-membre/cotisations");
  redirect(`${path}?annee=${parsed.data.financialYear}&statut=paiement-enregistre${reference ? `&reference=${encodeURIComponent(reference)}` : ""}`);
}

export async function setContributionDueConcernStatusAction(input: { dueId: string; isNotConcerned: boolean; reason: string }) {
  const path = "/gestion-financiere/cotisations";
  const { supabase } = await requireFinanceUser(path);
  const parsed = z.object({ dueId: z.string().uuid(), isNotConcerned: z.boolean(), reason: z.string().trim().min(3).max(500) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Indiquez un motif de 3 à 500 caractères." };
  const { error } = await supabase.rpc("set_contribution_due_not_concerned", {
    p_due_id: parsed.data.dueId,
    p_is_not_concerned: parsed.data.isNotConcerned,
    p_reason: parsed.data.reason,
  });
  if (error) {
    return { ok: false, message: error.code === "23514"
      ? "Ce mois a déjà reçu un paiement et ne peut pas être déclaré non concerné."
      : error.code === "42501"
        ? "Cette opération est réservée au personnel financier autorisé."
        : "Le statut du mois n’a pas pu être modifié. Vérifiez son statut puis réessayez." };
  }
  revalidatePath(path);
  revalidatePath("/gestion-financiere");
  revalidatePath("/espace-membre/cotisations");
  return { ok: true, message: parsed.data.isNotConcerned ? "Mois marqué comme non concerné." : "Le mois est de nouveau payable." };
}

const reportCellSchema = z.object({
  label: z.string().max(300),
  quantity: z.string().max(24),
  unitPrice: z.string().max(24),
  amount: z.string().max(24),
  percent: z.string().max(24),
}).strict();
const reportDateSchema = z.string().date();
const numericCellValue = z.string().refine((value) => value === "" || /^\d{1,14}(?:\.\d{1,2})?$/.test(value), "Montant invalide.");
const validatedCellSchema = reportCellSchema.extend({ quantity: numericCellValue, unitPrice: numericCellValue, amount: numericCellValue, percent: numericCellValue });
const validatedSideSchema = z.object({ sections: z.array(z.object({ key: z.string(), title: z.string(), rows: z.array(validatedCellSchema).max(100), subtotal: validatedCellSchema }).strict()), total: validatedCellSchema });
const validatedReportDataSchema = z.object({ emplois: validatedSideSchema, ressources: validatedSideSchema }).strict();

async function requireReportTreasurer(path: string) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect(`/connexion?next=${encodeURIComponent(path)}`);
  if (!roles.includes("treasurer") || roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect(`/auth/mfa?next=${encodeURIComponent(path)}`);
  return { supabase, user };
}

function parseReportData(raw: string): FinancialReportData | null {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return null; }
  const parsed = validatedReportDataSchema.safeParse(input);
  if (!parsed.success) return null;
  for (const side of ["emplois", "ressources"] as const) {
    const expected = FINANCIAL_REPORT_SECTIONS[side];
    const sections = parsed.data[side].sections;
    if (sections.length !== expected.length || sections.some((section, index) => section.key !== `${side === "emplois" ? "emploi" : "ressource"}-${index + 1}` || section.title !== expected[index])) return null;
  }
  return parsed.data as FinancialReportData;
}

function hasReportEntries(data: FinancialReportData) {
  const sides = [data.emplois, data.ressources];
  return sides.some((side) => side.sections.some((section) => section.rows.some((cell) => cell.label.trim() || cell.quantity || cell.unitPrice || cell.amount || cell.percent)
    || section.subtotal.quantity || section.subtotal.unitPrice || section.subtotal.amount || section.subtotal.percent)
    || side.total.quantity || side.total.unitPrice || side.total.amount || side.total.percent);
}

export async function createFinancialReportDraftAction(formData: FormData) {
  const path = "/gestion-financiere/bilans";
  const { supabase, user } = await requireReportTreasurer(path);
  const parsed = z.object({ periodStart: reportDateSchema, periodEnd: reportDateSchema }).safeParse({
    periodStart: value(formData, "period_start"), periodEnd: value(formData, "period_end"),
  });
  if (!parsed.success || parsed.data.periodEnd < parsed.data.periodStart) redirect(`${path}?erreur=periode-invalide`);
  const { data: author } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
  const { data: created, error } = await supabase.from("financial_reports").insert({
    title: financialReportTitle(parsed.data.periodStart, parsed.data.periodEnd),
    period_start: parsed.data.periodStart,
    period_end: parsed.data.periodEnd,
    report_data: createBlankFinancialReportData(),
    summary: null,
    storage_path: null,
    file_name: null,
    mime_type: null,
    created_by: user.id,
    author_name: author?.display_name?.trim() || "Trésorier ADEIO",
  }).select("id").single();
  if (error || !created) redirect(`${path}?erreur=creation-impossible`);
  revalidatePath(path);
  redirect(`${path}/${created.id}?statut=brouillon-cree`);
}

export async function saveFinancialReportDraftAction(formData: FormData) {
  const id = value(formData, "report_id");
  const validId = z.string().uuid().safeParse(id);
  const path = validId.success ? `/gestion-financiere/bilans/${id}` : "/gestion-financiere/bilans";
  const { supabase } = await requireReportTreasurer(path);
  const parsed = z.object({ id: z.string().uuid(), start: reportDateSchema, end: reportDateSchema, raw: z.string().max(500_000) }).safeParse({
    id, start: value(formData, "period_start"), end: value(formData, "period_end"), raw: value(formData, "report_data"),
  });
  const data = parsed.success ? parseReportData(parsed.data.raw) : null;
  if (!parsed.success || !data || parsed.data.end < parsed.data.start) redirect(`${path}?erreur=rapport-invalide`);
  const { error } = await supabase.from("financial_reports").update({
    title: financialReportTitle(parsed.data.start, parsed.data.end),
    period_start: parsed.data.start,
    period_end: parsed.data.end,
    report_data: data,
    updated_at: new Date().toISOString(),
  }).eq("id", parsed.data.id).is("published_at", null);
  if (error) redirect(`${path}?erreur=enregistrement-impossible`);
  revalidatePath(path);
  revalidatePath("/gestion-financiere/bilans");
  redirect(`${path}?statut=brouillon-enregistre`);
}

export async function publishManualFinancialReportAction(formData: FormData) {
  const id = value(formData, "report_id");
  const validId = z.string().uuid().safeParse(id);
  const path = validId.success ? `/gestion-financiere/bilans/${id}` : "/gestion-financiere/bilans";
  const { supabase, user } = await requireReportTreasurer(path);
  const parsed = z.object({ id: z.string().uuid(), start: reportDateSchema, end: reportDateSchema, raw: z.string().max(500_000) }).safeParse({
    id, start: value(formData, "period_start"), end: value(formData, "period_end"), raw: value(formData, "report_data"),
  });
  const data = parsed.success ? parseReportData(parsed.data.raw) : null;
  if (!parsed.success || !data || parsed.data.end < parsed.data.start || !hasReportEntries(data)) redirect(`${path}?erreur=rapport-invalide`);
  const { error } = await supabase.from("financial_reports").update({
    title: financialReportTitle(parsed.data.start, parsed.data.end),
    period_start: parsed.data.start,
    period_end: parsed.data.end,
    report_data: data,
    published_at: new Date().toISOString(),
    published_by: user.id,
    updated_at: new Date().toISOString(),
  }).eq("id", parsed.data.id).is("published_at", null);
  if (error) redirect(`${path}?erreur=publication-impossible`);
  revalidatePath(path);
  revalidatePath("/gestion-financiere/bilans");
  revalidatePath("/finances");
  redirect(`${path}?statut=rapport-publie`);
}

export async function createFinancialReportVersionAction(formData: FormData) {
  const sourceId = value(formData, "report_id");
  const validId = z.string().uuid().safeParse(sourceId);
  const path = "/gestion-financiere/bilans";
  const { supabase, user } = await requireReportTreasurer(path);
  if (!validId.success) redirect(`${path}?erreur=version-impossible`);
  const { data: source } = await supabase.from("financial_reports").select("id,title,period_start,period_end,summary,report_data,created_by,author_name,version,published_at").eq("id", sourceId).maybeSingle();
  if (!source?.published_at) redirect(`${path}?erreur=version-impossible`);
  const { data: child } = await supabase.from("financial_reports").select("id").eq("previous_version_id", source.id).maybeSingle();
  if (child) redirect(`${path}?erreur=version-existe`);
  const { data: author } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
  const reportData = parseReportData(JSON.stringify(source.report_data)) ?? createBlankFinancialReportData();
  const { data: created, error } = await supabase.from("financial_reports").insert({
    title: source.title,
    period_start: source.period_start,
    period_end: source.period_end,
    report_data: reportData,
    summary: source.summary,
    storage_path: null,
    file_name: null,
    mime_type: null,
    created_by: user.id,
    author_name: author?.display_name?.trim() || "Trésorier ADEIO",
    version: source.version + 1,
    previous_version_id: source.id,
  }).select("id").single();
  if (error || !created) redirect(`${path}?erreur=version-impossible`);
  revalidatePath(path);
  redirect(`${path}/${created.id}?statut=nouvelle-version`);
}
