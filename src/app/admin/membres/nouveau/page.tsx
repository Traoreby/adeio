import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
import { createMemberAction } from "@/app/admin/member-actions";
import { getSignedInUser } from "@/lib/auth";
import { MemberPhotoInput } from "@/components/member-photo-input";

export const metadata: Metadata = { title: "Nouveau membre · Administration" };
type Props = { searchParams: Promise<{ erreur?: string }> };

export default async function NewMemberPage({ searchParams }: Props) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const { data: profiles } = await supabase.from("profiles").select("user_id,display_name").order("display_name").limit(100);
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">FICHES ET ARCHIVES</div><h1>Nouveau membre</h1><p>Les numéros ADEIO sont générés automatiquement.</p></div><Link href="/admin/membres" className="text-link"><ArrowLeft size={15} /> Retour aux membres</Link></div>
    {params.erreur && <div role="alert" className="form-alert error-alert admin-banner">{params.erreur === "formulaire-invalide" ? "Vérifiez les champs et les dates." : params.erreur === "photo-invalide" ? "La photo doit être compressée en WebP ou JPEG et peser 500 Ko maximum." : params.erreur === "photo-impossible" ? "La fiche a été annulée, car la photo n’a pas pu être enregistrée." : "La fiche n’a pas pu être créée. Réessayez."}</div>}
    <div className="admin-card"><h2><UserPlus size={16} /> Informations du membre</h2><form action={createMemberAction} className="admin-form">
      <div className="admin-form-grid"><div><label htmlFor="first_name">Prénoms</label><input id="first_name" name="first_name" required maxLength={100} /></div><div><label htmlFor="last_name">Nom</label><input id="last_name" name="last_name" required maxLength={100} /></div></div>
      <div className="admin-form-grid"><div><label htmlFor="joined_year">Année d’adhésion</label><input id="joined_year" name="joined_year" type="number" min="1900" max="2200" required defaultValue={new Date().getFullYear()} /></div><div><label htmlFor="exit_year">Année de sortie (facultative)</label><input id="exit_year" name="exit_year" type="number" min="1900" max="2200" /></div></div>
      <div className="admin-form-grid"><div><label htmlFor="status">Statut</label><select id="status" name="status" defaultValue="active"><option value="active">Actif</option><option value="former">Ancien membre</option><option value="suspended">Suspendu</option><option value="deceased">Décédé</option></select></div><div><label htmlFor="user_id">Compte membre lié (facultatif)</label><select id="user_id" name="user_id" defaultValue=""><option value="">Aucun compte lié</option>{profiles?.map((profile) => <option key={profile.user_id} value={profile.user_id}>{profile.display_name || profile.user_id}</option>)}</select></div></div>
      <div className="admin-form-grid"><div><label htmlFor="email">Adresse e-mail (facultative)</label><input id="email" name="email" type="email" maxLength={254} /></div><div><label htmlFor="phone">Téléphone (facultatif)</label><input id="phone" name="phone" type="tel" maxLength={40} /></div></div>
      <MemberPhotoInput />
      <label className="admin-form-checkbox"><input type="checkbox" name="photo_public_consent" /> Le membre consent à l’affichage public de sa photo sur la vérification QR.</label>
      <button className="admin-submit" type="submit">Créer la fiche <UserPlus size={15} /></button>
    </form></div>
  </>;
}
