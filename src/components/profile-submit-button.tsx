"use client";

import { useContext } from "react";
import { CalendarDays } from "lucide-react";
import { MemberProfilePendingContext } from "@/components/member-profile-pending-context";

export function ProfileSubmitButton({ reactivation }: { reactivation: boolean }) {
  const pending = useContext(MemberProfilePendingContext);
  return (
    <button className="admin-submit" type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? "Enregistrement…" : reactivation ? "Envoyer à l’administration pour validation" : "Enregistrer mon profil"}
      <CalendarDays size={15} aria-hidden="true" />
    </button>
  );
}
