"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive, Banknote, ContactRound, LayoutDashboard, Landmark, LockKeyhole,
  Newspaper, QrCode, ScrollText, Settings2, ShieldCheck, UsersRound,
} from "lucide-react";
import type { AppRole } from "@/lib/auth";

const adminItems = [
  { href: "/admin", label: "Vue d’ensemble", icon: LayoutDashboard },
  { href: "/admin/membres", label: "Membres", icon: ContactRound },
  { href: "/admin/archives", label: "Archives", icon: Archive },
  { href: "/admin/qr-codes", label: "QR Codes et cartes", icon: QrCode },
  { href: "/admin/annonces", label: "Annonces", icon: Newspaper },
  { href: "/admin/bureau", label: "Bureau exécutif", icon: UsersRound },
  { href: "/gestion-financiere", label: "Trésorerie", icon: Banknote, financeOnly: true },
  { href: "/securite", label: "Sécurité du compte", icon: LockKeyhole },
  { href: "/admin/utilisateurs", label: "Utilisateurs et rôles", icon: ShieldCheck, superOnly: true },
  { href: "/admin/audit", label: "Journal d’audit", icon: ScrollText, superOnly: true },
];

const financeItems = [
  { href: "/gestion-financiere", label: "Vue financière", icon: Landmark },
  { href: "/gestion-financiere/operations", label: "Opérations", icon: ScrollText },
  { href: "/gestion-financiere/cotisations", label: "Cotisations et arriérés", icon: Banknote },
  { href: "/gestion-financiere/bilans", label: "Bilans financiers", icon: Newspaper },
];

export function ActiveSidebarNav({ kind, roles }: { kind: "admin" | "finance"; roles: AppRole[] }) {
  const pathname = usePathname();
  const items = kind === "finance"
    ? financeItems
    : adminItems.filter((item) => (!item.superOnly || roles.includes("super_admin")) && (!item.financeOnly || roles.some((role) => ["treasurer", "auditor", "super_admin"].includes(role))));
  const visibleItems = kind === "admin" && roles.includes("super_admin")
    ? [...items, { href: "/admin/parametres", label: "Paramètres", icon: Settings2 }]
    : items;

  return <nav className="admin-nav" aria-label={kind === "finance" ? "Navigation financière" : "Navigation administration"}>
    {visibleItems.map(({ href, label, icon: Icon }) => {
      const exactOnly = href === "/admin" || href === "/gestion-financiere";
      const active = pathname === href || (!exactOnly && pathname.startsWith(`${href}/`));
      return <Link href={href} prefetch="auto" key={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
        <Icon size={18} aria-hidden="true" /><span>{label}</span>
      </Link>;
    })}
  </nav>;
}
