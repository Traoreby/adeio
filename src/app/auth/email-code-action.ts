"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const codeSchema = z.object({
  email: z.string().trim().email().max(254),
  token: z.string().trim().regex(/^\d{6}$/, "Saisissez le code à 6 chiffres."),
  flow: z.enum(["invitation", "signup", "recovery"]),
});
const PASSWORD_API_PATH = "/api/account/password";

export async function verifyEmailCodeAction(formData: FormData) {
  const parsed = codeSchema.safeParse({
    email: formData.get("email"),
    token: formData.get("token"),
    flow: formData.get("flow"),
  });
  if (!parsed.success) redirect(`/activer-compte?flow=${formData.get("flow") === "recovery" ? "recovery" : "invitation"}&erreur=code-invalide`);

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/activer-compte?erreur=service-indisponible");
  const type = parsed.data.flow === "invitation" ? "invite" : parsed.data.flow === "signup" ? "signup" : "recovery";
  const { data, error } = await supabase.auth.verifyOtp({
    email: parsed.data.email.toLowerCase(),
    token: parsed.data.token,
    type,
  });
  if (error || !data.user || !data.session) {
    redirect(`/activer-compte?flow=${parsed.data.flow}&erreur=${error?.code === "over_request_rate_limit" ? "trop-de-tentatives" : "code-invalide"}`);
  }

  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: PASSWORD_API_PATH,
    maxAge: 10 * 60,
  };
  cookieStore.set("adeio-password-flow", parsed.data.flow, cookieOptions);
  if (parsed.data.flow === "recovery") cookieStore.set("adeio-password-recovery", "1", cookieOptions);
  redirect(`/mot-de-passe?flow=${parsed.data.flow}`);
}
