"use client";

import { useFormStatus } from "react-dom";
import { CalendarDays } from "lucide-react";

export function ProfileSubmitButton({ reactivation }: { reactivation: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="admin-submit" type="submit" disabled={pending}>
      {pending ? "Enregistrement…" : reactivation ? "Envoyer à l’administration pour validation" : "Enregistrer mon profil"}
      <CalendarDays size={15} aria-hidden="true" />
    </button>
  );
}
