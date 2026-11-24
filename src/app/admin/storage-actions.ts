"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSignedInUser, hasRequiredMfa } from "@/lib/auth";

export async function deleteStorageOrphanAction(formData: FormData) {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase || !user) redirect("/connexion?next=/admin");
  if (!roles.includes("super_admin")) redirect("/espace-membre?erreur=acces-refuse");
  if (!await hasRequiredMfa(supabase, user.id)) redirect("/auth/mfa?next=%2Fadmin");
  const parsed = z.object({
    bucket: z.enum(["member-photos", "financial-attachments", "financial-reports"]),
    name: z.string().min(3).max(1024).refine((name) => !name.startsWith("/") && !name.split("/").includes("..")),
  }).safeParse({ bucket: formData.get("bucket"), name: formData.get("name") });
  if (!parsed.success) redirect("/admin?stockage=erreur");
  const { bucket, name } = parsed.data;
  const { data: orphan, error: checkError } = await supabase.rpc("is_adeio_storage_orphan", { p_bucket_id: bucket, p_name: name });
  if (checkError || orphan !== true) redirect("/admin?stockage=plus-orphelin");
  const { error } = await supabase.storage.from(bucket).remove([name]);
  if (error) redirect("/admin?stockage=suppression-impossible");
  revalidatePath("/admin");
  redirect("/admin?stockage=nettoye");
}
