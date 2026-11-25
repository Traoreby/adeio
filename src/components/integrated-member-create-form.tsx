"use client";

import { useActionState } from "react";
import { MailPlus, UserPlus } from "lucide-react";
import { createIntegratedMemberAction, type CreateMemberState } from "@/app/admin/member-actions";

const initialState: CreateMemberState = {};

export function IntegratedMemberCreateForm({ currentYear }: { currentYear: number }) {
  const [state, action, pending] = useActionState(createIntegratedMemberAction, initialState);

  return <form action={action} className="admin-form integrated-member-form">
    {state.error && <div role="alert" className="form-alert error-alert">{state.error}</div>}
    {state.confirmExisting && <div role="alert" className="form-alert info-alert"><strong>Un compte existe déjà pour {state.email}.</strong><span>Vérifiez qu’il s’agit bien du futur membre. Le système conservera son UUID, refusera tout compte déjà lié ou doté d’un rôle sensible, puis rattachera la fiche sans créer de doublon.</span></div>}
    <div className="admin-form-grid">
      <div><label htmlFor="integrated-email">Adresse e-mail personnelle *</label><input id="integrated-email" type="email" name="email" autoComplete="email" required maxLength={254} placeholder="membre@exemple.com" /></div>
      <div><label htmlFor="integrated-joined-year">Année d’adhésion initiale *</label><input id="integrated-joined-year" name="joined_year" type="number" min="1900" max={currentYear} defaultValue={currentYear} required /></div>
      <div><label htmlFor="integrated-first-name">Prénom(s) *</label><input id="integrated-first-name" name="first_name" autoComplete="given-name" required maxLength={100} /></div>
      <div><label htmlFor="integrated-last-name">Nom *</label><input id="integrated-last-name" name="last_name" autoComplete="family-name" required maxLength={100} /></div>
    </div>
    <input type="hidden" name="attach_existing" value={state.confirmExisting ? "1" : "0"} />
    <input type="hidden" name="confirmed_email" value={state.confirmExisting ? state.email ?? "" : ""} />
    <p className="admin-form-note">Le numéro ADEIO est attribué automatiquement. Les statuts, coordonnées privées, photo et informations de formation seront complétés par le membre ; son statut reste contrôlé par l’administration.</p>
    <button className="admin-submit" type="submit" disabled={pending}>{pending ? "Création en cours…" : state.confirmExisting ? "Rattacher ce compte et envoyer les instructions" : "Créer la fiche et envoyer l’invitation"}{state.confirmExisting ? <MailPlus size={16} /> : <UserPlus size={16} />}</button>
  </form>;
}
