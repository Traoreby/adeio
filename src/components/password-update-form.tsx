"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

const schema = z.object({
  password: z.string().min(10, "Utilisez au moins 10 caractères."),
  confirmation: z.string().min(1, "Confirmez votre mot de passe."),
}).refine((value) => value.password === value.confirmation, { path: ["confirmation"], message: "Les deux mots de passe ne correspondent pas." });
type Values = z.infer<typeof schema>;

export function PasswordUpdateForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirmation: "" } });
  async function submit(values: Values) {
    setError("");
    const response = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: values.password }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setError(result.error ?? "La mise à jour a échoué. Le lien peut avoir expiré ; demandez-en un nouveau.");
    router.replace("/espace-membre");
    router.refresh();
  }
  return <div className="auth-card"><div className="auth-card-mark"><KeyRound size={19} /></div><div className="eyebrow eyebrow-green">SÉCURITÉ DU COMPTE</div><h1>Choisissez un nouveau mot de passe.</h1><p>Un mot de passe long aide à protéger votre compte ADEIO.</p><form className="form-stack" onSubmit={form.handleSubmit(submit)}><label htmlFor="new-password">Nouveau mot de passe</label><input id="new-password" className="form-input" type="password" autoComplete="new-password" {...form.register("password")} />{form.formState.errors.password && <span className="field-error">{form.formState.errors.password.message}</span>}<label htmlFor="confirm-password">Confirmer le mot de passe</label><input id="confirm-password" className="form-input" type="password" autoComplete="new-password" {...form.register("confirmation")} />{form.formState.errors.confirmation && <span className="field-error">{form.formState.errors.confirmation.message}</span>}{error && <div role="alert" className="form-alert error-alert">{error}</div>}<Button type="submit" className="form-submit" size="lg" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Enregistrement…" : "Mettre à jour"}<ArrowRight size={17} /></Button></form></div>;
}
