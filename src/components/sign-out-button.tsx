"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }
  return <button type="button" onClick={signOut} className="sign-out-button"><LogOut size={16} /> Se déconnecter</button>;
}
