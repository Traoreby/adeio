import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Camera, QrCode, Save, UserRound } from "lucide-react";
import { updateMemberAction, addMembershipPeriodAction, uploadMemberPhotoAction, removeMemberPhotoAction } from "@/app/admin/member-actions";
import { getSignedInUser } from "@/lib/auth";
import { getConsentedMemberPhotoUrl } from "@/lib/supabase/service";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";
import { MemberPhotoInput } from "@/components/member-photo-input";
import { MemberQrControl } from "@/components/member-qr-control";
import { DeleteMemberForm } from "@/components/delete-member-form";

export const metadata: Metadata = { title: "Fiche membre · Administration" };
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ erreur?: string; statut?: string }> };
const messages: Record<string, string> = { "membre-cree": "La fiche membre a été créée.", "membre-modifie": "Les informations du membre ont été mises à jour.", "periode-ajoutee": "La période de présence a été ajoutée.", "photo-enregistree": "La photo compressée a été enregistrée.", "photo-supprimee": "La photo a été supprimée du stockage.", "membre-anonymise": "Les coordonnées, le QR Code et la photo ont été retirés. L’historique financier et d’audit est conservé." };

export default async function AdminMemberDetailPage({ params, searchParams }: Props) {
  const [{ id }, { supabase, roles }, query] = await Promise.all([params, getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const [{ data: member }, { data: periods }, { data: details }, { data: profiles }, { data: tokens }] = await Promise.all([
    supabase.from("members").select("id,user_id,member_number,first_name,last_name,joined_year,status,photo_path,photo_public_consent").eq("id", id).maybeSingle(),
    supabase.from("membership_periods").select("id,starts_on,ends_on,note").eq("member_id", id).order("starts_on", { ascending: false }),
    supabase.from("member_private_details").select("email,phone").eq("member_id", id).maybeSingle(),
    supabase.from("profiles").select("user_id,display_name").order("display_name").limit(100),
    supabase.from("member_qr_tokens").select("id").eq("member_id", id).is("revoked_at", null).limit(1),
  ]);
  if (!member) return <div className="admin-card"><h1>Membre introuvable</h1><Link href="/admin/membres" className="text-link">Retour aux membres</Link></div>;
  const photoUrl = await getConsentedMemberPhotoUrl(member.photo_path);
  const status = member.status as MemberStatus;
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">FICHE MEMBRE</div><h1>{member.first_name} {member.last_name}</h1><p>{member.member_number} · {memberStatusLabels[status]}</p></div><Link href="/admin/membres" className="text-link"><ArrowLeft size={15} /> Retour</Link></div>
    {query.statut && messages[query.statut] && <div role="status" className="form-alert success-alert admin-banner">{messages[query.statut]}</div>}
    {query.erreur && <div role="alert" className="form-alert error-alert admin-banner">{query.erreur.includes("photo") ? "La photo doit être compressée en WebP ou JPEG et peser 500 Ko maximum." : query.erreur === "suppression-impossible" ? "Cette fiche n’a pas pu être supprimée. Des opérations financières ou des fonctions historiques peuvent la référencer." : query.erreur === "anonymisation-impossible" ? "La fiche n’a pas pu être anonymisée. Réessayez ou vérifiez les journaux de la base." : "Vérifiez les informations saisies et réessayez."}</div>}
    <div className="admin-card member-detail-photo"><div className="member-photo-preview">{photoUrl ? <Image src={photoUrl} alt={`Photo de ${member.first_name} ${member.last_name}`} fill sizes="400px" /> : <UserRound size={32} />}</div><form action={uploadMemberPhotoAction} className="admin-form"><input type="hidden" name="member_id" value={member.id} /><MemberPhotoInput /><button className="admin-submit" type="submit"><Camera size={15} /> Enregistrer la photo</button></form>{member.photo_path && <form action={removeMemberPhotoAction}><input type="hidden" name="member_id" value={member.id} /><button className="text-action danger-action" type="submit">Supprimer la photo</button></form>}</div>
    <div className="admin-card"><h2>Modifier la fiche</h2><form action={updateMemberAction} className="admin-form"><input type="hidden" name="id" value={member.id} />
      <div className="admin-form-grid"><div><label htmlFor="first_name">Prénoms</label><input id="first_name" name="first_name" required maxLength={100} defaultValue={member.first_name} /></div><div><label htmlFor="last_name">Nom</label><input id="last_name" name="last_name" required maxLength={100} defaultValue={member.last_name} /></div></div>
      <div className="admin-form-grid"><div><label htmlFor="joined_year">Année d’adhésion</label><input id="joined_year" name="joined_year" type="number" min="1900" max="2200" required defaultValue={member.joined_year} /></div><div><label htmlFor="exit_year">Année de sortie (facultative)</label><input id="exit_year" name="exit_year" type="number" min="1900" max="2200" defaultValue={periods?.find((period) => period.ends_on)?.ends_on?.slice(0, 4) ?? ""} /></div></div>
      <div className="admin-form-grid"><div><label htmlFor="status">Statut</label><select id="status" name="status" defaultValue={member.status}>{Object.entries(memberStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div><label htmlFor="user_id">Compte membre lié</label><select id="user_id" name="user_id" defaultValue={member.user_id ?? ""}><option value="">Aucun compte lié</option>{profiles?.map((profile) => <option key={profile.user_id} value={profile.user_id}>{profile.display_name || profile.user_id}</option>)}</select></div></div>
      <div className="admin-form-grid"><div><label htmlFor="email">Adresse e-mail privée</label><input id="email" name="email" type="email" maxLength={254} defaultValue={details?.email ?? ""} /></div><div><label htmlFor="phone">Téléphone privé</label><input id="phone" name="phone" type="tel" maxLength={40} defaultValue={details?.phone ?? ""} /></div></div>
      <label className="admin-form-checkbox"><input type="checkbox" name="photo_public_consent" defaultChecked={member.photo_public_consent} /> Consentement à la publication de la photo sur la vérification QR</label>
      <button className="admin-submit" type="submit"><Save size={15} /> Enregistrer les modifications</button>
    </form></div>
    <div className="admin-card"><h2><CalendarDays size={16} /> Historique de présence</h2><div className="member-period-list">{periods?.map((period) => <div key={period.id}><strong>{period.starts_on} – {period.ends_on ?? "Aujourd’hui"}</strong>{period.note && <span>{period.note}</span>}</div>)}</div><form action={addMembershipPeriodAction} className="admin-form member-period-form"><input type="hidden" name="member_id" value={member.id} /><h3>Ajouter une période</h3><div className="admin-form-grid"><div><label htmlFor="starts_on">Début</label><input id="starts_on" type="date" name="starts_on" required /></div><div><label htmlFor="ends_on">Fin (facultative)</label><input id="ends_on" type="date" name="ends_on" /></div></div><div><label htmlFor="note">Note (facultative)</label><input id="note" name="note" maxLength={200} placeholder="Ex. Retour après une interruption" /></div><button className="admin-submit" type="submit">Ajouter la période</button></form></div>
    <div className="admin-card"><h2><QrCode size={16} /> QR Code individuel</h2><p>Émettez ou révoquez le lien de vérification de cette carte.</p><MemberQrControl memberId={member.id} hasActiveToken={Boolean(tokens?.length)} /></div>
    {roles.includes("super_admin") && <div className="admin-card member-delete-card"><h2>Données personnelles et suppression</h2><p>L’anonymisation retire photo, coordonnées, lien de compte et QR Code, tout en conservant les écritures financières. Le journal d’audit conserve ses anciennes valeurs pour respecter la traçabilité. La suppression complète est refusée si des écritures ou mandats historiques référencent le membre.</p><DeleteMemberForm memberId={member.id} memberName={`${member.first_name} ${member.last_name}`} /></div>}
  </>;
}
