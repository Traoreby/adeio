"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function FinanceSubmitButton({ children, pendingLabel, secondary = false }: { children: ReactNode; pendingLabel: string; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={`admin-submit${secondary ? " admin-submit-secondary" : ""}`} disabled={pending} aria-live="polite">
    {pending ? pendingLabel : children}
  </button>;
}
