import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MotionEffects } from "@/components/motion-effects";

export const metadata: Metadata = {
  title: {
    default: "ADEIO | Association des Étudiants Ivoiriens de l’Odisha",
    template: "%s | ADEIO",
  },
  description: "Site officiel d'ADEIO, l'Association des Étudiants Ivoiriens de l'Odisha, basée à KIIT University, Bhubaneswar (Inde).",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <MotionEffects />
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
