"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode, RefreshCw, ShieldOff } from "lucide-react";

export function MemberQrControl({ memberId, hasActiveToken }: { memberId: string; hasActiveToken: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function request(path: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Action impossible.");
      setMessage(body.message ?? "Le QR Code a été désactivé. Le lien précédent ne fonctionne plus.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Action impossible."); }
    finally { setBusy(false); }
  }
  return <div className="member-qr-control"><div className="member-qr-actions"><button className="admin-submit" type="button" disabled={busy} onClick={() => void request("/api/admin/member-qr")}><QrCode size={15} /> {busy ? "Traitement…" : hasActiveToken ? "Réémettre le QR Code" : "Émettre un QR Code"}<RefreshCw size={14} /></button>{hasActiveToken && <button className="text-action danger-action" type="button" disabled={busy} onClick={() => void request("/api/admin/member-qr/revoke")}><ShieldOff size={14} /> Désactiver</button>}</div>{message && <p role="status">{message}</p>}<small>Le jeton reste côté serveur. La carte PDF réutilise le QR actif sans le renouveler ; une réémission invalide définitivement le précédent.</small></div>;
}
