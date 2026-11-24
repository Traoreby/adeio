import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, UserRound } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { getConsentedMemberPhotoUrl } from "@/lib/supabase/service";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";
import Image from "next/image";

export const metadata: Metadata = { title: "Mon profil · ADEIO" };

export default async function MyMemberProfilePage() {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Profil indisponible</h1><p>Connectez le projet Supabase pour consulter votre fiche membre.</p></div></section>;
  if (!user) redirect("/connexion?next=%2Fespace-membre%2Fprofil");
  if (roles.includes("admin") || roles.includes("super_admin")) redirect("/admin");
  const { data: member } = await supabase.from("members").select("id,member_number,first_name,last_name,joined_year,status,photo_path,photo_public_consent").eq("user_id", user.id).maybeSingle();
  if (!member) return <section className="member-space-page section-pad"><div className="container"><div className="member-space-empty"><h1>Aucune fiche membre associée</h1><p>Demandez à l’administration ADEIO de lier votre compte à votre fiche.</p><Link href="/espace-membre" className="text-link"><ArrowLeft size={15} /> Retour à mon espace</Link></div></div></section>;
  const [{ data: details }, { data: periods }] = await Promise.all([
    supabase.from("member_private_details").select("email,phone").eq("member_id", member.id).maybeSingle(),
    supabase.from("membership_periods").select("starts_on,ends_on,note").eq("member_id", member.id).order("starts_on", { ascending: false }),
  ]);
  const photoUrl = await getConsentedMemberPhotoUrl(member.photo_path);
  return <section className="member-space-page section-pad"><div className="container member-profile-container"><div className="member-space-heading"><div><div className="eyebrow eyebrow-green">ESPACE PERSONNEL</div><h1>Mon profil</h1><p>Votre fiche et vos coordonnées privées.</p></div><Link href="/espace-membre" className="text-link"><ArrowLeft size={15} /> Mon espace</Link></div><article className="member-profile-card"><div className="member-directory-avatar member-profile-avatar">{photoUrl ? <Image src={photoUrl} alt={`Photo de ${member.first_name} ${member.last_name}`} fill sizes="100px" /> : <UserRound size={36} />}</div><div className="eyebrow eyebrow-green">{memberStatusLabels[member.status as MemberStatus]}</div><h2>{member.first_name} {member.last_name}</h2><p className="member-profile-number">{member.member_number}</p><div className="member-profile-details"><div><span>Année d’adhésion</span><strong>{member.joined_year}</strong></div><div><span>E-mail</span><strong>{details?.email || user.email || "Non renseigné"}</strong></div><div><span>Téléphone</span><strong>{details?.phone || "Non renseigné"}</strong></div></div><h3>Présence à l’association</h3><div className="member-period-list">{periods?.map((period) => <div key={`${period.starts_on}-${period.ends_on}`}><strong>{period.starts_on} – {period.ends_on ?? "Aujourd’hui"}</strong>{period.note && <span>{period.note}</span>}</div>)}</div><p className="member-profile-help">Pour corriger votre fiche ou demander le retrait de vos données, contactez les responsables ADEIO.</p></article></div></section>;
}
