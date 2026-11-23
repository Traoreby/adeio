import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const passwordSchema = z.object({ password: z.string().min(10).max(128) });

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    return NextResponse.json({ error: "Origine de requête invalide." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Format de requête invalide." }, { status: 415 });
  }
  const payload = await request.json().catch(() => null);
  const parsed = passwordSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Mot de passe invalide." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Service non configuré." }, { status: 503 });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Session expirée. Reconnectez-vous." }, { status: 401 });

  const { error: passwordError } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (passwordError) return NextResponse.json({ error: "Le mot de passe n’a pas pu être modifié." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Clé serveur Supabase manquante." }, { status: 503 });
  const serviceClient = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: profileError } = await serviceClient.from("profiles").update({ must_change_password: false }).eq("user_id", user.id);
  if (profileError) return NextResponse.json({ error: "Mot de passe modifié. La finalisation du compte est temporairement indisponible ; réessayez." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
