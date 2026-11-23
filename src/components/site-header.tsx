"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/", label: "Accueil" },
  { href: "/a-propos", label: "À propos" },
  { href: "/bureau", label: "Bureau exécutif" },
  { href: "/actualites", label: "Actualités" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const updateScrollState = () => setIsScrolled(window.scrollY > 6);
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);

  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className={`site-header${isScrolled ? " is-scrolled" : ""}`}>
      <div className="container header-inner">
        <Link className="brand" href="/" aria-label="ADEIO, accueil">
          <span className="brand-image"><Image src="/adeio-logo.jpeg" alt="Logo d’ADEIO, Association des Étudiants Ivoiriens de l’Odisha" width={56} height={56} priority unoptimized /></span>
          <span className="brand-copy"><strong>ADEIO</strong><small>Étudiants Ivoiriens de l’Odisha</small></span>
        </Link>
        <nav className="desktop-nav" aria-label="Navigation principale">
          {links.map((link) => <Link href={link.href} key={link.href} aria-current={isActive(link.href) ? "page" : undefined}>{link.label}</Link>)}
          <Button asChild size="sm" variant="outline"><Link href="/connexion">Espace membre <ArrowUpRight size={14} /></Link></Button>
        </nav>
        <div className="mobile-nav">
          <button className="mobile-menu-toggle" type="button" aria-label={isMenuOpen ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={isMenuOpen} aria-controls="mobile-navigation" onClick={() => setIsMenuOpen((open) => !open)}>
            {isMenuOpen ? <X size={21} /> : <Menu size={22} />}
          </button>
          {isMenuOpen && <nav id="mobile-navigation" aria-label="Navigation mobile">
            {links.map((link) => <Link href={link.href} key={link.href} aria-current={isActive(link.href) ? "page" : undefined} onClick={() => setIsMenuOpen(false)}>{link.label}</Link>)}
            <Link className="mobile-member-link" href="/connexion" onClick={() => setIsMenuOpen(false)}>Espace membre <ArrowUpRight size={16} /></Link>
          </nav>
          }
        </div>
      </div>
    </header>
  );
}
