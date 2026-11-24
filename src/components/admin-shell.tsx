import { ShieldCheck } from "lucide-react";
import type { AppRole } from "@/lib/auth";
import { ActiveSidebarNav } from "@/components/active-sidebar-nav";

export function AdminShell({ children, email, roles }: { children: React.ReactNode; email: string; roles: AppRole[] }) {
  return <section className="admin-wrap"><div className="container admin-shell">
    <aside className="admin-sidebar"><div className="admin-sidebar-title"><span>ESPACE ADMINISTRATION</span><strong>ADEIO</strong></div><ActiveSidebarNav kind="admin" roles={roles} /><div className="admin-user"><span><ShieldCheck size={16} /></span><div><strong>{email}</strong><small>{roles.includes("super_admin") ? "Super-administrateur" : "Administrateur"}</small></div></div></aside>
    <div className="admin-content">{children}</div>
  </div></section>;
}
