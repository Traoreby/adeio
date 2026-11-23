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
      const response = await fetch("/api/admin/member-cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberIds: selected }) });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error ?? "Les cartes n’ont pas pu être générées."); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "cartes-membres-adeio.pdf"; anchor.click(); URL.revokeObjectURL(url);
      setMessage(`${selected.length} carte(s) générée(s). Les anciens QR associés ont été désactivés.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Une erreur est survenue."); }
    finally { setBusy(false); }
  }

  return <div className="member-card-batch"><label className="admin-form-checkbox"><input type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? members.map((member) => member.id) : [])} /> Tout sélectionner</label>{members.map((member) => <label className="admin-form-checkbox" key={member.id}><input type="checkbox" checked={selected.includes(member.id)} onChange={() => toggle(member.id)} /><span>{member.full_name} <small>{member.member_number}</small></span></label>)}<button className="admin-submit" type="button" disabled={!selected.length || busy} onClick={() => void downloadCards()}>{busy ? "Création du PDF…" : <>Générer les cartes PDF ({selected.length}) <Download size={15} /></>}</button>{message && <p role="status">{message}</p>}</div>;
}
