import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { IntegratedMemberCreateForm } from "@/components/integrated-member-create-form";

export const metadata: Metadata = { title: "Nouveau membre · Administration" };

export default async function NewMemberPage() {
  const { supabase } = await getSignedInUser();
  if (!supabase) return null;
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">FICHES ET ARCHIVES</div><h1>Nouveau membre</h1><p>Une seule étape crée le compte, sa fiche liée et son numéro ADEIO.</p></div><Link href="/admin/membres" className="text-link"><ArrowLeft size={15} /> Retour aux membres</Link></div>
    <div className="admin-card"><h2><UserPlus size={18} /> Créer un membre</h2><p>Le membre recevra les instructions d’activation, puis complétera sa filière, son établissement, son année de fin de cycle, son téléphone, son sexe et sa photo depuis son profil.</p><IntegratedMemberCreateForm currentYear={currentYear} /></div>
  </>;
}
