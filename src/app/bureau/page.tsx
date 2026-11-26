import type { Metadata } from "next";
import Image from "next/image";
import { ArrowUpRight, CalendarDays, UsersRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentExecutive } from "@/lib/content";

export const metadata: Metadata = { title: "Bureau exécutif" };

export default async function BureauPage() {
  const members = await getCurrentExecutive();
  return <>
    <section className="page-hero"><div className="container"><div className="eyebrow eyebrow-green">GOUVERNANCE</div><h1>Le bureau <span>exécutif</span></h1><p>Une équipe au service de l’association, de ses membres et de ses projets.</p></div></section>
    <section className="section-pad"><div className="container">
      <div className="term-banner"><div className="term-icon"><CalendarDays size={21} /></div><div><span>MANDAT EN COURS</span><strong>La composition officielle sera publiée après validation par ADEIO.</strong></div></div>
      {members.length ? <div className="people-grid">{members.map((person) => <Card className="person-card" key={person.id}><CardContent><div className="person-photo">{person.photoUrl ? <Image src={person.photoUrl} alt={person.name} fill sizes="(max-width: 760px) 100vw, (max-width: 1200px) 50vw, 400px" unoptimized /> : <UsersRound size={34} />}</div><div className="person-info"><span>{person.position}</span><h2>{person.name}</h2>{person.biography && <p>{person.biography}</p>}</div></CardContent></Card>)}</div> : <div className="empty-state"><span className="empty-state-icon"><UsersRound size={27} /></span><h2>La composition du bureau est en préparation</h2><p>Les noms et fonctions seront affichés sur cette page dès leur validation officielle.</p></div>}
      <div className="board-note"><ArrowUpRight size={16} /><span>Les archives des mandats précédents seront progressivement intégrées à la plateforme.</span></div>
    </div></section>
  </>;
}
