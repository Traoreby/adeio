"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode } from "lucide-react";

type Candidate = { id: string; full_name: string; member_number: string; hasQr: boolean };

export function MemberQrBatchForm({ members }: { members: Candidate[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const router = useRouter();
  const allSelected = members.length > 0 && selected.length === members.length;

  async function issueBatch() {
    if (!selected.length || busy) return;
    if (selected.some((id) => members.find((member) => member.id === id)?.hasQr)
      && !window.confirm("La réémission invalidera définitivement les QR actifs sélectionnés. Continuer ?")) return;
    setBusy(true);
    setMessage("");
    setProgress({ completed: 0, total: selected.length });
    try {
      const response = await fetch("/api/admin/member-qr/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberIds: selected }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Les QR Codes n’ont pas pu être émis.");
      }
      if (!response.body) throw new Error("Le suivi du lot n’a pas pu démarrer.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "progress") setProgress({ completed: event.completed, total: event.total });
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "complete") {
            completed = true;
            const failed = Array.isArray(event.failed) ? event.failed.length : 0;
            setMessage(failed ? `${event.message} ${failed} échec(s) à reprendre depuis les fiches concernées.` : event.message);
          }
        }
        if (done) break;
      }
      if (!completed) throw new Error("Le traitement s’est interrompu. Vérifiez l’état des QR avant de relancer.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Les QR Codes n’ont pas pu être émis.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="member-qr-batch">
    <p>Émettez les QR sélectionnés en une seule opération. Toute réémission invalide définitivement le lien précédent.</p>
    <label className="admin-form-checkbox"><input type="checkbox" checked={allSelected} disabled={busy} onChange={(event) => setSelected(event.target.checked ? members.map((member) => member.id) : [])} /> Tout sélectionner</label>
    {members.map((member) => <label className="admin-form-checkbox" key={member.id}>
      <input type="checkbox" checked={selected.includes(member.id)} disabled={busy} onChange={() => setSelected((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])} />
      <span>{member.full_name} <small>{member.member_number}{member.hasQr ? " · réémettre le QR actif" : " · aucun QR actif"}</small></span>
    </label>)}
    <button className="admin-submit" type="button" disabled={busy || !selected.length} onClick={() => void issueBatch()}>
      <QrCode size={16} aria-hidden="true" /> {busy ? `Émission en cours (${progress.completed}/${progress.total})…` : `Émettre les QR sélectionnés (${selected.length})`}
    </button>
    {busy && <div className="qr-batch-progress"><progress max={progress.total || selected.length} value={progress.completed} aria-label="Progression de l’émission des QR Codes" /><p role="status" aria-live="polite">{progress.completed} sur {progress.total || selected.length} QR traités.</p></div>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </div>;
}
