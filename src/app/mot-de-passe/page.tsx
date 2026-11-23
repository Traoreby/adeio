import type { Metadata } from "next";
import { PasswordUpdateForm } from "@/components/password-update-form";

export const metadata: Metadata = { title: "Changer le mot de passe" };

export default function PasswordPage() {
  return <section className="auth-page"><div className="container auth-single"><PasswordUpdateForm /></div></section>;
}
