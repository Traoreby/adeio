"use client";

import { useState } from "react";
import Image from "next/image";
import { Copy, QrCode, RefreshCw, ShieldOff } from "lucide-react";

export function MemberQrControl({ memberId, hasActiveToken }: { memberId: string; hasActiveToken: boolean }) {
  const [qr, setQr] = useState<{ verificationUrl: string; image: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function request(path: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Action impossible.");
      if (body.image) setQr(body);
      else { setQr(null); setMessage("Le QR Code a été désactivé. Le lien précédent ne fonctionne plus."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Action impossible."); }
    finally { setBusy(false); }
  }
  return <div className="member-qr-control"><div className="member-qr-actions"><button className="admin-submit" type="button" disabled={busy} onClick={() => void request("/api/admin/member-qr")}><QrCode size={15} /> {busy ? "Traitement…" : hasActiveToken ? "Régénérer le QR Code" : "Émettre un QR Code"}<RefreshCw size={14} /></button>{hasActiveToken && <button className="text-action danger-action" type="button" disabled={busy} onClick={() => void request("/api/admin/member-qr/revoke")}><ShieldOff size={14} /> Désactiver</button>}</div>{qr && <div className="member-qr-result"><Image src={qr.image} alt="QR Code de vérification du membre" width={128} height={128} unoptimized /><div><strong>Scannez pour vérifier cette carte</strong><a href={qr.verificationUrl} target="_blank" rel="noreferrer">{qr.verificationUrl}</a><button type="button" className="text-action" onClick={() => { void navigator.clipboard.writeText(qr.verificationUrl); setMessage("Lien copié."); }}><Copy size={13} /> Copier le lien</button></div></div>}{message && <p role="status">{message}</p>}<small>La régénération révoque immédiatement le lien précédent. Le jeton est affiché uniquement pendant cette session d’administration.</small></div>;
}
