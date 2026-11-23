import Link from "next/link";
import { LayoutDashboard, Newspaper, UsersRound, ShieldCheck, Settings2, LockKeyhole, Archive, QrCode, ContactRound } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import type { AppRole } from "@/lib/auth";

const navigation = [
  { href: "/admin", label: "Vue d’ensemble", icon: LayoutDashboard },
  { href: "/admin/membres", label: "Membres", icon: ContactRound },
  { href: "/admin/archives", label: "Archives", icon: Archive },
  { href: "/admin/qr-codes", label: "QR Codes et cartes", icon: QrCode },
  { href: "/admin/annonces", label: "Annonces", icon: Newspaper },
  { href: "/admin/bureau", label: "Bureau exécutif", icon: UsersRound },
  { href: "/securite", label: "Sécurité du compte", icon: LockKeyhole },
  { href: "/admin/utilisateurs", label: "Utilisateurs et rôles", icon: ShieldCheck, superOnly: true },
];

export function AdminShell({ children, email, roles }: { children: React.ReactNode; email: string; roles: AppRole[] }) {
  return <section className="admin-wrap"><div className="container admin-shell">
    <aside className="admin-sidebar"><div className="admin-sidebar-title"><span>ESPACE ADMINISTRATION</span><strong>ADEIO</strong></div><nav className="admin-nav" aria-label="Navigation administration">{navigation.filter((item) => !item.superOnly || roles.includes("super_admin")).map(({ href, label, icon: Icon }) => <Link href={href} key={href}><Icon size={15} />{label}</Link>)}{roles.includes("super_admin") && <Link href="/admin/parametres"><Settings2 size={15} />Paramètres</Link>}</nav><div className="admin-user"><span><ShieldCheck size={14} /></span><div><strong>{email}</strong><small>{roles.includes("super_admin") ? "Super-administrateur" : "Administrateur"}</small></div></div><SignOutButton /></aside>
    <div className="admin-content">{children}</div>
  </div></section>;
}
