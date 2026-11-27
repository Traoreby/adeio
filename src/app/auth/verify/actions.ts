"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeRedirectPath } from "@/lib/redirect";
import { getSiteBaseUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const authLinkSchema = z.object({
  tokenHash: z.string().trim().min(20).max(256).regex(/^[a-zA-Z0-9_-]+$/),
  type: z.enum(["invite", "signup", "recovery"]),
  flow: z.enum(["invitation", "signup", "recovery", "reactivation"]),
  next: z.string().max(2048).optional(),
});

const PASSWORD_API_PATH = "/api/account/password";
const RECOVERY_COOKIE = "adeio-password-recovery";
const PASSWORD_FLOW_COOKIE = "adeio-password-flow";

function errorPath(flow: string, error: string) {
  return `/auth/verify?flow=${encodeURIComponent(flow)}&erreur=${encodeURIComponent(error)}`;
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return "";
  return error.code.toLowerCase();
}

export async function verifyAuthEmailLinkAction(formData: FormData) {
  const parsed = authLinkSchema.safeParse({
    tokenHash: formData.get("token_hash"),
    type: formData.get("type"),
    flow: formData.get("flow"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) redirect(errorPath("recovery", "lien-incomplet"));

  const { tokenHash, type, flow } = parsed.data;
  const flowMatchesType = (flow === "invitation" && type === "invite")
    || (flow === "signup" && type === "signup")
    || ((flow === "recovery" || flow === "reactivation") && type === "recovery");
  if (!flowMatchesType) redirect(errorPath(flow, "lien-invalide"));

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(errorPath(flow, "service-indisponible"));

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
  if (error || !data.user || !data.session) {
    const code = safeErrorCode(error);
    const reason = code.includes("expired") || code.includes("otp_expired") || code.includes("token_not_found")
      ? "lien-expire"
      : code === "over_request_rate_limit"
        ? "trop-de-demandes"
        : "lien-invalide";
    redirect(errorPath(flow, reason));
  }

  const { data: verified, error: verificationError } = await supabase.auth.getUser();
  if (verificationError || !verified.user || verified.user.id !== data.user.id) {
    redirect(errorPath(flow, "session-absente"));
  }

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: PASSWORD_API_PATH,
    maxAge: 10 * 60,
  };
  cookieStore.set(RECOVERY_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  cookieStore.set(PASSWORD_FLOW_COOKIE, flow, cookieOptions);
  if (flow === "recovery") cookieStore.set(RECOVERY_COOKIE, "1", cookieOptions);

  const siteUrl = await getSiteBaseUrl();
  const next = safeRedirectPath(parsed.data.next ?? null, siteUrl ?? "https://adeio.vercel.app", "/espace-membre");
  const passwordUrl = new URL("/mot-de-passe", siteUrl ?? "https://adeio.vercel.app");
  passwordUrl.searchParams.set("flow", flow);
  passwordUrl.searchParams.set("next", next);
  redirect(`${passwordUrl.pathname}${passwordUrl.search}`);
}
