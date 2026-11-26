import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LockKeyhole, UserRound } from "lucide-react";
import { MemberPhotoInput } from "@/components/member-photo-input";
import { ProfileSubmitButton } from "@/components/profile-submit-button";
import { saveOwnMemberProfileAction } from "@/app/espace-membre/profil/actions";
import { getSignedInUser } from "@/lib/auth";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";
import { getMemberPhotoUrl } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Mon profil · ADEIO" };

const feedback: Record<string, string> = {
  "profil-invalide": "Complétez tous les champs obligatoires avec des valeurs valides.",
  "annee-sortie-invalide": "L’année de sortie doit être postérieure à l’année en cours et ne peut pas précéder l’adhésion.",
  "annee-sortie-atteinte": "Votre année de sortie est atteinte. Seule l’administration peut décider d’une réactivation.",
  "photo-invalide": "La photo doit être une image WebP ou JPEG compressée de 500 Ko maximum.",
  "photo-impossible": "La photo n’a pas pu être enregistrée. Réessayez.",
  "photo-envoi-impossible": "Le transfert de la photo a échoué. Vérifiez votre connexion et réessayez.",
  "photo-liaison-impossible": "La photo a été transférée mais n’a pas pu être associée à votre fiche. Le fichier temporaire a été nettoyé ; réessayez.",
  "consentement-impossible": "Les informations du profil ont été enregistrées, mais le consentement photo n’a pas pu être mis à jour.",
  "reactivation-envoi-impossible": "Le profil a été mis à jour, mais la demande de réactivation n’a pas pu être transmise. Contactez l’administration.",
  "dossier-introuvable": "Aucun dossier ADEIO en attente n’est associé à ce compte. Contactez l’administration.",
  "enregistrement-impossible": "Le profil n’a pas pu être enregistré. Vérifiez les champs puis réessayez.",
  "reactivation-requise": "Votre compte est archivé. Contactez l’administration pour demander une réactivation.",
  "photo-reactivation-requise": "Pour demander la réactivation, une nouvelle photo doit être prise ou importée.",
};

type Props = { searchParams: Promise<{ erreur?: string; statut?: string }> };

export default async function MyMemberProfilePage({ searchParams }: Props) {
  const [{ supabase, user, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Profil indisponible</h1><p>Connectez le projet Supabase pour consulter votre fiche membre.</p></div></section>;
  if (!user) redirect("/connexion?next=%2Fespace-membre%2Fprofil");
  if (roles.includes("admin") || roles.includes("super_admin")) redirect("/admin");
  if (!roles.includes("member")) redirect("/espace-membre?erreur=acces-refuse");

  const [{ data: member }, { data: onboarding }, { data: profile }, { data: isCurrentMember }] = await Promise.all([
    supabase.from("members").select("id,member_number,first_name,last_name,joined_year,exit_year,status,photo_path,photo_public_consent,photo_updated_at,archived_at,profile_completed_at,reactivation_photo_required").eq("user_id", user.id).maybeSingle(),
    supabase.from("member_onboarding").select("kind,status,member_id").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("display_name,must_change_password").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("is_current_member"),
  ]);
  if (profile?.must_change_password) redirect("/mot-de-passe");

  const [{ data: details }, { data: periods }, { data: educationRows }] = member ? await Promise.all([
    supabase.from("member_private_details").select("phone,sex").eq("member_id", member.id).maybeSingle(),
    supabase.from("membership_periods").select("id,starts_on,ends_on,note").eq("member_id", member.id).order("starts_on", { ascending: false }),
    supabase.from("member_education_periods").select("id,study_program,institution,starts_on,ends_on,is_current").eq("member_id", member.id).order("starts_on", { ascending: false }),
  ]) : [{ data: null }, { data: null }, { data: null }];
  const photoUrl = await getMemberPhotoUrl(member?.photo_path);
  const isReactivation = member?.status === "former" && onboarding?.kind === "reactivation" && onboarding.status === "pending";
  const waitingForAdmin = member?.status === "former" && onboarding?.kind === "reactivation" && onboarding.status === "profile_submitted";
  const isNewOnboarding = onboarding?.kind === "new_member" && onboarding.status === "pending"
    && (!member || member.profile_completed_at === null);
  const expiredAwaitingArchive = member?.status === "active" && !isNewOnboarding && isCurrentMember === false;
  const canEdit = (member?.status === "active" && !expiredAwaitingArchive) || isNewOnboarding || isReactivation;
  const currentEducation = educationRows?.find((item) => item.is_current);
  const status = isNewOnboarding ? "En attente de complétion" : expiredAwaitingArchive ? "Année de sortie atteinte · archivage en cours" : member ? memberStatusLabels[member.status as MemberStatus] : "En attente de complétion";

  return <section className="member-space-page section-pad"><div className="container member-profile-container">
    <div className="member-space-heading"><div><div className="eyebrow eyebrow-green">ESPACE PERSONNEL</div><h1>Mon profil</h1><p>Complétez vos informations personnelles et vérifiez votre fiche ADEIO.</p></div><Link href="/espace-membre" className="text-link"><ArrowLeft size={15} /> Mon espace</Link></div>
    {params.erreur && <div role="alert" className="form-alert error-alert admin-banner">{feedback[params.erreur] ?? "Une erreur est survenue. Réessayez ou contactez l’administration."}</div>}
    {params.statut && <div role="status" className="form-alert success-alert admin-banner">{params.statut === "reactivation-soumise" ? "Votre profil et votre nouvelle photo ont été transmis à l’administration pour validation." : "Votre profil a été enregistré."}</div>}
    {expiredAwaitingArchive && <div role="status" className="admin-banner">Votre année de sortie est atteinte. Les accès réservés aux membres actifs sont fermés ; le dossier passera dans les archives au prochain traitement. Une réactivation exige une décision de l’administration.</div>}

    <article className="member-profile-card member-profile-self-card">
      {member && <div className="member-directory-avatar member-profile-avatar">{photoUrl ? <Image src={photoUrl} alt={`Photo de ${member.first_name} ${member.last_name}`} fill sizes="160px" /> : <UserRound size={36} />}</div>}
      <div className="eyebrow eyebrow-green">FICHE MEMBRE</div>
      <h2>{member ? `${member.first_name} ${member.last_name}` : profile?.display_name || "Nouvelle adhésion"}</h2>
      {member && <p className="member-profile-number">{member.member_number}</p>}
      <div className="member-profile-state"><span className={`status-chip ${member?.status === "active" ? "" : "draft"}`}>{status}</span>{member && <span>Adhésion initiale : {member.joined_year}</span>}</div>
      <div className="member-profile-details"><div><span>E-mail du compte</span><strong>{user.email || "Non renseigné"}</strong></div><div><span>Statut</span><strong>{status}</strong></div>{member && <div><span>Année de sortie</span><strong>{member.exit_year ?? "À compléter"}</strong></div>}</div>
      <p className="member-profile-help"><LockKeyhole size={15} /> L’adresse e-mail et le statut sont gérés par l’administration. Pour changer l’e-mail du compte, contactez un Admin ou le Super Admin.</p>
    </article>

    {waitingForAdmin ? <div className="member-space-empty"><h2>Réactivation en cours de vérification</h2><p>L’administration vérifiera les nouvelles informations et la photo avant de réactiver votre adhésion et d’émettre un nouveau QR.</p></div> : canEdit ? (
      <form action={saveOwnMemberProfileAction} className="admin-card member-profile-edit-form">
        <h2>{isReactivation ? "Informations pour la réactivation" : isNewOnboarding ? "Compléter mon adhésion" : "Mes informations personnelles"}</h2>
        <p>{isReactivation ? "Une nouvelle photo est obligatoire. Votre numéro ADEIO et votre historique seront conservés ; l’administration validera la réactivation." : "Les champs marqués obligatoires sont nécessaires pour tenir votre fiche ADEIO à jour."}</p>
        <div className="admin-form">
          <div className="admin-form-grid"><div><label htmlFor="first_name">Prénom(s) *</label><input id="first_name" name="first_name" required maxLength={100} defaultValue={member?.first_name ?? ""} /></div><div><label htmlFor="last_name">Nom *</label><input id="last_name" name="last_name" required maxLength={100} defaultValue={member?.last_name ?? ""} /></div></div>
          <div className="admin-form-grid"><div><label htmlFor="joined_year">Année d’adhésion initiale *</label><input id="joined_year" name="joined_year" type="number" min="1900" max="2200" required defaultValue={member?.joined_year ?? ""} readOnly={Boolean(member)} /></div><div><label htmlFor="exit_year">Année de sortie *</label><input id="exit_year" name="exit_year" type="number" min="1900" max="2200" required defaultValue={member?.exit_year ?? ""} /></div></div>
          <div className="admin-form-grid"><div><label htmlFor="study_program">Filière *</label><input id="study_program" name="study_program" required maxLength={160} defaultValue={currentEducation?.study_program ?? ""} /></div><div><label htmlFor="institution">Établissement *</label><input id="institution" name="institution" required maxLength={200} defaultValue={currentEducation?.institution ?? ""} /></div></div>
          <div className="admin-form-grid"><div><label htmlFor="phone">Téléphone *</label><input id="phone" name="phone" type="tel" required maxLength={40} defaultValue={details?.phone ?? ""} /></div><div><label htmlFor="sex">Sexe{isNewOnboarding || isReactivation || !details?.sex ? " *" : ""}</label><select id="sex" name="sex" required={Boolean(isNewOnboarding || isReactivation || !details?.sex)} defaultValue={details?.sex === "female" || details?.sex === "male" ? details.sex : ""}><option value="">{details?.sex && details.sex !== "female" && details.sex !== "male" ? "Conserver la valeur historique" : "Choisir une option"}</option><option value="female">Femme</option><option value="male">Homme</option></select>{details?.sex && details.sex !== "female" && details.sex !== "male" && <small>Votre ancienne valeur est conservée si vous ne sélectionnez pas un nouveau choix.</small>}</div></div>
          <MemberPhotoInput required={Boolean(isReactivation)} />
          <label className="admin-form-checkbox"><input type="checkbox" name="photo_public_consent" defaultChecked={Boolean(member?.photo_public_consent)} /> J’autorise l’affichage de ma photo sur la page publique de vérification du QR Code.</label>
          <ProfileSubmitButton reactivation={Boolean(isReactivation)} />
        </div>
      </form>
    ) : member ? <>
      <div className="admin-card"><h2>Formation et coordonnées</h2><div className="member-profile-details"><div><span>Filière</span><strong>{currentEducation?.study_program ?? "À compléter"}</strong></div><div><span>Établissement</span><strong>{currentEducation?.institution ?? "À compléter"}</strong></div><div><span>Téléphone</span><strong>{details?.phone ?? "Non renseigné"}</strong></div><div><span>Sexe</span><strong>{details?.sex === "female" ? "Femme" : details?.sex === "male" ? "Homme" : details?.sex ? "Valeur historique conservée" : "Non renseigné"}</strong></div></div></div>
      <div className="admin-card"><h2>Historique des formations</h2><div className="member-period-list">{educationRows?.map((item) => <div key={item.id}><strong>{item.study_program} · {item.institution}</strong><span>{item.starts_on} – {item.ends_on ?? "En cours"}</span></div>)}</div>{!educationRows?.length && <p>Aucune formation historisée.</p>}</div>
      <div className="admin-card"><h2>Historique des adhésions</h2><div className="member-period-list">{periods?.map((period) => <div key={period.id}><strong>{period.starts_on} – {period.ends_on ?? "Aujourd’hui"}</strong>{period.note && <span>{period.note}</span>}</div>)}</div></div>
    </> : <div className="member-space-empty"><h2>Aucun dossier en attente</h2><p>Demandez à l’administration ADEIO de vous inviter ou de lier votre compte à votre fiche existante.</p><Link href="/espace-membre" className="text-link"><ArrowLeft size={15} /> Retour à mon espace</Link></div>}
  </div></section>;
}
