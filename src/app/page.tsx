import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BookOpenText, CheckCircle2, CircleDollarSign, Fingerprint, ShieldCheck, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentExecutive, getPublishedAnnouncements } from "@/lib/content";
import { formatDate } from "@/lib/utils";
import { OptionalBackground } from "@/components/optional-background";

const pillars = [
  { icon: BookOpenText, label: "Notre mémoire", title: "Une histoire qui se transmet", text: "Les membres, les mandats et les temps forts de l’association réunis dans un espace de référence." },
  { icon: Fingerprint, label: "Nos membres", title: "Une identité simple à vérifier", text: "Un espace membre et, à terme, une carte sécurisée pour faciliter l’identification au sein du réseau." },
  { icon: CircleDollarSign, label: "Notre gestion", title: "Une vie associative lisible", text: "Des informations et des documents accessibles aux personnes concernées, dans un cadre clair." },
];

function canDisplayAnnouncementImage(source: string) {
  if (source.startsWith("/") && !source.startsWith("//")) return true;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;
  try {
    return new URL(source).origin === new URL(supabaseUrl).origin;
  } catch {
    return false;
  }
}

export default async function HomePage() {
  const [announcements, executive] = await Promise.all([getPublishedAnnouncements(3), getCurrentExecutive()]);
  return (
    <>
      <section className="hero-section">
        <OptionalBackground asset="hero-bg" className="hero-background" priority sizes="100vw" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow hero-step hero-step-1"><span className="eyebrow-dot" /> ASSOCIATION DES ÉTUDIANTS IVOIRIENS DE L’ODISHA · KIIT, BHUBANESWAR</div>
            <h1 className="hero-step hero-step-2">Un réseau uni.<br /><span>Une mémoire vivante.</span></h1>
            <p className="hero-lead hero-step hero-step-3">ADEIO rassemble ses membres autour d’une association active, organisée et tournée vers l’avenir.</p>
            <div className="hero-actions hero-step hero-step-4">
              <Button asChild size="lg"><Link href="/a-propos">Découvrir ADEIO <ArrowRight size={17} /></Link></Button>
              <Button asChild variant="outline" size="lg"><Link href="/bureau">Rencontrer le bureau</Link></Button>
            </div>
            <div className="hero-assurance hero-step hero-step-5"><span className="assurance-icon"><ShieldCheck size={17} /></span><span>Un espace numérique conçu pour mieux représenter et gérer l’association.</span></div>
          </div>
          <div className="hero-visual-wrap hero-step hero-step-6">
            <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
            <div className="hero-logo-card">
                <div className="hero-logo-surface">
                  <Image src="/adeio-logo.jpeg" alt="Emblème d’ADEIO, Association des Étudiants Ivoiriens de l’Odisha" width={480} height={480} priority unoptimized className="hero-logo" />
                </div>
            </div>
            <div className="hero-visual-meta">
              <div className="hero-logo-caption"><span className="caption-dot" /> <span>Ensemble, faisons vivre ADEIO</span></div>
              <div className="floating-note"><span className="note-icon"><UsersRound size={18} /></span><span><strong>Une communauté</strong><small>Unie par un engagement commun</small></span></div>
            </div>
          </div>
        </div>
        <div className="container hero-bottom"><span>01 — Une association, une histoire, un avenir</span><span className="hero-bottom-line" /><span>Défiler pour découvrir</span></div>
      </section>

      <section className="intro-section section-pad" data-reveal>
        <div className="container intro-grid">
          <div><div className="eyebrow eyebrow-green">NOTRE ENGAGEMENT</div><h2>Faire vivre le lien,<br /><span>aujourd’hui et demain.</span></h2></div>
          <div className="intro-text"><p>Le site officiel d’ADEIO a pour vocation de présenter l’association, de conserver ses repères et de faciliter la circulation des informations utiles à ses membres.</p><Link className="text-link" href="/a-propos">En savoir plus sur notre démarche <ArrowRight size={16} /></Link></div>
        </div>
        <div className="container pillars-grid">
          {pillars.map(({ icon: Icon, label, title, text }, index) => (
            <Card className="pillar-card" key={title} data-reveal style={{ transitionDelay: `${index * 85}ms` }}><CardContent>
              <div className="pillar-top"><span className="pillar-icon"><Icon size={21} /></span><span className="pillar-index">0{index + 1}</span></div>
              <div className="eyebrow eyebrow-green">{label}</div><h3>{title}</h3><p>{text}</p>
            </CardContent></Card>
          ))}
        </div>
      </section>

      <section className={`board-section section-pad${executive.length ? "" : " board-section-empty"}`} data-reveal>
        <OptionalBackground asset="about-bg" className="board-background" sizes="(max-width: 760px) 100vw, 58vw" />
        <div className="container section-heading-row">
          <div><div className="eyebrow">GOUVERNANCE</div><h2>Le bureau exécutif</h2><p>Les personnes qui représentent l’association et font avancer ses projets.</p></div>
          <Button asChild variant="outline"><Link href="/bureau">Voir la composition <ArrowRight size={16} /></Link></Button>
        </div>
        <div className="container board-preview-grid">
          {executive.length ? executive.slice(0, 3).map((person) => (
            <Card className="person-card" key={person.id} data-reveal><CardContent>
              <div className="person-photo">{person.photoUrl ? <Image src={person.photoUrl} alt={person.name} fill sizes="(max-width: 760px) 100vw, (max-width: 1200px) 50vw, 400px" unoptimized /> : <UsersRound size={34} />}</div>
              <div className="person-info"><span>{person.position}</span><h3>{person.name}</h3></div>
            </CardContent></Card>
          )) : <div className="empty-board"><div className="empty-board-icon"><UsersRound size={24} /></div><div><div className="eyebrow eyebrow-green">GOUVERNANCE ADEIO</div><strong>Le bureau exécutif sera présenté ici</strong><p>Cette rubrique affichera les responsables et leurs fonctions après l’enregistrement du mandat officiel.</p></div><Link href="/bureau" className="empty-board-link">Découvrir la rubrique <ArrowRight size={16} /></Link></div>}
        </div>
      </section>

      <section className={`news-section section-pad${announcements.length ? "" : " news-section-empty"}`} data-reveal>
        <div className="container section-heading-row">
          <div><div className="eyebrow eyebrow-green">À LA UNE</div><h2>Les nouvelles d’ADEIO</h2><p>Les annonces et temps forts de la vie associative.</p></div>
          <Button asChild variant="outline"><Link href="/actualites">Toutes les actualités <ArrowRight size={16} /></Link></Button>
        </div>
        <div className="container news-grid">
          {announcements.length ? announcements.map((item) => (
            <Link href={`/actualites/${item.slug}`} className="news-card" key={item.id} data-reveal>
              <div className="news-card-top"><span className="news-category">ADEIO</span>{item.is_pinned && <span className="news-pinned">À la une</span>}</div>
              {item.image_url && canDisplayAnnouncementImage(item.image_url) && <div className="news-card-image"><Image src={item.image_url} alt="" fill sizes="(max-width: 760px) 100vw, (max-width: 980px) 50vw, 360px" /></div>}
              <div><time>{formatDate(item.published_at)}</time><h3>{item.title}</h3><p>{item.summary || item.body.slice(0, 150)}</p></div>
              <span className="text-link">Lire l’annonce <ArrowRight size={15} /></span>
            </Link>
          )) : <div className="empty-news"><div className="empty-news-icon"><CheckCircle2 size={22} /></div><div><div className="eyebrow eyebrow-green">ACTUALITÉS ADEIO</div><strong>Aucune annonce publiée pour le moment</strong><p>Les informations validées par l’association apparaîtront ici dès leur publication.</p></div><Link href="/contact" className="empty-news-link">Contacter ADEIO <ArrowRight size={16} /></Link></div>}
        </div>
      </section>

      <section className="member-cta-section" data-reveal>
        <div className="container member-cta">
          <OptionalBackground asset="cta-bg" className="cta-background" sizes="(max-width: 760px) 100vw, 1180px" />
          <div className="cta-symbol"><UsersRound size={26} /></div>
          <div><div className="eyebrow">ESPACE MEMBRE</div><h2>Retrouvons-nous au même endroit.</h2><p>Accédez à votre espace personnel et aux informations réservées aux membres.</p></div>
          <Button asChild variant="orange" size="lg"><Link href="/connexion">Accéder à mon espace <ArrowRight size={17} /></Link></Button>
        </div>
      </section>
    </>
  );
}
