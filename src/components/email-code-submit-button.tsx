"use client";

import { useFormStatus } from "react-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmailCodeSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" className="form-submit" size="lg" disabled={pending}>
    {pending ? "Vérification…" : label}<ArrowRight size={17} aria-hidden="true" />
  </Button>;
}
