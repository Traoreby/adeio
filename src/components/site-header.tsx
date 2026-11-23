"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SignOutButton } from "@/components/sign-out-button";

type HeaderSession = { id: string; displayName: string; email: string };

const links = [
  { href: "/", label: "Accueil" },
  { href: "/a-propos", label: "À propos" },
  { href: "/bureau", label: "Bureau exécutif" },
  { href: "/actualites", label: "Actualités" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader({ initialSession }: { initialSession: HeaderSession | null }) {
  const pathname = usePathname();
  const [session, setSession] = useState<HeaderSession | null>(initialSession);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const updateScrollState = () => setIsScrolled(window.scrollY > 6);
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, authSession) => {
      const user = authSession?.user;
      if (!user) {
        setSession(null);
        return;
      }
      const displayName = typeof user.user_metadata?.display_name === "string"
        ? user.user_metadata.display_name
        : user.email?.split("@")[0] ?? "";
      setSession({
        id: user.id,
        displayName,
        email: user.email ?? "",
      });
    });
    return () => subscription.unsubscribe();
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
          {session ? <div className="header-session"><Button asChild size="sm" variant="outline"><Link href="/espace-membre"><span className="header-avatar" aria-hidden="true">{session.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A"}</span>Mon espace <ArrowUpRight size={14} /></Link></Button><SignOutButton /></div> : <Button asChild size="sm" variant="outline"><Link href="/connexion">Espace membre <ArrowUpRight size={14} /></Link></Button>}
        </nav>
        <div className="mobile-nav">
          <button className="mobile-menu-toggle" type="button" aria-label={isMenuOpen ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={isMenuOpen} aria-controls="mobile-navigation" onClick={() => setIsMenuOpen((open) => !open)}>
            {isMenuOpen ? <X size={21} /> : <Menu size={22} />}
          </button>
          {isMenuOpen && <nav id="mobile-navigation" aria-label="Navigation mobile">
            {links.map((link) => <Link href={link.href} key={link.href} aria-current={isActive(link.href) ? "page" : undefined} onClick={() => setIsMenuOpen(false)}>{link.label}</Link>)}
            {session ? <><Link className="mobile-member-link" href="/espace-membre" onClick={() => setIsMenuOpen(false)}><span className="header-avatar" aria-hidden="true">{session.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A"}</span>Mon espace ({session.displayName}) <ArrowUpRight size={16} /></Link><SignOutButton /></> : <Link className="mobile-member-link" href="/connexion" onClick={() => setIsMenuOpen(false)}>Espace membre <ArrowUpRight size={16} /></Link>}
          </nav>
          }
        </div>
      </div>
    </header>
  );
}
