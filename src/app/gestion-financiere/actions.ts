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

function toFcfa(raw: string) {
  const normalized = raw.replace(/[\s\u00a0]/g, "");
  return /^\d{1,13}$/.test(normalized) ? Number(normalized) : Number.NaN;
}

async function allowedUpload(file: FormDataEntryValue | null, types: string[]) {
  if (!(file instanceof File) || file.size === 0) return null;
  const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "";
  if (!extension || file.size > 10 * 1024 * 1024 || !types.includes(file.type)) return null;
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const validSignature = file.type === "application/pdf"
    ? String.fromCharCode(...header.slice(0, 5)) === "%PDF-"
    : file.type === "image/jpeg"
      ? header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
      : header.length === 8 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47 && header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a;
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
    amount: toFcfa(value(formData, "amount_fcfa")),
    method: value(formData, "payment_method"),
    correctionOf: value(formData, "correction_of") || undefined,
  });
  if (!parsed.success) redirect(`${path}?erreur=formulaire-invalide`);

  const { data: category } = await supabase.from("transaction_categories").select("id,direction,is_active").eq("id", parsed.data.categoryId).maybeSingle();
  if (!category?.is_active || category.direction !== parsed.data.direction) redirect(`${path}?erreur=categorie-invalide`);
  if (parsed.data.correctionOf) {
    const { data: original } = await supabase.from("financial_transactions").select("id,direction,is_published").eq("id", parsed.data.correctionOf).maybeSingle();
    if (!original?.is_published || original.direction === parsed.data.direction) redirect(`${path}?erreur=correction-invalide`);
  }

  const attachment = await allowedUpload(formData.get("attachment"), ["application/pdf", "image/jpeg", "image/png"]);
  if (formData.get("attachment") && !attachment) redirect(`${path}?erreur=justificatif-invalide`);

  const { data: transaction, error: insertError } = await supabase.from("financial_transactions").insert({
    occurred_on: parsed.data.occurredOn,
    direction: parsed.data.direction,
    category_id: parsed.data.categoryId,
    label: parsed.data.label,
    amount_fcfa: parsed.data.amount,
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
  const amount = toFcfa(value(formData, "amount_fcfa"));
  const parsed = z.object({
    name: z.string().trim().min(3).max(120),
    amount: z.number().int().positive().max(1_000_000_000_000),
    periodicity: z.enum(["monthly", "yearly", "custom"]),
    customDays: z.number().int().positive().max(3650).nullable(),
    startsOn: z.string().date(),
    endsOn: z.string().date().nullable(),
  }).safeParse({
    name: value(formData, "name"),
    amount,
    periodicity: value(formData, "periodicity"),
    customDays: value(formData, "periodicity") === "custom" ? Number(value(formData, "custom_period_days")) : null,
    startsOn: value(formData, "starts_on"),
    endsOn: value(formData, "ends_on") || null,
  });
  if (!parsed.success || (parsed.data.periodicity === "custom") !== (parsed.data.customDays !== null)) redirect(`${path}?erreur=plan-invalide`);
  if (parsed.data.endsOn && parsed.data.endsOn < parsed.data.startsOn) redirect(`${path}?erreur=plan-invalide`);
  const { error } = await supabase.from("contribution_plans").insert({
    name: parsed.data.name,
    amount_fcfa: parsed.data.amount,
    periodicity: parsed.data.periodicity,
    custom_period_days: parsed.data.customDays,
    starts_on: parsed.data.startsOn,
    ends_on: parsed.data.endsOn,
    created_by: user.id,
  });
  if (error) redirect(`${path}?erreur=plan-invalide`);
  revalidatePath(path);
  redirect(`${path}?statut=plan-cree`);
}

export async function generateContributionDuesAction(formData: FormData) {
  const path = "/gestion-financiere/cotisations";
  const { supabase } = await requireFinanceUser(path);
  const parsed = z.string().uuid().safeParse(value(formData, "plan_id"));
  if (!parsed.success) redirect(`${path}?erreur=plan-invalide`);
  const { data, error } = await supabase.rpc("generate_contribution_dues", { p_plan_id: parsed.data, p_through: value(formData, "through") || new Date().toISOString().slice(0, 10) });
  if (error) redirect(`${path}?erreur=generation-impossible`);
  revalidatePath(path);
  revalidatePath("/espace-membre/cotisations");
  redirect(`${path}?statut=${encodeURIComponent(`${data ?? 0}-echeance(s)-generee(s)`)}`);
}

export async function recordContributionPaymentAction(formData: FormData) {
  const path = "/gestion-financiere/cotisations";
  const { supabase } = await requireFinanceUser(path);
  const parsed = z.object({
    memberId: z.string().uuid(),
    paidOn: z.string().date(),
    amount: z.number().int().positive().max(1_000_000_000_000),
    method: z.enum(methods),
    note: z.string().max(500),
  }).safeParse({
    memberId: value(formData, "member_id"),
    paidOn: value(formData, "paid_on"),
    amount: toFcfa(value(formData, "amount_fcfa")),
    method: value(formData, "payment_method"),
    note: value(formData, "note"),
  });
  if (!parsed.success) redirect(`${path}?erreur=paiement-invalide`);
  const { error } = await supabase.rpc("record_contribution_payment", {
    p_member_id: parsed.data.memberId,
    p_paid_on: parsed.data.paidOn,
    p_amount_fcfa: parsed.data.amount,
    p_payment_method: parsed.data.method,
    p_note: parsed.data.note || null,
  });
  if (error) redirect(`${path}?erreur=paiement-impossible`);
  revalidatePath("/gestion-financiere");
  revalidatePath("/gestion-financiere/cotisations");
  revalidatePath("/gestion-financiere/operations");
  revalidatePath("/finances");
  revalidatePath("/espace-membre/cotisations");
  redirect(`${path}?statut=paiement-enregistre`);
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
  const file = await allowedUpload(formData.get("report_pdf"), ["application/pdf"]);
  if (!parsed.success || !file || parsed.data.periodEnd < parsed.data.periodStart) redirect(`${path}?erreur=rapport-invalide`);

  const storagePath = `${user.id}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage.from("financial-reports").upload(storagePath, file.file, { contentType: "application/pdf", upsert: false });
  if (uploadError) redirect(`${path}?erreur=publication-impossible`);
  const { error: insertError } = await supabase.from("financial_reports").insert({
    title: parsed.data.title,
    period_start: parsed.data.periodStart,
    period_end: parsed.data.periodEnd,
    summary: parsed.data.summary || null,
    storage_path: storagePath,
    file_name: file.file.name.slice(0, 180),
    mime_type: "application/pdf",
    created_by: user.id,
  });
  if (insertError) {
    await supabase.storage.from("financial-reports").remove([storagePath]);
    redirect(`${path}?erreur=publication-impossible`);
  }
  revalidatePath(path);
  revalidatePath("/finances");
  revalidatePath("/espace-membre/documents");
  redirect(`${path}?statut=bilan-publie`);
}
