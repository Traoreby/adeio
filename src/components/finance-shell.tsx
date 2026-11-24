import Link from "next/link";
import { ArrowLeft, Banknote, FileBarChart2, FileClock, Landmark, ListOrdered } from "lucide-react";
import type { AppRole } from "@/lib/auth";

const navigation = [
  { href: "/gestion-financiere", label: "Vue financière", icon: Landmark },
  { href: "/gestion-financiere/operations", label: "Opérations", icon: ListOrdered },
  { href: "/gestion-financiere/cotisations", label: "Cotisations et arriérés", icon: Banknote },
  { href: "/gestion-financiere/bilans", label: "Bilans financiers", icon: FileBarChart2 },
];

export function FinanceShell({ children, email, roles }: { children: React.ReactNode; email: string; roles: AppRole[] }) {
  const roleLabel = roles.includes("super_admin") ? "Super-administrateur" : roles.includes("treasurer") ? "Trésorier" : "Commissaire aux comptes";
  return <section className="admin-wrap"><div className="container admin-shell">
    <aside className="admin-sidebar"><div className="admin-sidebar-title"><span>GESTION FINANCIÈRE</span><strong>ADEIO</strong></div><nav className="admin-nav" aria-label="Navigation financière">{navigation.map(({ href, label, icon: Icon }) => <Link href={href} key={href}><Icon size={15} />{label}</Link>)}</nav><Link href="/espace-membre" className="text-link finance-back-link"><ArrowLeft size={14} /> Retour à mon espace</Link><div className="admin-user"><span><FileClock size={14} /></span><div><strong>{email}</strong><small>{roleLabel}</small></div></div></aside>
    <div className="admin-content">{children}</div>
  </div></section>;
}
