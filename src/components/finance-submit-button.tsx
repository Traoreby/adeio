"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function FinanceSubmitButton({ children, pendingLabel, secondary = false, formAction }: { children: ReactNode; pendingLabel: string; secondary?: boolean; formAction?: (formData: FormData) => void | Promise<void> }) {
  const { pending } = useFormStatus();
  return <button type="submit" formAction={formAction} className={`admin-submit${secondary ? " admin-submit-secondary" : ""}`} disabled={pending} aria-live="polite">
    {pending ? pendingLabel : children}
  </button>;
}
