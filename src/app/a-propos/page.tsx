import type { Metadata } from "next";
import Image from "next/image";
import { BookOpenText, Handshake, Landmark, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { OptionalBackground } from "@/components/optional-background";

export const metadata: Metadata = { title: "À propos" };

const commitments = [
  { icon: Handshake, title: "Rassembler", text: "Faire vivre les liens entre les membres et encourager la participation à la vie associative." },
  { icon: BookOpenText, title: "Transmettre", text: "Conserver les repères, les archives et les documents qui racontent le parcours d’ADEIO." },
  { icon: Landmark, title: "Représenter", text: "Mettre à disposition un espace officiel, lisible et utile pour les membres et les partenaires." },
];

export default function AboutPage() {
  return <>
    <section className="page-hero"><div className="container"><div className="eyebrow eyebrow-green">QUI SOMMES-NOUS ?</div><h1>À propos de <span>ADEIO</span></h1><p>Un espace commun pour présenter l’association, préserver sa mémoire et accompagner son organisation.</p></div></section>
    <section className="about-story-section section-pad"><OptionalBackground asset="about-bg" className="about-background" sizes="(max-width: 760px) 100vw, 42vw" /><div className="container about-content-grid"><div className="about-identity-card" data-reveal><div className="about-identity-inner"><span className="about-tricolor" aria-hidden="true" /><Image className="about-identity-logo" src="/adeio-logo.jpeg" alt="Emblème d’ADEIO, Association des Étudiants Ivoiriens de l’Odisha" width={200} height={200} unoptimized /><strong>Association des Étudiants<br />Ivoiriens de l’Odisha</strong><span className="about-identity-location"><MapPin size={14} aria-hidden="true" />KIIT University · Bhubaneswar, Inde</span></div></div><div className="about-copy"><div className="eyebrow">NOTRE RAISON D’ÊTRE</div><h2>Une présence commune,<br /><span>une dynamique collective.</span></h2><p>ADEIO réunit les étudiants ivoiriens de l’Odisha autour de l’entraide, de la solidarité et de l’attachement à leur pays, loin de chez eux.</p><p>Cette plateforme centralise la vie de l’association : membres, bureau exécutif, actualités et gestion transparente, au service de toute la communauté.</p></div></div></section>
    <section className="values-section section-pad"><div className="container"><div className="eyebrow eyebrow-green">NOS PRIORITÉS</div><h2>Une association qui avance<br />avec des repères clairs.</h2><div className="pillars-grid values-grid">{commitments.map(({ icon: Icon, title, text }) => <Card className="pillar-card" key={title}><CardContent><span className="pillar-icon"><Icon size={21} /></span><h3>{title}</h3><p>{text}</p></CardContent></Card>)}</div></div></section>
  </>;
}

