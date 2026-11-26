import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, QrCode } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { MemberCardBatchForm } from "@/components/member-card-batch-form";
import { MemberQrBatchForm } from "@/components/member-qr-batch-form";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "QR Codes et cartes · Administration" };
type MembershipPeriodCandidate = { id: string; member_id: string; starts_on: string; ends_on: string | null; ends_on_source: string; ends_on_confirmed_at: string | null };

export default async function AdminQrCodesPage() {
  const { supabase, roles } = await getSignedInUser();
  if (!supabase) return null;
  const isSuperAdmin = roles.includes("super_admin");
  const [{ data: members }, serviceClient, reviewResult, periodResult, assetResult, educationResult] = await Promise.all([
    supabase.from("members").select("id,member_number,first_name,last_name,status,exit_year,reactivation_photo_required,photo_path,profile_completed_at").order("last_name").limit(100),
    Promise.resolve(createSupabaseServiceClient()),
    isSuperAdmin ? supabase.from("member_card_reviews").select("member_id,review_status,approved_at") : Promise.resolve({ data: [] }),
    isSuperAdmin ? supabase.from("membership_periods").select("id,member_id,starts_on,ends_on,ends_on_source,ends_on_confirmed_at").order("starts_on", { ascending: false }) : Promise.resolve({ data: [] }),
    isSuperAdmin ? supabase.from("member_card_official_assets").select("asset_kind").eq("is_current", true) : Promise.resolve({ data: [] }),
    isSuperAdmin ? supabase.from("member_education_periods").select("member_id").eq("is_current", true) : Promise.resolve({ data: [] }),
  ]);
  const { data: activeTokens } = serviceClient
    ? await serviceClient.from("member_qr_tokens").select("member_id,encrypted_token,encryption_nonce,encryption_tag,encryption_key_version").is("revoked_at", null)
    : { data: [] };
  const activeSet = new Set((activeTokens ?? []).map((item) => item.member_id));
  const printableQrSet = new Set((activeTokens ?? []).filter((item) => item.encrypted_token && item.encryption_nonce && item.encryption_tag && item.encryption_key_version).map((item) => item.member_id));
  const dateParts = new Intl.DateTimeFormat("en", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata" }).formatToParts(new Date());
  const localDate = `${dateParts.find((part) => part.type === "year")?.value}-${dateParts.find((part) => part.type === "month")?.value}-${dateParts.find((part) => part.type === "day")?.value}`;
  const year = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  const reviews = new Map((reviewResult.data ?? []).map((item) => [item.member_id, item]));
  const periodRows = (periodResult.data ?? []) as MembershipPeriodCandidate[];
  const periods = new Map<string, MembershipPeriodCandidate>();
  for (const period of periodRows) {
    if (!periods.has(period.member_id) && period.starts_on <= localDate) periods.set(period.member_id, period);
  }
  const assetKinds = new Set((assetResult.data ?? []).map((item) => item.asset_kind));
  const currentEducation = new Set((educationResult.data ?? []).map((item) => item.member_id));
  const cards = (members ?? []).filter((member) => {
    const review = reviews.get(member.id);
    const period = periods.get(member.id);
    return isSuperAdmin && member.status === "active" && !member.reactivation_photo_required
      && member.exit_year !== null && member.exit_year > year
      && review?.review_status === "approved" && review.approved_at
      && period?.ends_on_source === "admin_confirmed" && period.ends_on_confirmed_at
      && period.ends_on && period.ends_on >= localDate
      && member.photo_path && member.profile_completed_at && currentEducation.has(member.id)
      && printableQrSet.has(member.id) && assetKinds.has("signature") && assetKinds.has("seal");
  }).map((member) => ({ id: member.id, full_name: `${member.first_name} ${member.last_name}`, member_number: member.member_number }));
  const qrCandidates = cards.map((card) => ({ ...card, hasQr: activeSet.has(card.id) }));

  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CARTES DE MEMBRE</div><h1>QR Codes et cartes</h1><p>Chaque QR renvoie vers une page publique aux données limitées.</p></div><span className="admin-heading-mark"><QrCode size={18} /></span></div>
    <div className="admin-banner">L’émission ou la révocation d’un QR est une action distincte. Télécharger ou réimprimer un PDF réutilise le QR actif et ne le renouvelle jamais.</div>
    <div className="admin-card"><h2>Émettre des QR Codes en lot</h2>{qrCandidates.length ? <MemberQrBatchForm members={qrCandidates} /> : <div className="admin-empty">Aucun membre actif avec une période de validité ouverte n’est disponible.</div>}</div>
    <div className="admin-card"><h2>Délivrer et télécharger les cartes</h2><p>Les cartes délivrées sont enregistrées avec un instantané des données, du QR, de la période et des éléments officiels. Les téléchargements suivants reprennent la même délivrance. Cette action est réservée au Super Admin.</p>{isSuperAdmin ? cards.length ? <MemberCardBatchForm members={cards} /> : <div className="admin-empty">Aucun membre ne remplit actuellement toutes les conditions de validation et de validité.</div> : <div className="admin-empty">La délivrance et le téléchargement des cartes sont réservés au Super Admin.</div>}</div>
    <div className="admin-card"><h2>État des QR Codes</h2><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Membre</th><th>Numéro ADEIO</th><th>Statut membre</th><th>QR Code</th><th></th></tr></thead><tbody>{members?.map((member) => <tr key={member.id}><td>{member.first_name} {member.last_name}</td><td>{member.member_number}</td><td><span className={`status-chip ${member.status === "active" ? "" : "draft"}`}>{memberStatusLabels[member.status as MemberStatus]}</span></td><td><span className={`status-chip ${activeSet.has(member.id) ? "" : "draft"}`}>{activeSet.has(member.id) ? "Actif" : "Aucun QR actif"}</span></td><td><Link href={`/admin/membres/${member.id}`} className="text-link">Gérer <ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div></div>
  </>;
}
