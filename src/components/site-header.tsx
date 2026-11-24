"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SignOutButton } from "@/components/sign-out-button";

type HeaderSession = { id: string; displayName: string; email: string; isAdmin: boolean; rolesReady: boolean };

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
  const activeUserId = useRef(initialSession?.id ?? null);
  const roleRequestId = useRef(0);

  useEffect(() => {
    const updateScrollState = () => setIsScrolled(window.scrollY > 6);
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, authSession) => {
      const user = authSession?.user;
      if (!user) {
        activeUserId.current = null;
        roleRequestId.current += 1;
        setSession(null);
        return;
      }
      const displayName = typeof user.user_metadata?.display_name === "string"
        ? user.user_metadata.display_name
        : user.email?.split("@")[0] ?? "";
      const sameUser = activeUserId.current === user.id;
      activeUserId.current = user.id;
      setSession((current) => current?.id === user.id
        ? { ...current, displayName, email: user.email ?? "" }
        : { id: user.id, displayName, email: user.email ?? "", isAdmin: false, rolesReady: false });

      // Query roles outside Supabase's auth callback to avoid holding its auth lock.
      if (!sameUser || event === "SIGNED_IN") {
        const requestId = ++roleRequestId.current;
        void Promise.resolve().then(async () => {
          const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
          if (!active || error || requestId !== roleRequestId.current || activeUserId.current !== user.id) return;
          const isAdmin = (data ?? []).some((item) => item.role === "admin" || item.role === "super_admin");
          setSession((current) => current?.id === user.id ? { ...current, isAdmin, rolesReady: true } : current);
        });
      }
    });
    return () => {
      active = false;
      roleRequestId.current += 1;
      subscription.unsubscribe();
    };
  }, []);

  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const workspaceHref = session?.isAdmin ? "/admin" : "/espace-membre";
  const workspaceLabel = session?.isAdmin ? "Administration" : "Mon espace";

  return (
    <header className={`site-header${isScrolled ? " is-scrolled" : ""}`}>
      <div className="container header-inner">
        <Link className="brand" href="/" aria-label="ADEIO, accueil">
          <span className="brand-image"><Image src="/adeio-logo.jpeg" alt="Logo d’ADEIO, Association des Étudiants Ivoiriens de l’Odisha" width={56} height={56} priority unoptimized /></span>
          <span className="brand-copy"><strong>ADEIO</strong><small>Étudiants Ivoiriens de l’Odisha</small></span>
        </Link>
        <nav className="desktop-nav" aria-label="Navigation principale">
          {links.map((link) => <Link href={link.href} prefetch="auto" key={link.href} aria-current={isActive(link.href) ? "page" : undefined}>{link.label}</Link>)}
          {session ? session.rolesReady ? <div className="header-session"><Button asChild size="sm" variant="outline"><Link href={workspaceHref} prefetch="auto"><span className="header-avatar" aria-hidden="true">{session.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A"}</span>{workspaceLabel} <ArrowUpRight size={14} /></Link></Button><SignOutButton /></div> : <span className="header-session-pending" role="status">Chargement de votre espace…</span> : <Button asChild size="sm" variant="outline"><Link href="/connexion" prefetch="auto">Espace membre <ArrowUpRight size={14} /></Link></Button>}
        </nav>
        <div className="mobile-nav">
          <button className="mobile-menu-toggle" type="button" aria-label={isMenuOpen ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={isMenuOpen} aria-controls="mobile-navigation" onClick={() => setIsMenuOpen((open) => !open)}>
            {isMenuOpen ? <X size={21} /> : <Menu size={22} />}
          </button>
          {isMenuOpen && <nav id="mobile-navigation" aria-label="Navigation mobile">
            {links.map((link) => <Link href={link.href} prefetch="auto" key={link.href} aria-current={isActive(link.href) ? "page" : undefined} onClick={() => setIsMenuOpen(false)}>{link.label}</Link>)}
            {session ? session.rolesReady ? <><Link className="mobile-member-link" href={workspaceHref} prefetch="auto" onClick={() => setIsMenuOpen(false)}><span className="header-avatar" aria-hidden="true">{session.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A"}</span>{workspaceLabel} ({session.displayName}) <ArrowUpRight size={16} /></Link><SignOutButton /></> : <span className="header-session-pending" role="status">Chargement de votre espace…</span> : <Link className="mobile-member-link" href="/connexion" prefetch="auto" onClick={() => setIsMenuOpen(false)}>Espace membre <ArrowUpRight size={16} /></Link>}
          </nav>
          }
        </div>
      </div>
    </header>
  );
}
