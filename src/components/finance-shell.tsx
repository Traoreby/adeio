import Link from "next/link";
import { ArrowLeft, FileClock } from "lucide-react";
import type { AppRole } from "@/lib/auth";
import { ActiveSidebarNav } from "@/components/active-sidebar-nav";

export function FinanceShell({ children, email, roles }: { children: React.ReactNode; email: string; roles: AppRole[] }) {
  const roleLabel = roles.includes("super_admin") ? "Super-administrateur" : roles.includes("treasurer") ? "Trésorier" : "Commissaire aux comptes";
  return <section className="admin-wrap"><div className="container admin-shell">
    <aside className="admin-sidebar"><div className="admin-sidebar-title"><span>GESTION FINANCIÈRE</span><strong>ADEIO</strong></div><ActiveSidebarNav kind="finance" roles={roles} /><Link href="/espace-membre" className="text-link finance-back-link"><ArrowLeft size={16} /> Retour à mon espace</Link><div className="admin-user"><span><FileClock size={16} /></span><div><strong>{email}</strong><small>{roleLabel}</small></div></div></aside>
    <div className="admin-content">{children}</div>
  </div></section>;
}
