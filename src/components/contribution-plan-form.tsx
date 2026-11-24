"use client";

import { useState } from "react";
import { createContributionPlanAction } from "@/app/gestion-financiere/actions";
import { FinanceSubmitButton } from "@/components/finance-submit-button";

export function ContributionPlanForm() {
  const [periodicity, setPeriodicity] = useState("monthly");
  const [amount, setAmount] = useState("");

  function updateAmount(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 13);
    setAmount(digits ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(digits)) : "");
  }

  return <form action={createContributionPlanAction} className="admin-form finance-form">
    <div className="admin-form-grid">
      <div><label htmlFor="plan-name">Nom du plan</label><input id="plan-name" name="name" required minLength={3} maxLength={120} placeholder="Ex. Cotisation annuelle 2027" /></div>
      <div><label htmlFor="plan-amount">Montant dû par période (FCFA)</label><input id="plan-amount" name="amount_fcfa" type="text" inputMode="numeric" autoComplete="off" maxLength={20} required value={amount} onChange={(event) => updateAmount(event.target.value)} placeholder="Ex. 5 000" aria-describedby="plan-amount-help" /><small id="plan-amount-help">Les milliers sont séparés automatiquement.</small></div>
    </div>
    <div className="admin-form-grid">
      <div><label htmlFor="plan-periodicity">Périodicité</label><select id="plan-periodicity" name="periodicity" value={periodicity} onChange={(event) => setPeriodicity(event.target.value)}><option value="monthly">Mensuelle</option><option value="yearly">Annuelle</option><option value="custom">Personnalisée (jours)</option></select></div>
      {periodicity === "custom" && <div><label htmlFor="custom-period-days">Nombre de jours</label><input id="custom-period-days" name="custom_period_days" type="number" min="1" max="3650" required placeholder="Ex. 30" /></div>}
    </div>
    <div className="admin-form-grid"><div><label htmlFor="plan-starts">Date de début</label><input id="plan-starts" name="starts_on" type="date" required /></div><div><label htmlFor="plan-ends">Date de fin (facultatif)</label><input id="plan-ends" name="ends_on" type="date" /></div></div>
    <p className="form-helper">La génération crée une seule fois les périodes dues pour chaque membre actif, à partir de son année d’adhésion. Les périodes déjà présentes ne sont pas dupliquées.</p>
    <FinanceSubmitButton pendingLabel="Création du plan…">Créer le plan</FinanceSubmitButton>
  </form>;
}
