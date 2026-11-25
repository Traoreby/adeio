"use client";

import { useState } from "react";
import { changeAuthEmailAction } from "@/app/admin/actions";

export function AdminEmailChange({ userId, currentEmail }: { userId: string; currentEmail: string }) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  return <div className="admin-email-change">
    <button type="button" className="text-action" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? "Fermer le changement d’adresse" : "Changer l’adresse e-mail"}
    </button>
    {open && <form action={changeAuthEmailAction} className="user-email-change-form">
      <input type="hidden" name="user_id" value={userId} />
      <div className="email-change-current"><span>Adresse actuelle</span><strong title={currentEmail}>{currentEmail}</strong></div>
      <label htmlFor={`new-email-${userId}`}>Nouvelle adresse à confirmer</label>
      <input id={`new-email-${userId}`} type="email" name="new_email" required maxLength={254} autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="nouvelle-adresse@exemple.com" />
      <div className="email-change-preview"><span>Adresse demandée</span><strong title={newEmail || "Aucune adresse saisie"}>{newEmail || "Saisissez la nouvelle adresse ci-dessus"}</strong></div>
      <button className="admin-submit" type="submit" disabled={!newEmail.trim()}>Envoyer la demande de confirmation</button>
    </form>}
  </div>;
}
