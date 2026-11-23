import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, CircleDollarSign, FileText, UsersRound } from "lucide-react";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Connexion membre" };

export default function LoginPage() {
  return <section className="auth-page"><div className="container auth-layout"><div className="auth-aside"><div className="auth-aside-top"><Link href="/" className="back-link"><ArrowLeft size={16} /> Retour au site</Link><Link href="/" className="auth-aside-brand" aria-label="Accueil ADEIO"><Image src="/adeio-logo.jpeg" alt="Emblème ADEIO" width={52} height={52} priority unoptimized /><span><strong>ADEIO</strong><small>Étudiants Ivoiriens de l’Odisha</small></span></Link></div><div className="auth-aside-content"><div className="eyebrow">LA VIE D’ADEIO, ENSEMBLE</div><h2>Votre espace<br /><span>vous attend.</span></h2><p>Retrouvez les informations et les services réservés aux membres.</p><ul className="auth-aside-features"><li><UsersRound size={19} aria-hidden="true" /><span>Annuaire des membres</span></li><li><CircleDollarSign size={19} aria-hidden="true" /><span>Finances de l’association</span></li><li><FileText size={19} aria-hidden="true" /><span>Documents officiels</span></li></ul></div><div className="auth-aside-bottom">KIIT University · Bhubaneswar, Odisha</div></div><div className="auth-main"><Suspense fallback={<div className="auth-card">Chargement…</div>}><AuthForm /></Suspense></div></div></section>;
}
