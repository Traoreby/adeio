"use client";

import { useState } from "react";
import { Download } from "lucide-react";

export function MemberCardBatchForm({ members }: { members: { id: string; full_name: string; member_number: string }[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const allSelected = members.length > 0 && selected.length === members.length;
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }

  async function downloadCards() {
    setBusy(true); setMessage("");
    try {
      const issuanceResponse = await fetch("/api/admin/member-card-issuances", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberIds: selected }) });
      const issuanceBody = await issuanceResponse.json().catch(() => null);
      if (!issuanceResponse.ok || !Array.isArray(issuanceBody?.issuanceIds)) throw new Error(issuanceBody?.error ?? "La délivrance des cartes n’a pas abouti.");
      const response = await fetch("/api/admin/member-cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issuanceIds: issuanceBody.issuanceIds }) });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error ?? "Les cartes n’ont pas pu être générées."); }
      const photoWarnings = Number(response.headers.get("x-adeio-photo-warning") ?? 0);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "cartes-membres-adeio.pdf"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setMessage(`${selected.length} carte(s) délivrée(s) et PDF préparé(s). Les QR actifs ont été réutilisés sans être renouvelés. Un nouveau téléchargement réutilisera les cartes délivrées.${photoWarnings ? ` ${photoWarnings} photo(s) n’ont pas pu être chargées ; un avatar de remplacement est imprimé.` : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Une erreur est survenue."); }
    finally { setBusy(false); }
  }

  return <div className="member-card-batch"><label className="admin-form-checkbox"><input type="checkbox" checked={allSelected} disabled={busy} onChange={(event) => setSelected(event.target.checked ? members.map((member) => member.id) : [])} /> Tout sélectionner</label>{members.map((member) => <label className="admin-form-checkbox" key={member.id}><input type="checkbox" checked={selected.includes(member.id)} disabled={busy} onChange={() => toggle(member.id)} /><span>{member.full_name} <small>{member.member_number}</small></span></label>)}<button className="admin-submit" type="button" disabled={!selected.length || busy} onClick={() => void downloadCards()}>{busy ? "Délivrance et préparation du PDF…" : <>Délivrer et télécharger ({selected.length}) <Download size={15} /></>}</button>{busy && <p role="status" aria-live="polite">Vérification des validations, dates, QR et éléments officiels…</p>}{message && <p role="status" aria-live="polite">{message}</p>}</div>;
}
