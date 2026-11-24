import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MotionEffects } from "@/components/motion-effects";
import { getHeaderSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: {
    default: "ADEIO | Association des Étudiants Ivoiriens de l’Odisha",
    template: "%s | ADEIO",
  },
  description: "Site officiel d'ADEIO, l'Association des Étudiants Ivoiriens de l'Odisha, basée à KIIT University, Bhubaneswar (Inde).",
  ...(process.env.NEXT_PUBLIC_SITE_URL ? { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL) } : {}),
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, roles } = await getHeaderSession();
  const displayName = typeof user?.user_metadata?.display_name === "string"
    ? user.user_metadata.display_name
    : user?.email?.split("@")[0] ?? "";
  const headerSession = user ? {
    id: user.id,
    displayName,
    email: user.email ?? "",
    isAdmin: roles.some((role) => role === "admin" || role === "super_admin"),
    rolesReady: true,
  } : null;
  return (
    <html lang="fr">
      <body>
        <MotionEffects />
        <SiteHeader key={headerSession ? `${headerSession.id}:${headerSession.email}:${headerSession.displayName}:${headerSession.isAdmin}` : "anonymous"} initialSession={headerSession} />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
