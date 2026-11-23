import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, QrCode } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { MemberCardBatchForm } from "@/components/member-card-batch-form";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";

export const metadata: Metadata = { title: "QR Codes et cartes · Administration" };

export default async function AdminQrCodesPage() {
  const { supabase } = await getSignedInUser();
  if (!supabase) return null;
  const [{ data: members }, { data: activeTokens }] = await Promise.all([
    supabase.from("members").select("id,member_number,first_name,last_name,status").order("last_name").limit(100),
    supabase.from("member_qr_tokens").select("member_id").is("revoked_at", null),
  ]);
  const activeSet = new Set((activeTokens ?? []).map((item) => item.member_id));
  const cards = (members ?? []).map((member) => ({ id: member.id, full_name: `${member.first_name} ${member.last_name}`, member_number: member.member_number }));
  return <><div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CARTES DE MEMBRE</div><h1>QR Codes et cartes</h1><p>Chaque QR renvoie vers une page publique aux données limitées.</p></div><span className="admin-heading-mark"><QrCode size={18} /></span></div><div className="admin-banner">La régénération invalide immédiatement tous les anciens liens de vérification sélectionnés. Pour réimprimer une carte, générez une nouvelle carte : son ancien QR sera révoqué.</div><div className="admin-card"><h2>Générer des cartes PDF en lot</h2><p>Format A4 avec jusqu’à 8 cartes. La photo est imprimée uniquement si le membre a donné son consentement.</p>{cards.length ? <MemberCardBatchForm members={cards} /> : <div className="admin-empty">Ajoutez d’abord des membres pour générer leurs cartes.</div>}</div><div className="admin-card"><h2>État des QR Codes</h2><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Membre</th><th>Numéro ADEIO</th><th>Statut membre</th><th>QR Code</th><th></th></tr></thead><tbody>{members?.map((member) => <tr key={member.id}><td>{member.first_name} {member.last_name}</td><td>{member.member_number}</td><td>{memberStatusLabels[member.status as MemberStatus]}</td><td><span className={`status-chip ${activeSet.has(member.id) ? "" : "draft"}`}>{activeSet.has(member.id) ? "Actif" : "Aucun QR actif"}</span></td><td><Link href={`/admin/membres/${member.id}`} className="text-link">Gérer <ArrowRight size={14} /></Link></td></tr>)}</tbody></table></div></div></>;
}
