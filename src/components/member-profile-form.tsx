"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveOwnMemberProfileAction, type MemberProfileActionResult } from "@/app/espace-membre/profil/actions";
import { MemberProfilePendingContext } from "@/components/member-profile-pending-context";

export function MemberProfileForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<MemberProfileActionResult>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    setResult({});
    startTransition(async () => {
      try {
        const nextResult = await saveOwnMemberProfileAction({}, formData);
        setResult(nextResult);
        if (nextResult.redirectTo) router.replace(nextResult.redirectTo);
      } catch {
        setResult({ error: "Une erreur inattendue a interrompu l’enregistrement. Vos champs restent présents : réessayez." });
      }
    });
  }

  return <form onSubmit={submit} className="admin-card member-profile-edit-form" aria-busy={pending}>
    {result.error && <div role="alert" className="form-alert error-alert">{result.error}</div>}
    {result.success && <div role="status" className="form-alert success-alert">{result.success}</div>}
    <MemberProfilePendingContext.Provider value={pending}>{children}</MemberProfilePendingContext.Provider>
  </form>;
}
