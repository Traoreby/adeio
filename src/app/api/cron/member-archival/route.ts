import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest, secret: string) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(secret, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return expectedBytes.length > 0 && expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  if (!isAuthorized(request, secret)) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Connexion serveur Supabase indisponible." }, { status: 503 });
  const [{ data: archived, error: archiveError }, { data: termsUpdated, error: termError }, { data: plansUpdated, error: planError }] = await Promise.all([
    serviceClient.rpc("archive_expired_members"),
    serviceClient.rpc("expire_executive_terms"),
    serviceClient.rpc("expire_contribution_plans"),
  ]);
  if (archiveError || termError || planError) {
    return NextResponse.json({ error: "La synchronisation quotidienne des cycles ou des mandats a échoué." }, { status: 500 });
  }
  return NextResponse.json({ archived: archived ?? 0, executiveTermsUpdated: termsUpdated ?? 0, contributionPlansUpdated: plansUpdated ?? 0 }, { headers: { "cache-control": "no-store" } });
}
