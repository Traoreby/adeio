"use client";

import { useMemo, useState } from "react";
import { createContributionPlanAction } from "@/app/gestion-financiere/actions";
import { FinanceSubmitButton } from "@/components/finance-submit-button";

export type ContributionTermOption = { id: string; title: string; starts_on: string; ends_on: string };

export function ContributionPlanForm({ terms }: { terms: ContributionTermOption[] }) {
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const selectedTerm = terms.find((term) => term.id === termId);
  const planName = useMemo(() => selectedTerm ? `Cotisation – ${selectedTerm.title}` : "Sélectionnez un mandat", [selectedTerm]);
  function updateAmount(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 13);
    setAmount(digits ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(digits)) : "");
  }
  const dateLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

  if (!terms.length) return <p className="admin-empty">Aucun mandat disponible sans plan. Créez d’abord un mandat du Bureau exécutif.</p>;

  return <form action={createContributionPlanAction} className="admin-form finance-form">
    <div className="admin-form-grid">
      <div><label htmlFor="plan-term">Mandat concerné</label><select id="plan-term" name="term_id" required value={termId} onChange={(event) => setTermId(event.target.value)}>{terms.map((term) => <option key={term.id} value={term.id}>{term.title} · {dateLabel(term.starts_on)} — {dateLabel(term.ends_on)}</option>)}</select></div>
      <div><label htmlFor="plan-amount">Montant mensuel (INR)</label><input id="plan-amount" name="amount_inr" type="text" inputMode="numeric" autoComplete="off" maxLength={20} required value={amount} onChange={(event) => updateAmount(event.target.value)} placeholder="Ex. 500" /></div>
    </div>
    <div className="admin-form-grid"><div><label>Nom généré automatiquement</label><output className="reference-readonly">{planName}</output></div><div><label>Période du plan</label><output className="reference-readonly">{selectedTerm ? `${dateLabel(selectedTerm.starts_on)} — ${dateLabel(selectedTerm.ends_on)}` : "—"}</output></div></div>
    <p className="form-helper">Un plan unique couvre les 12 mois exacts du mandat. Le nom et les dates sont établis par la base de données.</p>
    <FinanceSubmitButton pendingLabel="Création du plan…">Créer le plan du mandat</FinanceSubmitButton>
  </form>;
}
