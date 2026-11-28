import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Plus, Search, University } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import {
  createInstitutionAction,
  createStudyProgramAction,
  setInstitutionActiveAction,
  setStudyProgramActiveAction,
  updateInstitutionAction,
  updateStudyProgramAction,
} from "@/app/admin/reference-actions";

export const metadata: Metadata = { title: "Référentiels ADEIO" };
type Props = { searchParams: Promise<{ filiere?: string; etablissement?: string; statut?: string }> };

const feedback: Record<string, string> = {
  "filiere-enregistre": "La filière a été enregistrée.",
  "filiere-desactive": "La filière a été désactivée ; les fiches historiques sont conservées.",
  "filiere-reactive": "La filière est de nouveau disponible.",
  "filiere-doublon": "Une filière identique existe déjà, même avec des espaces ou une casse différents.",
  "filiere-impossible": "La filière n’a pas pu être enregistrée. Vérifiez son nom et réessayez.",
  "etablissement-enregistre": "L’établissement a été enregistré.",
  "etablissement-desactive": "L’établissement a été désactivé ; les fiches historiques sont conservées.",
  "etablissement-reactive": "L’établissement est de nouveau disponible.",
  "etablissement-doublon": "Un établissement identique existe déjà, même avec des espaces ou une casse différents.",
  "etablissement-impossible": "L’établissement n’a pas pu être enregistré. Vérifiez son nom et réessayez.",
};

export default async function MemberReferencesPage({ searchParams }: Props) {
  const [{ supabase, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase || !roles.includes("super_admin")) return null;
  const programSearch = params.filiere?.trim().slice(0, 80) ?? "";
  const institutionSearch = params.etablissement?.trim().slice(0, 80) ?? "";
  const [{ data: programs }, { data: institutions }] = await Promise.all([
    (() => {
      let query = supabase.from("study_programs").select("id,name,is_active").order("normalized_name").limit(200);
      if (programSearch) query = query.ilike("name", `%${programSearch}%`);
      return query;
    })(),
    (() => {
      let query = supabase.from("member_institutions").select("id,name,is_active").order("normalized_name").limit(200);
      if (institutionSearch) query = query.ilike("name", `%${institutionSearch}%`);
      return query;
    })(),
  ]);

  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">CONFIGURATION · SUPER ADMIN</div><h1>Gestion des référentiels</h1><p>Les profils proposent uniquement les filières et établissements actifs. Les options utilisées ne sont jamais supprimées.</p></div><Link href="/admin/parametres" className="text-link"><ArrowLeft size={15} /> Paramètres</Link></div>
    {params.statut && feedback[params.statut] && <p role="status" className={params.statut.endsWith("-impossible") || params.statut.endsWith("-doublon") ? "form-error" : "form-success"}>{feedback[params.statut]}</p>}

    <section className="admin-card">
      <div className="admin-card-heading"><div><h2>Filières</h2><p>Ajoutez, renommez ou désactivez une filière.</p></div></div>
      <form action={createStudyProgramAction} className="admin-setting-form"><label htmlFor="new-study-program">Ajouter une filière</label><div className="admin-form-grid"><input id="new-study-program" name="name" required minLength={2} maxLength={160} placeholder="Ex. Computer Science" /><button className="admin-submit" type="submit"><Plus size={15} /> Ajouter</button></div></form>
      <form method="get" className="finance-filter-bar"><label>Rechercher une filière<input name="filiere" defaultValue={programSearch} placeholder="Nom de la filière" /></label><button className="admin-submit admin-submit-secondary" type="submit"><Search size={15} /> Rechercher</button></form>
      <div className="admin-list">{(programs ?? []).map((program) => <div className="admin-list-row" key={program.id}>
        <form action={updateStudyProgramAction} className="reference-edit-row"><input type="hidden" name="id" value={program.id} /><label className="sr-only" htmlFor={`program-${program.id}`}>Nom de la filière</label><input id={`program-${program.id}`} name="name" required minLength={2} maxLength={160} defaultValue={program.name} /><span className={`status-chip ${program.is_active ? "" : "draft"}`}>{program.is_active ? "Active" : "Inactive"}</span><button className="admin-submit admin-submit-secondary" type="submit">Enregistrer</button></form>
        <form action={setStudyProgramActiveAction}><input type="hidden" name="id" value={program.id} /><input type="hidden" name="active" value={String(!program.is_active)} /><button className="text-link" type="submit">{program.is_active ? "Désactiver" : "Réactiver"}</button></form>
      </div>)}{!programs?.length && <p className="admin-empty">Aucune filière trouvée.</p>}</div>
    </section>

    <section className="admin-card">
      <div className="admin-card-heading"><div><h2><University size={18} /> Établissements</h2><p>Chaque établissement est enregistré une seule fois et peut être désactivé sans supprimer son historique.</p></div></div>
      <form action={createInstitutionAction} className="admin-setting-form"><label htmlFor="new-institution">Ajouter un établissement</label><div className="admin-form-grid"><input id="new-institution" name="name" required minLength={2} maxLength={200} placeholder="Ex. KIIT University" /><button className="admin-submit" type="submit"><Plus size={15} /> Ajouter</button></div></form>
      <form method="get" className="finance-filter-bar"><label>Rechercher un établissement<input name="etablissement" defaultValue={institutionSearch} placeholder="Nom de l’établissement" /></label><button className="admin-submit admin-submit-secondary" type="submit"><Search size={15} /> Rechercher</button></form>
      <div className="admin-list">{(institutions ?? []).map((institution) => <div className="admin-list-row" key={institution.id}>
        <form action={updateInstitutionAction} className="reference-edit-row"><input type="hidden" name="id" value={institution.id} /><label className="sr-only" htmlFor={`institution-${institution.id}`}>Nom de l’établissement</label><input id={`institution-${institution.id}`} name="name" required minLength={2} maxLength={200} defaultValue={institution.name} /><span className={`status-chip ${institution.is_active ? "" : "draft"}`}>{institution.is_active ? "Actif" : "Inactif"}</span><button className="admin-submit admin-submit-secondary" type="submit">Enregistrer</button></form>
        <form action={setInstitutionActiveAction}><input type="hidden" name="id" value={institution.id} /><input type="hidden" name="active" value={String(!institution.is_active)} /><button className="text-link" type="submit">{institution.is_active ? "Désactiver" : "Réactiver"}</button></form>
      </div>)}{!institutions?.length && <p className="admin-empty">Aucun établissement trouvé.</p>}</div>
    </section>
  </>;
}
