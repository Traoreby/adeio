import type { Metadata } from "next";
import { ArrowUpRight, Newspaper, Pin, Plus } from "lucide-react";
import { createAnnouncementAction, setAnnouncementPinnedAction, setAnnouncementPublicationAction } from "@/app/admin/actions";
import { getSignedInUser } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Administration des annonces" };

const statusMessages: Record<string, string> = {
  "annonce-creee": "L’annonce a été enregistrée.",
  "publication-modifiee": "La visibilité de l’annonce a été mise à jour.",
  "annonce-modifiee": "L’annonce a été mise à jour.",
};
const errorMessages: Record<string, string> = {
  "formulaire-invalide": "Vérifiez les champs du formulaire.",
  "slug-existant": "Cette adresse est déjà utilisée. Choisissez un autre identifiant.",
  "creation-impossible": "L’annonce n’a pas pu être enregistrée.",
  "modification-impossible": "La modification n’a pas abouti.",
};

type PageProps = { searchParams: Promise<{ statut?: string; erreur?: string }> };

export default async function AdminAnnouncementsPage({ searchParams }: PageProps) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const { data } = await supabase.from("announcements").select("id,title,slug,is_published,is_pinned,visibility,published_at,created_at").order("created_at", { ascending: false });
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CONTENU DU SITE</div><h1>Annonces</h1><p>Rédigez, publiez et épinglez les informations ADEIO.</p></div><span className="admin-heading-mark"><Newspaper size={18} /></span></div>
    {params.statut && statusMessages[params.statut] && <div role="status" className="form-alert success-alert admin-banner">{statusMessages[params.statut]}</div>}
    {params.erreur && <div role="alert" className="form-alert error-alert admin-banner">{errorMessages[params.erreur] ?? "Une erreur est survenue."}</div>}
    <div className="admin-card"><h2><Plus size={16} /> Nouvelle annonce</h2><p>Les annonces sont affichées uniquement après publication. Le texte est rendu comme du texte brut afin d’éviter l’exécution de contenu HTML.</p><form action={createAnnouncementAction} className="admin-form">
      <div className="admin-form-grid"><div><label htmlFor="announcement-title">Titre</label><input id="announcement-title" name="title" required maxLength={140} placeholder="Ex. Assemblée générale annuelle" /></div><div><label htmlFor="announcement-slug">Identifiant URL</label><input id="announcement-slug" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="assemblee-generale-annuelle" /></div></div>
      <div><label htmlFor="announcement-summary">Résumé (facultatif)</label><input id="announcement-summary" name="summary" maxLength={280} placeholder="Quelques mots pour présenter l’annonce" /></div>
      <div><label htmlFor="announcement-body">Texte</label><textarea id="announcement-body" name="body" required minLength={10} placeholder="Rédigez le contenu de l’annonce…" /></div>
      <div className="admin-form-grid"><div><label htmlFor="announcement-visibility">Visibilité</label><select id="announcement-visibility" name="visibility" defaultValue="public"><option value="public">Public</option><option value="members">Membres connectés</option></select></div><div className="admin-option-stack"><label className="admin-form-checkbox"><input type="checkbox" name="is_published" /> Publier immédiatement</label><label className="admin-form-checkbox"><input type="checkbox" name="is_pinned" /> Épingler à la une</label></div></div>
      <Button type="submit" className="admin-submit">Enregistrer l’annonce <ArrowUpRight size={15} /></Button>
    </form></div>
    <div className="admin-card"><h2>Annonces enregistrées</h2><div className="admin-list">{data?.length ? data.map((item) => <div className="admin-list-row admin-announcement-row" key={item.id}><div><h3>{item.title}</h3><p>{item.visibility === "public" ? "Public" : "Membres"} · {item.published_at ? `Publiée le ${formatDate(item.published_at)}` : "Brouillon"}</p></div><div className="admin-row-actions"><span className={`status-chip ${item.is_published ? "" : "draft"}`}>{item.is_published ? "Publiée" : "Brouillon"}</span><form action={setAnnouncementPinnedAction}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="is_pinned" value={String(!item.is_pinned)} /><button className={`icon-action ${item.is_pinned ? "selected" : ""}`} type="submit" aria-label={item.is_pinned ? "Désépingler" : "Épingler"}><Pin size={14} /></button></form><form action={setAnnouncementPublicationAction}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="is_published" value={String(!item.is_published)} /><button className="text-action" type="submit">{item.is_published ? "Dépublier" : "Publier"}</button></form></div></div>) : <div className="admin-empty">Aucune annonce. Créez le premier contenu ci-dessus.</div>}</div></div>
  </>;
}
