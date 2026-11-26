import type { Metadata } from "next";
import { Suspense } from "react";
import { EmailCodeForm } from "@/components/email-code-form";

export const metadata: Metadata = { title: "Activation du compte · ADEIO", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ flow?: string; erreur?: string }> };

export default async function ActivateAccountPage({ searchParams }: Props) {
  const params = await searchParams;
  const flow = params.flow === "recovery" ? "recovery" : params.flow === "signup" ? "signup" : "invitation";
  return <section className="auth-page"><div className="container auth-single"><Suspense fallback={<div className="auth-card">Chargement…</div>}><EmailCodeForm flow={flow} error={params.erreur} /></Suspense></div></section>;
}
