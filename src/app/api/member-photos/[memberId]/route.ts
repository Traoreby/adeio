import { NextResponse } from "next/server";
import { z } from "zod";
import { getSignedInUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const memberIdSchema = z.string().uuid();

export async function GET(_request: Request, context: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await context.params;
  if (!memberIdSchema.safeParse(memberId).success) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) return new NextResponse(null, { status: 401, headers: { "Cache-Control": "no-store" } });

  const { data: member } = await supabase
    .from("members")
    .select("id,user_id,status,photo_path,photo_public_consent")
    .eq("id", memberId)
    .maybeSingle();
  if (!member?.photo_path) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

  const isAdministrator = roles.some((role) => role === "admin" || role === "super_admin");
  const isOwner = member.user_id === user.id;
  if (!isAdministrator && !isOwner) {
    if (!roles.includes("member") || member.status !== "active" || !member.photo_public_consent) {
      return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const { data: isCurrentMember, error: membershipError } = await supabase.rpc("is_current_member");
    if (membershipError || !isCurrentMember) {
      return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
  }

  const photoPath = member.photo_path;
  const expectedPath = new RegExp(`^${memberId}/[0-9a-f-]{36}\\.(webp|jpg)$`, "i");
  if (!expectedPath.test(photoPath)) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) return new NextResponse(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  const { data: file, error } = await serviceClient.storage.from("member-photos").download(photoPath);
  if (error || !file) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

  const contentType = photoPath.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new NextResponse(await file.arrayBuffer(), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(file.size),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store, max-age=0",
      "Vary": "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
