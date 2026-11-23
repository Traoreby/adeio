import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConsentedMemberPhotoUrl } from "@/lib/supabase/service";

export type Announcement = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  image_url: string | null;
  is_pinned: boolean;
  published_at: string | null;
};

export type ExecutiveEntry = {
  id: string;
  name: string;
  position: string;
  biography: string | null;
  photoUrl: string | null;
};
type PublicExecutiveRow = {
  id: string;
  full_name: string;
  position: string;
  biography: string | null;
  photo_path: string | null;
};

export async function getPublishedAnnouncements(limit = 12, offset = 0): Promise<Announcement[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_visible_announcements", { p_limit: limit, p_offset: offset });

  if (error) return [];
  return (data ?? []) as Announcement[];
}

export async function getAnnouncementBySlug(slug: string): Promise<Announcement | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_visible_announcement_by_slug", { p_slug: slug });
  if (error || !data) return null;
  const article = Array.isArray(data) ? data[0] : null;
  return (article as Announcement | undefined) ?? null;
}

export async function getCurrentExecutive(): Promise<ExecutiveEntry[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_public_executive");
  if (error || !data) return [];
  const rows = data as PublicExecutiveRow[];
  return Promise.all(rows.map(async (row, index) => ({
    id: row.id ?? String(index),
    name: row.full_name,
    position: row.position,
    biography: row.biography,
    photoUrl: await getConsentedMemberPhotoUrl(row.photo_path),
  })));
}
