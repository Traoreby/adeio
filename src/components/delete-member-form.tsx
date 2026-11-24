"use client";

import { useState, type FormEvent } from "react";
import { anonymizeMemberAction, deleteMemberAction } from "@/app/admin/member-actions";

export function DeleteMemberForm({ memberId, memberName }: { memberId: string; memberName: string }) {
  const [confirmed, setConfirmed] = useState(false);
  const askToConfirm = (message: string) => (event: FormEvent<HTMLFormElement>) => {
    if (!confirmed && !window.confirm(message)) { event.preventDefault(); return; }
    setConfirmed(true);
  };
  return <div className="member-privacy-actions">
    <form action={anonymizeMemberAction} onSubmit={askToConfirm(`Anonymiser la fiche de ${memberName} ? Les écritures financières et les traces d’audit historiques seront conservées.`)}>
      <input type="hidden" name="member_id" value={memberId} />
      <button className="text-action" type="submit">Anonymiser la fiche</button>
    </form>
    <form action={deleteMemberAction} onSubmit={askToConfirm(`Supprimer définitivement la fiche de ${memberName} ? Les opérations financières liées empêchent cette suppression.`)}>
      <input type="hidden" name="member_id" value={memberId} />
      <button className="text-action danger-action" type="submit">Supprimer la fiche membre</button>
    </form>
  </div>;
}
