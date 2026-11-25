"use client";

import type { FormEvent } from "react";
import { anonymizeMemberAction, deleteMemberAction } from "@/app/admin/member-actions";

export function DeleteMemberForm({ memberId, memberName, memberNumber }: { memberId: string; memberName: string; memberNumber: string }) {
  const askToConfirm = (message: string) => (event: FormEvent<HTMLFormElement>) => {
    if (!window.confirm(message)) event.preventDefault();
  };
  return <div className="member-privacy-actions">
    <form action={anonymizeMemberAction} onSubmit={askToConfirm(`Anonymiser la fiche de ${memberName} ? Les écritures financières et les traces d’audit historiques seront conservées.`)}>
      <input type="hidden" name="member_id" value={memberId} />
      <button className="text-action" type="submit">Anonymiser la fiche</button>
    </form>
    <form action={deleteMemberAction} onSubmit={askToConfirm(`SUPPRESSION DÉFINITIVE\n\nCette action supprimera le compte de connexion, la fiche, les photos, QR Codes, historiques et données personnelles de ${memberName}. Les écritures financières réelles sont protégées et empêcheront l’opération.\n\nSaisissez aussi le numéro ${memberNumber} dans le formulaire suivant. Cette action est irréversible.`)}>
      <input type="hidden" name="member_id" value={memberId} />
      <label htmlFor="confirm_member_number">Pour autoriser la suppression, saisissez le numéro ADEIO exact : <strong>{memberNumber}</strong></label>
      <input id="confirm_member_number" name="confirm_member_number" required autoComplete="off" pattern="ADEIO-[0-9]{4}-[A-Z0-9]{4}" aria-describedby="permanent-delete-help" />
      <small id="permanent-delete-help">Réservé au Super Admin. Le compte Auth, les données du membre et ses photos de stockage seront également supprimés. Toute référence financière réelle bloque l’opération.</small>
      <button className="text-action danger-action" type="submit">Supprimer définitivement le membre et ses données</button>
    </form>
  </div>;
}
