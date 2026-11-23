"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { KeyRound, ShieldCheck, ShieldX } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Factor = { id: string; friendly_name?: string | null; status: string };
type PendingFactor = { id: string; qrCode: string; secret: string; uri: string };

async function syncMfaSetting() {
  return fetch("/api/account/mfa-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function MfaSettings({ syncAvailable }: { syncAvailable: boolean }) {
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [pending, setPending] = useState<PendingFactor | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function refreshFactors() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) { setLoading(false); setError("Le service Supabase n’est pas configuré."); return; }
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) setError("Impossible de charger les facteurs de sécurité.");
    setFactors((data?.totp ?? []).filter((factor) => factor.status === "verified"));
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    async function loadFactors() {
      await Promise.resolve();
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (active) { setLoading(false); setError("Le service Supabase n’est pas configuré."); }
        return;
      }
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      if (listError) setError("Impossible de charger les facteurs de sécurité.");
      setFactors((data?.totp ?? []).filter((factor) => factor.status === "verified"));
      setLoading(false);
    }
    void loadFactors();
    return () => { active = false; };
  }, []);

  async function startEnrollment() {
    setError(""); setMessage("");
    if (!syncAvailable) return setError("La protection côté base de données doit être configurée avant l’activation du MFA.");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return setError("Le service Supabase n’est pas configuré.");
    setBusy(true);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "ADEIO" });
    setBusy(false);
    if (enrollError || !data?.totp) return setError("L’activation de la vérification en deux étapes a échoué.");
    setPending({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri });
  }

  async function verifyEnrollment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !pending) return setError("Recommencez l’activation du facteur.");
    setBusy(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: pending.id, code: code.trim() });
    if (verifyError) { setBusy(false); return setError("Code incorrect. Vérifiez votre application puis réessayez."); }
    const response = await syncMfaSetting();
    setBusy(false);
    if (!response.ok) {
      setPending(null); setCode("");
      await refreshFactors();
      return setError("Le facteur est vérifié, mais la protection du compte n’a pas été synchronisée. Appuyez sur « Synchroniser » ou contactez l’administration.");
    }
    setPending(null); setCode(""); setMessage("La vérification en deux étapes est activée pour ce compte.");
    await refreshFactors(); router.refresh();
  }

  async function synchronize() {
    setError(""); setMessage(""); setBusy(true);
    const response = await syncMfaSetting();
    setBusy(false);
    if (!response.ok) return setError("La synchronisation n’a pas abouti. Vérifiez la configuration du projet.");
    setMessage("La protection du compte a été synchronisée."); router.refresh();
  }

  async function disableFactor(factorId: string) {
    setError(""); setMessage("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return setError("Le service Supabase n’est pas configuré.");
    if (disableCode.length !== 6) return setError("Saisissez le code actuel pour désactiver la protection.");
    setBusy(true);
    const { error: challengeError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: disableCode });
    if (challengeError) { setBusy(false); return setError("Code incorrect. La protection reste active."); }
    const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId });
    if (removeError) { setBusy(false); return setError("Le facteur n’a pas pu être retiré."); }
    const response = await syncMfaSetting();
    setBusy(false);
    if (!response.ok) {
      await refreshFactors();
      return setError("Le facteur a été retiré, mais la synchronisation du compte a échoué. Appuyez sur « Synchroniser la protection ».");
    }
    setDisableCode(""); setMessage("La vérification en deux étapes a été désactivée.");
    await refreshFactors(); router.refresh();
  }

  const verifiedFactors = factors;
  const qrSource = pending?.qrCode.startsWith("data:") ? pending.qrCode : pending ? `data:image/svg+xml;utf8,${encodeURIComponent(pending.qrCode)}` : "";

  return <div className="mfa-settings-card">
    <div className="mfa-settings-head"><span className="pillar-icon"><KeyRound size={21} /></span><div><div className="eyebrow eyebrow-green">AUTHENTIFICATION MULTIFACTEUR</div><h1>Protégez votre compte.</h1><p>Ajoutez un code TOTP depuis une application d’authentification. La fonction est facultative et peut être désactivée avec un code valide.</p></div></div>
    {!syncAvailable && <div className="form-alert info-alert">L’administration doit configurer SUPABASE_SERVICE_ROLE_KEY avant l’activation du MFA.</div>}
    {loading ? <div className="admin-empty">Chargement des facteurs…</div> : verifiedFactors.length ? <div className="mfa-active-panel"><div className="mfa-active-status"><ShieldCheck size={18} /><div><strong>Vérification en deux étapes activée</strong><small>{verifiedFactors[0].friendly_name || "Application TOTP"}</small></div></div><label htmlFor="mfa-disable-code">Code actuel pour désactiver</label><div className="mfa-disable-row"><input className="form-input mfa-code-input" id="mfa-disable-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={disableCode} onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /><Button type="button" variant="outline" size="sm" disabled={busy || !disableCode || !syncAvailable} onClick={() => void disableFactor(verifiedFactors[0].id)}>Désactiver</Button></div>{verifiedFactors.length > 1 && <p>Un seul facteur TOTP peut être géré depuis cette interface pour le moment.</p>}</div> : pending ? <div className="mfa-enrollment-panel"><div className="mfa-qr"><Image src={qrSource} alt="QR Code de configuration TOTP" width={190} height={190} unoptimized /></div><p>Scannez ce code avec votre application d’authentification. Si le scan échoue, saisissez cette clé manuellement :</p><code className="mfa-secret">{pending.secret}</code><form className="form-stack" onSubmit={verifyEnrollment}><label htmlFor="mfa-enroll-code">Code affiché par l’application</label><input className="form-input mfa-code-input" id="mfa-enroll-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required /><div className="mfa-enrollment-actions"><Button type="submit" disabled={busy || code.length !== 6}>{busy ? "Vérification…" : "Confirmer l’activation"}</Button><Button type="button" variant="ghost" onClick={() => setPending(null)}>Annuler</Button></div></form><details className="mfa-uri-details"><summary>Afficher le lien de configuration</summary><code>{pending.uri}</code></details></div> : <div className="mfa-off-panel"><span className="mfa-off-icon"><ShieldX size={20} /></span><div><strong>Vérification en deux étapes désactivée</strong><p>Sans facteur actif, le compte reste soumis aux règles de mot de passe et de session Supabase.</p></div><Button type="button" disabled={!syncAvailable || busy} onClick={() => void startEnrollment()}>{busy ? "Préparation…" : "Activer TOTP"}</Button></div>}
    {syncAvailable && !pending && <Button type="button" variant="outline" size="sm" className="mfa-sync-button" disabled={busy} onClick={() => void synchronize()}>Synchroniser la protection</Button>}
    {error && <div role="alert" className="form-alert error-alert mfa-message">{error}</div>}{message && <div role="status" className="form-alert success-alert mfa-message">{message}</div>}
  </div>;
}
