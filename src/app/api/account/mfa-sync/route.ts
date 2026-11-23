import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) return NextResponse.json({ error: "Origine de requête invalide." }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Service non configuré." }, { status: 503 });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Session expirée." }, { status: 401 });
  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) return NextResponse.json({ error: "Impossible de vérifier le facteur." }, { status: 400 });
  const enabled = (factors?.totp ?? []).some((factor) => factor.status === "verified");
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Clé serveur Supabase manquante." }, { status: 503 });
  const { error } = await serviceClient.from("profiles").update({ mfa_enabled: enabled }).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "La synchronisation du compte a échoué." }, { status: 503 });
  return NextResponse.json({ ok: true, enabled });
}
