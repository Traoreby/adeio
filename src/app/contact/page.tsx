import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Mail, MapPin, MessageCircle, Phone } from "lucide-react";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  const email = process.env.CONTACT_EMAIL;
  const phone = process.env.CONTACT_PHONE;
  const whatsapp = process.env.CONTACT_WHATSAPP;
  return <>
    <section className="page-hero"><div className="container"><div className="eyebrow eyebrow-green">RESTONS EN LIEN</div><h1>Contacter <span>ADEIO</span></h1><p>Une question sur l’association, ses activités ou cette plateforme ?</p></div></section>
    <section className="section-pad contact-section"><div className="container contact-layout"><div className="contact-card"><span className="contact-icon"><Mail size={22} /></span><div className="eyebrow eyebrow-green">NOUS ÉCRIRE</div><h2>Nous sommes à votre écoute.</h2><p>Les coordonnées officielles seront ajoutées dès leur confirmation par l’association.</p><div className="contact-methods">{email ? <a className="contact-email" href={`mailto:${email}`}><Mail size={15} />{email}<ArrowUpRight size={15} /></a> : <div className="contact-placeholder">E-mail provisoire — adresse officielle à remplacer.</div>}{phone ? <a className="contact-email" href={`tel:${phone}`}><Phone size={15} />{phone}</a> : <div className="contact-placeholder">Téléphone provisoire — numéro à renseigner.</div>}{whatsapp ? <a className="contact-email" href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`}><MessageCircle size={15} />WhatsApp : {whatsapp}<ArrowUpRight size={15} /></a> : <div className="contact-placeholder">WhatsApp provisoire — numéro à renseigner.</div>}</div></div><div className="contact-aside"><div className="contact-aside-icon"><MapPin size={19} /></div><div className="eyebrow">IMPLANTATION</div><h3>KIIT University</h3><p>Kalinga Institute of Industrial Technology, Bhubaneswar, Odisha, Inde.</p><Link className="text-link" href="/mentions-legales">Consulter les mentions légales <ArrowUpRight size={15} /></Link></div></div><div className="container contact-map-wrap"><h2>Nous rejoindre</h2><iframe className="contact-map" src="https://www.google.com/maps/embed?pb=!1m16!1m11!1m3!1d3!2d85.8161008990824!3d20.35554663562274!2m2!1f0!2f90!3m2!1i1024!2i768!4f75!3m3!1m2!1s0x3a19091813dab8d5%3A0xa033051ccddbbcbc!2sKalinga%20Institute%20of%20Industrial%20Technology!4v1795443897010" title="Localisation d'ADEIO à KIIT University" width="400" height="300" style={{ border: 0 }} allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" /></div></section>
  </>;
}
