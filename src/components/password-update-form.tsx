"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

const schema = z.object({
  password: z.string().min(6, "Le mot de passe doit contenir au moins 6 caractères."),
  confirmation: z.string().min(6, "Le mot de passe doit contenir au moins 6 caractères."),
}).refine((value) => value.password === value.confirmation, { path: ["confirmation"], message: "Les deux mots de passe ne correspondent pas." });
type Values = z.infer<typeof schema>;

export function PasswordUpdateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const flow = searchParams.get("flow");
  const isInvitation = flow === "invitation" || flow === "signup";
  const isReactivation = flow === "reactivation";
  const [error, setError] = useState("");
  const [allowRecoveryResend, setAllowRecoveryResend] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirmation: "" } });
  async function submit(values: Values) {
    setError("");
    setAllowRecoveryResend(false);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ password: values.password, next: searchParams.get("next") ?? undefined }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "La mise à jour a échoué. Vérifiez votre session puis réessayez.");
        setAllowRecoveryResend(result.allowRecoveryResend === true);
        return;
      }
      router.replace(typeof result.redirectTo === "string" ? result.redirectTo : "/espace-membre");
      router.refresh();
    } catch {
      setError("La connexion au service a échoué. Vérifiez votre réseau puis réessayez.");
    }
  }
  const heading = isInvitation ? "Finalisez votre invitation ADEIO." : isReactivation ? "Rétablissez votre accès ADEIO." : "Choisissez un nouveau mot de passe.";
  const description = isInvitation
    ? "Votre invitation a été vérifiée. Choisissez votre premier mot de passe pour activer votre espace membre."
    : isReactivation
      ? "Choisissez un nouveau mot de passe pour retrouver l’accès à votre compte membre."
      : "Définissez un mot de passe d’au moins 6 caractères. Vous serez ensuite redirigé vers votre espace ADEIO.";
  return <div className="auth-card"><div className="auth-card-mark"><KeyRound size={19} /></div><div className="eyebrow eyebrow-green">{isInvitation ? "INVITATION ADEIO" : isReactivation ? "RÉACTIVATION DU COMPTE" : "SÉCURITÉ DU COMPTE"}</div><h1>{heading}</h1><p>{description}</p><form className="form-stack" onSubmit={form.handleSubmit(submit)}><label htmlFor="new-password">Nouveau mot de passe</label><input id="new-password" className="form-input" type="password" autoComplete="new-password" minLength={6} aria-invalid={Boolean(form.formState.errors.password)} aria-describedby={form.formState.errors.password ? "new-password-error" : undefined} {...form.register("password")} />{form.formState.errors.password && <span id="new-password-error" className="field-error" role="alert">{form.formState.errors.password.message}</span>}<label htmlFor="confirm-password">Confirmer le mot de passe</label><input id="confirm-password" className="form-input" type="password" autoComplete="new-password" minLength={6} aria-invalid={Boolean(form.formState.errors.confirmation)} aria-describedby={form.formState.errors.confirmation ? "confirm-password-error" : undefined} {...form.register("confirmation")} />{form.formState.errors.confirmation && <span id="confirm-password-error" className="field-error" role="alert">{form.formState.errors.confirmation.message}</span>}{error && <div role="alert" className="form-alert error-alert">{error}{allowRecoveryResend && flow === "recovery" && <p><Link href="/connexion?recovery=1" className="text-link">Demander un nouvel e-mail de récupération</Link></p>}</div>}<Button type="submit" className="form-submit" size="lg" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Enregistrement…" : "Mettre à jour"}<ArrowRight size={17} /></Button></form><p className="auth-security">Vous ne reconnaissez pas cette demande ? <Link href="/connexion">Retour à la connexion</Link></p></div>;
}
