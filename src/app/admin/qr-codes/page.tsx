import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, QrCode } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { MemberCardBatchForm } from "@/components/member-card-batch-form";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "QR Codes et cartes · Administration" };

export default async function AdminQrCodesPage() {
  const { supabase } = await getSignedInUser();
  if (!supabase) return null;
  const [{ data: members }, serviceClient] = await Promise.all([
    supabase.from("members").select("id,member_number,first_name,last_name,status,exit_year,reactivation_photo_required").order("last_name").limit(100),
    Promise.resolve(createSupabaseServiceClient()),
  ]);
  const { data: activeTokens } = serviceClient
    ? await serviceClient.from("member_qr_tokens").select("member_id").is("revoked_at", null)
    : { data: [] };
  const activeSet = new Set((activeTokens ?? []).map((item) => item.member_id));
  const year = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  const cards = (members ?? [])
    .filter((member) => member.status === "active" && !member.reactivation_photo_required && member.exit_year !== null && member.exit_year > year)
    .map((member) => ({ id: member.id, full_name: `${member.first_name} ${member.last_name}`, member_number: member.member_number }));

  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CARTES DE MEMBRE</div><h1>QR Codes et cartes</h1><p>Chaque QR renvoie vers une page publique aux données limitées.</p></div><span className="admin-heading-mark"><QrCode size={18} /></span></div>
    <div className="admin-banner">L’émission ou la révocation d’un QR est une action distincte. Télécharger ou réimprimer un PDF réutilise le QR actif et ne le renouvelle jamais.</div>
    <div className="admin-card"><h2>Générer des cartes PDF en lot</h2><p>Format A4 recto-verso, jusqu’à 8 cartes par feuille. Les QR doivent d’abord être émis depuis la fiche de chaque membre. Le consentement photo contrôle l’affichage public de vérification ; l’impression reste réservée aux administrateurs habilités.</p>{cards.length ? <MemberCardBatchForm members={cards} /> : <div className="admin-empty">Aucun membre actif avec une période de validité ouverte n’est disponible.</div>}</div>
    <div className="admin-card"><h2>État des QR Codes</h2><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Membre</th><th>Numéro ADEIO</th><th>Statut membre</th><th>QR Code</th><th></th></tr></thead><tbody>{members?.map((member) => <tr key={member.id}><td>{member.first_name} {member.last_name}</td><td>{member.member_number}</td><td><span className={`status-chip ${member.status === "active" ? "" : "draft"}`}>{memberStatusLabels[member.status as MemberStatus]}</span></td><td><span className={`status-chip ${activeSet.has(member.id) ? "" : "draft"}`}>{activeSet.has(member.id) ? "Actif" : "Aucun QR actif"}</span></td><td><Link href={`/admin/membres/${member.id}`} className="text-link">Gérer <ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div></div>
  </>;
}
