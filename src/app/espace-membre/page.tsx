import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Archive,
  ArrowRight,
  Banknote,
  CalendarDays,
  ContactRound,
  FileText,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { memberStatusLabels, type MemberStatus } from "@/lib/members";
import { getConsentedMemberPhotoUrl } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Espace membre" };

const sensitiveRoles = ["treasurer", "auditor", "admin", "super_admin"];
const financialRoles = ["treasurer", "auditor", "super_admin"];

type Announcement = {
  id: string;
  title: string;
  slug: string;
  published_at: string | null;
  visibility: string;
};

function formatAnnouncementDate(date: string | null) {
  if (!date) return "Date non précisée";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(date));
}

export default async function MemberHomePage() {
  const { supabase, user, roles } = await getSignedInUser();
  if (!supabase) return <section className="section-pad"><div className="container empty-state"><h1>Espace membre à configurer</h1><p>Le projet Supabase doit être raccordé avant l’activation des comptes.</p></div></section>;
  if (!user) redirect("/connexion?next=/espace-membre");
  if (roles.includes("admin") || roles.includes("super_admin")) redirect("/admin");

  const [{ data: profile }, { data: announcements }, { data: member }] = await Promise.all([
    supabase.from("profiles").select("display_name,must_change_password,mfa_enabled").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("get_visible_announcements", { p_limit: 20 }),
    supabase.from("members").select("member_number,first_name,last_name,joined_year,status,photo_path,photo_public_consent").eq("user_id", user.id).maybeSingle(),
  ]);

  if (profile?.must_change_password) redirect("/mot-de-passe");

  const photoUrl = member?.photo_public_consent ? await getConsentedMemberPhotoUrl(member.photo_path) : null;
  const memberNotices = ((announcements ?? []) as Announcement[])
    .filter((item) => item.visibility === "members")
    .slice(0, 3);
  const isSensitiveRole = roles.some((role) => sensitiveRoles.includes(role));
  const canManageFinances = roles.some((role) => financialRoles.includes(role));
  const canManageAdministration = roles.some((role) => ["admin", "super_admin"].includes(role));
  const memberStatus = member ? memberStatusLabels[member.status as MemberStatus] : null;

  const actions = [
    {
      href: "/espace-membre/profil",
      title: "Mon profil",
      description: "Consultez votre fiche et vos périodes de présence.",
      icon: UserRound,
    },
    {
      href: "/membres",
      title: "Annuaire des membres",
      description: "Retrouvez les membres actuels de la communauté.",
      icon: ContactRound,
    },
    {
      href: "/archives",
      title: "Archives",
      description: "Consultez les anciennes listes de membres.",
      icon: Archive,
    },
    {
      href: "/finances",
      title: "Finances de l’association",
      description: "Consultez les opérations générales et les bilans publiés.",
      icon: Banknote,
    },
    {
      href: "/espace-membre/cotisations",
      title: "Mes cotisations",
      description: "Suivez vos paiements et votre situation personnelle.",
      icon: CalendarDays,
    },
    {
      href: "/documents",
      title: "Documents officiels",
      description: "Accédez aux documents partagés avec les membres.",
      icon: FileText,
    },
    ...(canManageFinances ? [{
      href: "/gestion-financiere",
      title: "Gestion financière",
      description: "Enregistrez les opérations et suivez les cotisations.",
      icon: Banknote,
    }] : []),
    ...(canManageAdministration ? [{
      href: "/admin",
      title: "Administration",
      description: "Gérez les membres, les contenus et les paramètres ADEIO.",
      icon: LockKeyhole,
    }] : []),
  ];

  return (
    <section className="member-home section-pad">
      <div className="container member-home-content">
        <header className="member-welcome">
          <div>
            <div className="eyebrow eyebrow-green">ESPACE MEMBRE</div>
            <h1>Bonjour{profile?.display_name ? `, ${profile.display_name}` : ""}.</h1>
            <p>Bienvenue dans votre espace ADEIO.</p>
          </div>
        </header>

        <section className="member-home-card member-home-membership" aria-labelledby="member-card-title">
          <div className="member-home-member-avatar">
            {photoUrl ? (
              <Image src={photoUrl} alt={`Photo de ${member?.first_name} ${member?.last_name}`} fill sizes="72px" />
            ) : (
              <UserRound size={30} aria-hidden="true" />
            )}
          </div>
          <div className="member-home-member-info">
            <div className="eyebrow eyebrow-green">MA CARTE DE MEMBRE</div>
            <h2 id="member-card-title">{member ? `${member.first_name} ${member.last_name}` : "Fiche membre"}</h2>
            {member ? (
              <div className="member-home-member-meta">
                <span className="member-home-number">{member.member_number}</span>
                <span className={`member-home-status ${member.status === "active" ? "is-active" : ""}`}>{memberStatus}</span>
                <span>Adhésion {member.joined_year}</span>
              </div>
            ) : (
              <p className="member-home-no-card">Aucune fiche membre n’est encore associée à ce compte. Contactez l’administration ADEIO.</p>
            )}
          </div>
          {member && <Link href="/espace-membre/profil" className="member-home-card-link">Voir ma fiche <ArrowRight size={17} /></Link>}
        </section>

        <section aria-labelledby="member-actions-title" className="member-home-actions-section">
          <div className="member-home-section-title">
            <div className="eyebrow eyebrow-green">ACCÈS RAPIDES</div>
            <h2 id="member-actions-title">Que souhaitez-vous consulter ?</h2>
          </div>
          <div className="member-action-grid">
            {actions.map(({ href, title, description, icon: Icon }) => (
              <Link className="member-action-card" href={href} key={href}>
                <span className="member-action-icon"><Icon size={21} aria-hidden="true" /></span>
                <span className="member-action-copy"><strong>{title}</strong><span>{description}</span></span>
                <ArrowRight className="member-action-arrow" size={19} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>

        <section className="member-announcements" aria-labelledby="member-announcements-title">
          <div className="member-section-heading">
            <div>
              <div className="eyebrow eyebrow-green">POUR LES MEMBRES</div>
              <h2 id="member-announcements-title">Annonces réservées</h2>
            </div>
            <Link href="/actualites" className="member-announcements-button">Voir les actualités <ArrowRight size={16} /></Link>
          </div>
          {memberNotices.length ? (
            <>
              <div className="member-announcement-list">
                {memberNotices.map((item) => (
                  <Link className="member-announcement-row" href={`/actualites/${item.slug}`} key={item.id}>
                    <span className="member-announcement-copy"><time dateTime={item.published_at ?? undefined}>{formatAnnouncementDate(item.published_at)}</time><strong>{item.title}</strong></span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                ))}
              </div>
              <Link href="/actualites" className="member-announcements-all">Voir toutes les actualités <ArrowRight size={15} /></Link>
            </>
          ) : (
            <p className="member-empty-note">Aucune annonce réservée aux membres pour le moment. Revenez consulter cette page pour connaître les prochaines nouvelles de l’association.</p>
          )}
        </section>

        {isSensitiveRole && (
          <section className="member-security-card" aria-labelledby="member-security-title">
            <span className="member-action-icon member-security-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
            <div className="member-security-copy">
              <div className="eyebrow eyebrow-green">SÉCURITÉ DU COMPTE</div>
              <h2 id="member-security-title">Authentification à deux facteurs</h2>
              <p>État : <strong>{profile?.mfa_enabled ? "Activée" : "Non activée"}</strong>. {profile?.mfa_enabled ? "Votre compte bénéficie d’une vérification supplémentaire." : "Nous vous recommandons de l’activer pour protéger les accès sensibles de votre rôle."}</p>
            </div>
            <Link href="/securite" className="member-security-link">{profile?.mfa_enabled ? "Gérer la sécurité" : "Configurer la protection"}<ArrowRight size={17} /></Link>
          </section>
        )}
      </div>
    </section>
  );
}
