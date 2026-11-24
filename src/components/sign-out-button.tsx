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
  return <button type="button" onClick={signOut} className="sign-out-button" title="Se déconnecter" aria-label="Se déconnecter"><LogOut size={18} aria-hidden="true" /><span className="sign-out-label">Se déconnecter</span></button>;
}
