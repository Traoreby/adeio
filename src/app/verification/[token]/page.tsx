import type { Metadata } from "next";
import { BadgeCheck, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConsentedMemberPhotoUrl } from "@/lib/supabase/service";
import Image from "next/image";

export const metadata: Metadata = { title: "Vérification de carte membre" };
type Props = { params: Promise<{ token: string }> };
type Verification = { member_number: string; full_name: string; status: "actif" | "ancien" | "non_actif"; position: string | null; photo_path: string | null };

export default async function VerificationPage({ params }: Props) {
  const { token } = await params;
  let member: Verification | null = null;
  const available = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (available && /^[A-Za-z0-9_-]{22,128}$/.test(token)) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data, error } = await supabase.rpc("verify_member_qr", { p_token: token });
      if (!error && Array.isArray(data) && data.length) member = data[0] as Verification;
    }
  }
  const active = member?.status === "actif";
  const photoUrl = member?.photo_path ? await getConsentedMemberPhotoUrl(member.photo_path) : null;
  return <section className="verification-page section-pad"><div className="container verification-container"><div className="verification-brand"><span className="verification-logo">ADEIO</span><span>Vérification officielle</span></div>{member ? <div className="verification-card"><span className={`verification-state ${active ? "verified" : "inactive"}`}>{active ? <ShieldCheck size={17} /> : <ShieldAlert size={17} />}{active ? "Membre actif" : member.status === "ancien" ? "Ancien membre · a quitté l’association" : "Membre non actif"}</span><div className="verification-avatar">{photoUrl ? <Image src={photoUrl} alt={`Photo de ${member.full_name}`} fill sizes="96px" /> : <UserRound size={34} />}</div><div className="eyebrow eyebrow-green">IDENTITÉ MEMBRE</div><h1>{member.full_name}</h1><p className="verification-number">{member.member_number}</p>{member.position && <p className="verification-position"><BadgeCheck size={15} /> {member.position}</p>}<p className="verification-disclaimer">Cette page confirme uniquement les informations affichées ci-dessus. Aucune coordonnée personnelle n’est publiée.</p></div> : <div className="verification-card verification-invalid"><span className="verification-state invalid"><ShieldAlert size={17} />{available ? "QR Code invalide ou désactivé" : "Vérification en cours de configuration"}</span><div className="verification-invalid-icon"><ShieldAlert size={28} /></div><h1>{available ? "Cette carte ne peut pas être vérifiée." : "Service momentanément indisponible."}</h1><p>{available ? "Le jeton n’est pas reconnu ou a été désactivé par l’association. Contactez ADEIO pour obtenir de l’aide." : "La vérification sera activée lorsque le projet Supabase de l’association sera connecté."}</p></div>}<div className="verification-footer">ADEIO · KIIT, Odisha</div></div></section>;
}
