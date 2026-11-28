"use client";

import { useState } from "react";
import { createContributionPlanAction } from "@/app/gestion-financiere/actions";
import { FinanceSubmitButton } from "@/components/finance-submit-button";

export function ContributionPlanForm() {
  const [amount, setAmount] = useState("");
  const currentYear = new Date().getFullYear();

  function updateAmount(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 13);
    setAmount(digits ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(digits)) : "");
  }

  return <form action={createContributionPlanAction} className="admin-form finance-form">
    <div className="admin-form-grid">
      <div><label htmlFor="plan-name">Nom du plan</label><input id="plan-name" name="name" required minLength={3} maxLength={120} placeholder="Ex. Cotisation ADEIO 2027" /></div>
      <div><label htmlFor="plan-amount">Montant mensuel (INR)</label><input id="plan-amount" name="amount_inr" type="text" inputMode="numeric" autoComplete="off" maxLength={20} required value={amount} onChange={(event) => updateAmount(event.target.value)} placeholder="Ex. 500" /></div>
    </div>
    <div className="admin-form-grid">
      <div><label htmlFor="plan-year">Année financière</label><input id="plan-year" name="financial_year" type="number" min="1900" max="2200" required defaultValue={currentYear} /></div>
      <p className="form-helper">Le plan couvre janvier à décembre. Les échéances sont créées une fois par membre et par mois.</p>
    </div>
    <FinanceSubmitButton pendingLabel="Création du plan…">Créer le plan INR</FinanceSubmitButton>
  </form>;
}
