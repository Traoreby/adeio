"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type TotpFactor = { id: string; friendly_name?: string | null; status: string };

export function MfaChallengeForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadFactors() {
      await Promise.resolve();
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (active) { setError("Le service de connexion n’est pas configuré."); setLoading(false); }
        return;
      }
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      const verified = (data?.totp ?? []).filter((factor) => factor.status === "verified");
      setFactors(verified);
      setFactorId(verified[0]?.id ?? "");
      if (listError || verified.length === 0) setError("Aucun facteur de vérification actif n’a été trouvé. Contactez l’administration ADEIO.");
      setLoading(false);
    }
    void loadFactors();
    return () => { active = false; };
  }, []);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !factorId) return setError("Aucun facteur de vérification n’est disponible.");
    setSubmitting(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setSubmitting(false);
    if (verifyError) return setError("Code incorrect ou expiré. Vérifiez l’heure de votre appareil et réessayez.");
    router.replace(nextPath);
    router.refresh();
  }

  return <div className="auth-card"><div className="auth-card-mark"><ShieldCheck size={19} /></div><div className="eyebrow eyebrow-green">VÉRIFICATION EN DEUX ÉTAPES</div><h1>Confirmez votre connexion.</h1><p>Saisissez le code à six chiffres affiché par votre application d’authentification.</p>{loading ? <div className="form-alert info-alert">Chargement des facteurs de sécurité…</div> : <form className="form-stack" onSubmit={verify}>{factors.length > 1 && <><label htmlFor="mfa-factor">Facteur</label><select className="form-input" id="mfa-factor" value={factorId} onChange={(event) => setFactorId(event.target.value)}>{factors.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendly_name || "Application d’authentification"}</option>)}</select></>}<label htmlFor="mfa-code">Code de vérification</label><input className="form-input mfa-code-input" id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required />{error && <div role="alert" className="form-alert error-alert">{error}</div>}<Button type="submit" className="form-submit" size="lg" disabled={submitting || !factorId || code.length !== 6}>{submitting ? "Vérification…" : "Vérifier le code"}<KeyRound size={16} /></Button></form>}<div className="auth-security"><ShieldCheck size={16} /><span>Cette étape protège les données et outils sensibles de l’association.</span></div></div>;
}
