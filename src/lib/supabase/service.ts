import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function validMemberPhotoPath(path: string | null | undefined): path is string {
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === ".")) return false;
  return true;
}

export async function getMemberPhotoUrl(path: string | null | undefined) {
  if (!validMemberPhotoPath(path)) return null;
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) return null;
  const { data, error } = await serviceClient.storage.from("member-photos").createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}

export async function getMemberPhotoUrls(paths: (string | null | undefined)[]) {
  const uniquePaths = [...new Set(paths.filter(validMemberPhotoPath))];
  if (!uniquePaths.length) return new Map<string, string>();
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) return new Map<string, string>();
  const { data, error } = await serviceClient.storage.from("member-photos").createSignedUrls(uniquePaths, 3600);
  if (error || !data) return new Map<string, string>();
  return new Map(data.flatMap((item) => item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : []));
}

/** Private signed URL helper. Only use after server-side member/admin authorization. */
export const getConsentedMemberPhotoUrl = getMemberPhotoUrl;
