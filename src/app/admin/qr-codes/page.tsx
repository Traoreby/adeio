import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, QrCode } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { MemberCardBatchForm } from "@/components/member-card-batch-form";
import { MemberQrBatchForm } from "@/components/member-qr-batch-form";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { canIssueMemberQr, getMemberCardBlockers } from "@/lib/member-card-eligibility";

export const metadata: Metadata = { title: "QR Codes et cartes · Administration" };
type MembershipPeriodCandidate = { id: string; member_id: string; starts_on: string; ends_on: string | null; ends_on_source: string; ends_on_confirmed_at: string | null; ends_on_confirmed_by: string | null; created_at: string };

export default async function AdminQrCodesPage() {
  const { supabase, roles } = await getSignedInUser();
  if (!supabase) return null;
  const isSuperAdmin = roles.includes("super_admin");
  const isAdmin = isSuperAdmin || roles.includes("admin");
  const [{ data: members }, serviceClient, reviewResult, periodResult, assetResult, educationResult] = await Promise.all([
    supabase.from("members").select("id,member_number,first_name,last_name,status,joined_year,exit_year,reactivation_photo_required,photo_path,profile_completed_at").order("last_name").limit(100),
    Promise.resolve(createSupabaseServiceClient()),
    isSuperAdmin ? supabase.from("member_card_reviews").select("member_id,review_status,approved_at") : Promise.resolve({ data: [] }),
    isSuperAdmin ? supabase.from("membership_periods").select("id,member_id,starts_on,ends_on,ends_on_source,ends_on_confirmed_at,ends_on_confirmed_by,created_at").order("starts_on", { ascending: false }).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    isSuperAdmin ? supabase.from("member_card_official_assets").select("asset_kind").eq("is_current", true) : Promise.resolve({ data: [] }),
    isSuperAdmin ? supabase.from("member_education_periods").select("member_id").eq("is_current", true) : Promise.resolve({ data: [] }),
  ]);
  const { data: activeTokens, error: activeTokensError } = serviceClient
    ? await serviceClient.from("member_qr_tokens").select("member_id,encrypted_token,encryption_nonce,encryption_tag,encryption_key_version").is("revoked_at", null)
    : { data: [], error: new Error("Service de lecture QR indisponible") };
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
  const cardEligibility = new Map((members ?? []).map((member) => {
    const review = reviews.get(member.id);
    const period = periods.get(member.id);
    return [member.id, getMemberCardBlockers({
      status: member.status,
      joinedYear: member.joined_year,
      exitYear: member.exit_year,
      reactivationPhotoRequired: member.reactivation_photo_required,
      profileCompletedAt: member.profile_completed_at,
      photoPath: member.photo_path,
      reviewApproved: review?.review_status === "approved" && Boolean(review.approved_at),
      hasCurrentPeriod: Boolean(period),
      periodEnd: period?.ends_on ?? null,
      periodEndConfirmed: period?.ends_on_source === "admin_confirmed" && Boolean(period.ends_on_confirmed_at) && Boolean(period.ends_on_confirmed_by),
      hasCurrentEducation: currentEducation.has(member.id),
      hasPrintableQr: printableQrSet.has(member.id),
      hasSignature: assetKinds.has("signature"),
      hasSeal: assetKinds.has("seal"),
    }, localDate, year)] as const;
  }));
  const cards = (members ?? []).filter((member) => isSuperAdmin && cardEligibility.get(member.id)?.length === 0)
    .map((member) => ({ id: member.id, full_name: `${member.first_name} ${member.last_name}`, member_number: member.member_number }));

  // QR emission has its own narrower rules. Card readiness is deliberately not
  // consulted here: a card requires an existing printable QR, so doing so would
  // make it impossible to issue the first QR for an otherwise eligible member.
  const qrCandidates = (members ?? [])
    .filter((member) => isAdmin && !activeTokensError && canIssueMemberQr({
      status: member.status,
      exitYear: member.exit_year,
      reactivationPhotoRequired: member.reactivation_photo_required,
      hasActiveQr: activeSet.has(member.id),
    }, year))
    .map((member) => ({ id: member.id, full_name: `${member.first_name} ${member.last_name}`, member_number: member.member_number }));

  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CARTES DE MEMBRE</div><h1>QR Codes et cartes</h1><p>Chaque QR renvoie vers une page publique aux données limitées.</p></div><span className="admin-heading-mark"><QrCode size={18} /></span></div>
    <div className="admin-banner">L’émission ou la révocation d’un QR est une action distincte. Télécharger ou réimprimer un PDF réutilise le QR actif et ne le renouvelle jamais.</div>
    <div className="admin-card"><h2>Émettre des QR Codes en lot</h2>{qrCandidates.length ? <MemberQrBatchForm members={qrCandidates} /> : <div className="admin-empty">{activeTokensError ? "La vérification des QR actifs est indisponible. Aucune émission ne peut être proposée en sécurité." : "Aucun membre actif éligible sans QR actif. Un QR déjà actif n’est jamais réémis depuis cette liste."}</div>}</div>
    <div className="admin-card"><h2>Délivrer et télécharger les cartes</h2><p>Les cartes délivrées sont enregistrées avec un instantané des données, du QR, de la période et des éléments officiels. Les téléchargements suivants reprennent la même délivrance. Cette action est réservée au Super Admin.</p>{isSuperAdmin ? cards.length ? <MemberCardBatchForm members={cards} /> : <div className="admin-empty">Aucun membre ne remplit actuellement toutes les conditions de validation et de validité.</div> : <div className="admin-empty">La délivrance et le téléchargement des cartes sont réservés au Super Admin.</div>}</div>
    <div className="admin-card"><h2>État des QR Codes</h2><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Membre</th><th>Numéro ADEIO</th><th>Statut membre</th><th>QR Code</th><th>Éligibilité à la carte</th><th></th></tr></thead><tbody>{members?.map((member) => {
      const reasons = cardEligibility.get(member.id) ?? [];
      return <tr key={member.id}><td>{member.first_name} {member.last_name}</td><td>{member.member_number}</td><td><span className={`status-chip ${member.status === "active" ? "" : "draft"}`}>{memberStatusLabels[member.status as MemberStatus]}</span></td><td><span className={`status-chip ${activeTokensError || !activeSet.has(member.id) ? "draft" : ""}`}>{activeTokensError ? "État indisponible" : activeSet.has(member.id) ? "Actif" : "Aucun QR actif"}</span></td><td className="member-card-eligibility-cell">{!isSuperAdmin ? <span>Délivrance réservée au Super Admin</span> : reasons.length === 0 ? <span className="status-chip">Prêt à délivrer</span> : <ul className="member-card-eligibility">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}</td><td><Link href={`/admin/membres/${member.id}`} className="text-link">Gérer <ArrowRight size={14} /></Link></td></tr>;
    })}</tbody></table></div></div>
  </>;
}
