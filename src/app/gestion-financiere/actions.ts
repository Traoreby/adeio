"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";

const financeRoles = ["treasurer", "auditor", "super_admin"] as const;
const methods = ["cash", "mobile_money", "bank_transfer", "other"] as const;

async function requireFinanceUser(path: string) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect(`/connexion?next=${encodeURIComponent(path)}`);
  if (!roles.some((role) => financeRoles.includes(role as (typeof financeRoles)[number]))) {
    redirect("/espace-membre?erreur=acces-refuse");
  }
  if (!await hasRequiredMfa(supabase, user.id)) redirect(`/auth/mfa?next=${encodeURIComponent(path)}`);
  return { supabase, user };
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
  const { supabase, user } = await requireFinanceUser(path);
  const parsed = z.object({
    name: z.string().trim().min(3).max(120),
    amountInr: z.number().int().positive().max(1_000_000_000_000),
    financialYear: z.number().int().min(1900).max(2200),
  }).safeParse({
    name: value(formData, "name"),
    amountInr: toAmount(value(formData, "amount_inr")),
    financialYear: Number(value(formData, "financial_year")),
  });
  if (!parsed.success) redirect(`${path}?erreur=plan-invalide`);
  const { error } = await supabase.from("contribution_plans").insert({
    name: parsed.data.name,
    amount_inr: parsed.data.amountInr,
    currency_code: "INR",
    periodicity: "monthly",
    custom_period_days: null,
    starts_on: `${parsed.data.financialYear}-01-01`,
    ends_on: `${parsed.data.financialYear}-12-31`,
    created_by: user.id,
  });
  if (error) redirect(`${path}?erreur=plan-invalide`);
  revalidatePath(path);
  redirect(`${path}?statut=plan-cree`);
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

export async function publishFinancialReportAction(formData: FormData) {
  const path = "/gestion-financiere/bilans";
  const { supabase, user } = await requireFinanceUser(path);
  const parsed = z.object({
    title: z.string().trim().min(3).max(160),
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
    summary: z.string().trim().max(1000),
  }).safeParse({
    title: value(formData, "title"),
    periodStart: value(formData, "period_start"),
    periodEnd: value(formData, "period_end"),
    summary: value(formData, "summary"),
  });
  if (!parsed.success || parsed.data.periodEnd < parsed.data.periodStart) redirect(`${path}?erreur=rapport-invalide`);
  const { data: summaries, error: summaryError } = await supabase.rpc("get_financial_summary_inr", { p_from: parsed.data.periodStart, p_to: parsed.data.periodEnd });
  const summary = summaries?.[0];
  if (summaryError || !summary) redirect(`${path}?erreur=publication-impossible`);

  const { error: insertError } = await supabase.from("financial_reports").insert({
    title: parsed.data.title,
    period_start: parsed.data.periodStart,
    period_end: parsed.data.periodEnd,
    summary: parsed.data.summary || null,
    storage_path: null,
    file_name: null,
    mime_type: null,
    total_income_inr: summary.total_income_inr,
    total_expense_inr: summary.total_expense_inr,
    net_balance_inr: summary.net_balance_inr,
    transaction_count: summary.transaction_count,
    created_by: user.id,
  });
  if (insertError) redirect(`${path}?erreur=publication-impossible`);
  revalidatePath(path);
  revalidatePath("/finances");
  revalidatePath("/espace-membre/documents");
  redirect(`${path}?statut=bilan-publie`);
}
