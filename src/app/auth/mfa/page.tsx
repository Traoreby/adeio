import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaChallengeForm } from "@/components/mfa-challenge-form";
import { getSignedInUser } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/redirect";

export const metadata: Metadata = { title: "Vérification de sécurité" };
type PageProps = { searchParams: Promise<{ next?: string }> };

export default async function MfaChallengePage({ searchParams }: PageProps) {
  const [{ supabase, user }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return <section className="auth-page"><div className="container auth-single"><div className="auth-card">Le service de connexion n’est pas configuré.</div></div></section>;
  if (!user) redirect("/connexion?next=%2Fespace-membre");
  const nextPath = safeRedirectPath(params.next ?? null, process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000", "/espace-membre");
  return <section className="auth-page"><div className="container auth-single"><MfaChallengeForm nextPath={nextPath} /></div></section>;
}
