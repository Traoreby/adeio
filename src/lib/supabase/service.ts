import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function getConsentedMemberPhotoUrl(path: string | null | undefined) {
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === ".")) return null;
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) return null;
  const { data, error } = await serviceClient.storage.from("member-photos").createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}
