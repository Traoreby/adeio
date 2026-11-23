import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Mail, MapPin, MessageCircle } from "lucide-react";

export function SiteFooter() {
  const contactEmail = process.env.CONTACT_EMAIL;
  const contactWhatsapp = process.env.CONTACT_WHATSAPP;
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <div className="footer-brand-block">
          <Link href="/" className="brand brand-light">
            <span className="brand-image"><Image src="/adeio-logo.jpeg" alt="Logo d’ADEIO, Association des Étudiants Ivoiriens de l’Odisha" width={52} height={52} unoptimized /></span>
            <span className="brand-copy"><strong>ADEIO</strong><small>Étudiants Ivoiriens de l’Odisha</small></span>
          </Link>
          <p>Une communauté d’étudiants ivoiriens réunie en Odisha.</p>
        </div>
        <div className="footer-links">
          <h3>Découvrir</h3>
          <Link href="/a-propos">À propos</Link>
          <Link href="/bureau">Bureau exécutif</Link>
          <Link href="/actualites">Actualités</Link>
        </div>
        <div className="footer-links">
          <h3>Informations</h3>
          <Link href="/contact">Contact</Link>
          <Link href="/mentions-legales">Mentions légales</Link>
          <Link href="/confidentialite">Confidentialité</Link>
        </div>
        <div className="footer-contact">
          <h3>Nous joindre</h3>
          <p><MapPin size={16} /> KIIT University, Bhubaneswar, Odisha, Inde</p>
          {contactEmail ? <a href={`mailto:${contactEmail}`}><Mail size={16} />{contactEmail}<ArrowUpRight size={14} /></a> : <span className="footer-placeholder"><Mail size={16} />E-mail provisoire — à remplacer</span>}
          {contactWhatsapp ? <a href={`https://wa.me/${contactWhatsapp.replace(/\D/g, "")}`}><MessageCircle size={16} />WhatsApp : {contactWhatsapp}<ArrowUpRight size={14} /></a> : <span className="footer-placeholder"><MessageCircle size={16} />WhatsApp provisoire — numéro à renseigner</span>}
        </div>
      </div>
      <div className="container footer-bottom"><span>© {new Date().getFullYear()} ADEIO</span><span>Un espace numérique au service de l’association</span></div>
    </footer>
  );
}
