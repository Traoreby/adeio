"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { loginMemberAction } from "@/app/connexion/actions";
import { Button } from "@/components/ui/button";

const credentialsSchema = z.object({
  email: z.string().email("Saisissez une adresse e-mail valide."),
  password: z.string().min(1, "Saisissez votre mot de passe."),
});
const recoverySchema = z.object({ email: z.string().email("Saisissez une adresse e-mail valide.") });
type Credentials = z.infer<typeof credentialsSchema>;
type Recovery = z.infer<typeof recoverySchema>;

export function AuthForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "recovery">("login");
  const [message, setMessage] = useState("");
  const [fatalError, setFatalError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const credentials = useForm<Credentials>({ resolver: zodResolver(credentialsSchema) });
  const recovery = useForm<Recovery>({ resolver: zodResolver(recoverySchema) });
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  async function onLogin(values: Credentials) {
    setMessage(""); setFatalError("");
    const result = await loginMemberAction({ ...values, next: searchParams.get("next") ?? undefined });
    if (result.error) return setFatalError(result.error);
  }

  async function onRecovery(values: Recovery) {
    setMessage(""); setFatalError("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return setFatalError(process.env.NODE_ENV !== "production" ? "La réinitialisation sera disponible après configuration de l’espace membre." : "La réinitialisation du mot de passe est momentanément indisponible. Contactez l’administration ADEIO.");
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${siteUrl}/auth/callback?next=/mot-de-passe`,
    });
    if (error) return setFatalError("L’envoi du lien a échoué. Vérifiez l’adresse ou réessayez plus tard.");
    setMessage("Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé.");
  }

  return <div className="auth-card">
    <div className="auth-card-mark"><KeyRound size={19} /></div>
    <div className="eyebrow eyebrow-green">{mode === "login" ? "ESPACE MEMBRE" : "RÉCUPÉRATION DU COMPTE"}</div>
    <h1>{mode === "login" ? "Bon retour parmi nous." : "Réinitialiser le mot de passe"}</h1>
    <p>{mode === "login" ? "Connectez-vous avec l’adresse e-mail associée à votre compte ADEIO." : "Un lien sécurisé sera envoyé à l’adresse associée à votre compte."}</p>
    {mode === "login" ? <form className="form-stack" onSubmit={credentials.handleSubmit(onLogin)}>
      <label htmlFor="login-email">Adresse e-mail</label><div className="input-with-icon"><Mail size={17} aria-hidden="true" /><input id="login-email" type="email" autoComplete="off" placeholder="Saisissez votre adresse e-mail" aria-invalid={Boolean(credentials.formState.errors.email)} aria-describedby={credentials.formState.errors.email ? "login-email-error" : undefined} {...credentials.register("email")} /></div>
      {credentials.formState.errors.email && <span id="login-email-error" className="field-error" role="alert">{credentials.formState.errors.email.message}</span>}
      <div className="label-row"><label htmlFor="login-password">Mot de passe</label><button type="button" className="text-button" onClick={() => { setMode("recovery"); setFatalError(""); setMessage(""); }}>Mot de passe oublié ?</button></div>
      <div className="password-input-wrap"><input id="login-password" className="form-input" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Votre mot de passe" aria-invalid={Boolean(credentials.formState.errors.password)} aria-describedby={credentials.formState.errors.password ? "login-password-error" : undefined} {...credentials.register("password")} /><button className="password-visibility" type="button" aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div>
      {credentials.formState.errors.password && <span id="login-password-error" className="field-error" role="alert">{credentials.formState.errors.password.message}</span>}
      {fatalError && <div role="alert" className="form-alert error-alert">{fatalError}</div>}
      {process.env.NODE_ENV === "production" ? <div className="form-alert info-alert">La connexion est réservée aux membres invités par l’administration.</div> : !configured && <div className="form-alert info-alert">L’espace sera activé après le raccordement au projet Supabase</div>}
      <Button type="submit" className="form-submit" size="lg" disabled={credentials.formState.isSubmitting}>{credentials.formState.isSubmitting ? "Connexion…" : "Se connecter"}<ArrowRight size={17} /></Button>
    </form> : <form className="form-stack" onSubmit={recovery.handleSubmit(onRecovery)}>
      <label htmlFor="recovery-email">Adresse e-mail</label><div className="input-with-icon"><Mail size={17} aria-hidden="true" /><input id="recovery-email" type="email" autoComplete="off" placeholder="Saisissez votre adresse e-mail" aria-invalid={Boolean(recovery.formState.errors.email)} aria-describedby={recovery.formState.errors.email ? "recovery-email-error" : undefined} {...recovery.register("email")} /></div>
      {recovery.formState.errors.email && <span id="recovery-email-error" className="field-error" role="alert">{recovery.formState.errors.email.message}</span>}
      {fatalError && <div role="alert" className="form-alert error-alert">{fatalError}</div>}
      {message && <div role="status" className="form-alert success-alert">{message}</div>}
      <Button type="submit" className="form-submit" size="lg" disabled={recovery.formState.isSubmitting}>{recovery.formState.isSubmitting ? "Envoi…" : "Envoyer le lien"}<ArrowRight size={17} /></Button>
      <button type="button" className="back-link form-back" onClick={() => { setMode("login"); setFatalError(""); setMessage(""); }}><ArrowLeft size={15} /> Retour à la connexion</button>
    </form>}
    <div className="auth-security"><ShieldCheck size={17} aria-hidden="true" /><span>Les comptes sont créés par l’administration ADEIO. Aucune inscription publique.</span></div>
  </div>;
}
