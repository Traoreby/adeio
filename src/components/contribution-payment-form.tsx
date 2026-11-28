"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { recordContributionPaymentAction, setContributionDueConcernStatusAction } from "@/app/gestion-financiere/actions";
import { FinanceSubmitButton } from "@/components/finance-submit-button";

type MemberOption = { id: string; member_number: string; first_name: string; last_name: string };
type DueMonth = { due_id: string | null; month_number: number; month_due_inr: number; month_paid_inr: number; month_remaining_inr: number; payment_status: string };
type Props = { members: MemberOption[]; initialYear: number };

const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function ContributionPaymentForm({ members, initialYear }: Props) {
  const [memberId, setMemberId] = useState("");
  const [year, setYear] = useState(String(initialYear));
  const [months, setMonths] = useState<DueMonth[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [amountReceived, setAmountReceived] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [concernStatusMonth, setConcernStatusMonth] = useState<number | null>(null);
  const [concernReason, setConcernReason] = useState("");
  const [concernFeedback, setConcernFeedback] = useState("");
  const [concernFeedbackError, setConcernFeedbackError] = useState(false);
  const [isConcernPending, startConcernTransition] = useTransition();
  const requestKey = memberId && /^\d{4}$/.test(year) ? `${memberId}:${year}` : "";
  const loading = Boolean(requestKey && loadedKey !== requestKey);
  const visibleLoadError = requestKey && loadedKey === requestKey ? loadError : "";
  const [validationError, setValidationError] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const allocatedTotal = useMemo(() => Object.values(selected).reduce((sum, value) => sum + (Number(value) || 0), 0), [selected]);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    fetch(`/api/finances/contributions?member_id=${encodeURIComponent(memberId)}&year=${encodeURIComponent(year)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { months?: DueMonth[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Le détail des mois n’a pas pu être chargé.");
        if (controller.signal.aborted) return;
        setMonths(result.months ?? []);
        setLoadError("");
        setLoadedKey(requestKey);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "Le détail des mois n’a pas pu être chargé.");
        setLoadedKey(requestKey);
      });
    return () => controller.abort();
  }, [memberId, requestKey, year, reloadVersion]);

  const allocations = Object.entries(selected).filter(([, amount]) => Number(amount) > 0).map(([dueId, amount]) => ({ due_id: dueId, amount_inr: Number(amount) }));
  const allocationJson = JSON.stringify(allocations);

  function toggleMonth(row: DueMonth, checked: boolean) {
    if (!row.due_id) return;
    setValidationError("");
    setSelected((current) => {
      const next = { ...current };
      if (checked) next[row.due_id!] = "";
      else delete next[row.due_id!];
      return next;
    });
  }

  function changeAllocation(row: DueMonth, value: string) {
    if (!row.due_id) return;
    const digits = value.replace(/\D/g, "").slice(0, 13);
    setSelected((current) => ({ ...current, [row.due_id!]: digits }));
    setValidationError("");
  }

  function changeMonthConcernStatus(month: DueMonth) {
    if (!month.due_id || isConcernPending || !concernReason.trim()) return;
    const isNotConcerned = month.payment_status !== "not_concerned";
    startConcernTransition(async () => {
      const result = await setContributionDueConcernStatusAction({ dueId: month.due_id!, isNotConcerned, reason: concernReason });
      setConcernFeedback(result.message);
      setConcernFeedbackError(!result.ok);
      if (!result.ok) return;
      setSelected((current) => {
        const next = { ...current };
        delete next[month.due_id!];
        return next;
      });
      setAmountReceived("");
      setConcernStatusMonth(null);
      setConcernReason("");
      setLoadedKey("");
      setReloadVersion((current) => current + 1);
    });
  }

  function validate(formData: FormData) {
    if (loading) { setValidationError("Attendez le chargement des soldes mensuels."); return false; }
    if (Object.values(selected).some((amount) => !Number.isInteger(Number(amount)) || Number(amount) <= 0)) {
      setValidationError("Saisissez manuellement un montant positif pour chaque mois sélectionné."); return false;
    }
    if (!allocations.length) { setValidationError("Sélectionnez au moins un mois et indiquez sa répartition."); return false; }
    if (allocations.some((allocation) => allocation.amount_inr > (months.find((month) => month.due_id === allocation.due_id)?.month_remaining_inr ?? 0))) {
      setValidationError("Une répartition dépasse le solde restant du mois sélectionné."); return false;
    }
    if (!Number.isSafeInteger(Number(amountReceived)) || Number(amountReceived) <= 0 || Number(amountReceived) !== allocatedTotal) {
      setValidationError("Le montant reçu doit être égal à la somme des montants répartis."); return false;
    }
    formData.set("allocations_json", allocationJson);
    return true;
  }

  return <form action={recordContributionPaymentAction} className="admin-form finance-form" onSubmit={(event) => {
    const formData = new FormData(event.currentTarget);
    if (!validate(formData)) { event.preventDefault(); return; }
    const hidden = event.currentTarget.querySelector<HTMLInputElement>('input[name="allocations_json"]');
    if (hidden) hidden.value = allocationJson;
  }}>
    <input type="hidden" name="allocations_json" value={allocationJson} readOnly />
    <input type="hidden" name="financial_year" value={year} />
    <div><label htmlFor="payment-member">Membre</label><select id="payment-member" name="member_id" required value={memberId} onChange={(event) => { setMemberId(event.target.value); setSelected({}); setAmountReceived(""); setLoadedKey(""); setValidationError(""); setConcernStatusMonth(null); setConcernReason(""); setConcernFeedback(""); }}><option value="">Choisir un membre actif</option>{members.map((member) => <option value={member.id} key={member.id}>{member.member_number} · {member.first_name} {member.last_name}</option>)}</select></div>
    <div className="admin-form-grid"><div><label htmlFor="payment-financial-year">Année financière</label><input id="payment-financial-year" type="number" min="1900" max="2200" required value={year} onChange={(event) => { setYear(event.target.value); setSelected({}); setAmountReceived(""); setLoadedKey(""); setValidationError(""); setConcernStatusMonth(null); setConcernReason(""); setConcernFeedback(""); }} /></div><div><label htmlFor="payment-date">Date du paiement</label><input id="payment-date" name="paid_on" type="date" required value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></div></div>
    <div className="admin-form-grid"><div><label htmlFor="payment-method">Mode de paiement</label><select id="payment-method" name="payment_method" required defaultValue="cash"><option value="cash">Espèces</option><option value="online">Online</option></select></div><div><label htmlFor="payment-amount">Montant total reçu (INR)</label><input id="payment-amount" name="amount_inr" type="number" min="1" max="1000000000000" step="1" required value={amountReceived} onChange={(event) => { setAmountReceived(event.target.value); setValidationError(""); }} placeholder="Ex. 1200" /></div></div>
    <fieldset className="contribution-month-picker"><legend>Mois concernés et répartition (INR)</legend>
      {loading && <p role="status">Chargement des soldes mensuels…</p>}
      {visibleLoadError && <p role="alert" className="form-error">{visibleLoadError}</p>}
      {!loading && !visibleLoadError && months.map((month) => {
        const checked = Boolean(month.due_id && Object.hasOwn(selected, month.due_id));
        const isNotConcerned = month.payment_status === "not_concerned";
        const hasPayment = month.payment_status === "partial" || month.payment_status === "paid";
        const changingStatus = concernStatusMonth === month.month_number;
        return <div className="contribution-month-row" key={month.month_number}>
          <label><input type="checkbox" disabled={!month.due_id || isNotConcerned || month.month_remaining_inr <= 0} checked={checked} onChange={(event) => toggleMonth(month, event.target.checked)} /> <span>{monthNames[month.month_number - 1]}{isNotConcerned ? " · Non concerné" : ""}</span></label>
          <span>{isNotConcerned ? "Non concerné · 0 ₹ dû" : `Dû ${month.month_due_inr.toLocaleString("en-IN")} · payé ${month.month_paid_inr.toLocaleString("en-IN")} · reste ${month.month_remaining_inr.toLocaleString("en-IN")} ₹`}</span>
          <input aria-label={`Montant affecté à ${monthNames[month.month_number - 1]}`} type="number" min="1" max={month.month_remaining_inr} step="1" disabled={!checked || isNotConcerned} value={checked ? selected[month.due_id!] : ""} onChange={(event) => changeAllocation(month, event.target.value)} />
          {month.due_id && (hasPayment || month.payment_status === "unpaid" || isNotConcerned) && <div className="contribution-exemption-control">
            {hasPayment ? <small>Un mois avec un paiement ne peut pas être marqué non concerné.</small> : <>
              <button type="button" className="text-link contribution-status-button" disabled={isConcernPending} onClick={() => { setConcernStatusMonth(changingStatus ? null : month.month_number); setConcernReason(""); setConcernFeedback(""); setConcernFeedbackError(false); }}>
                {isNotConcerned ? "Rétablir le mois" : "Marquer non concerné"}
              </button>
              {changingStatus && <div className="contribution-status-reason"><label htmlFor={`concern-reason-${month.month_number}`}>Motif de la décision</label><input id={`concern-reason-${month.month_number}`} type="text" maxLength={500} minLength={3} required value={concernReason} onChange={(event) => setConcernReason(event.target.value)} placeholder="Ex. Le membre a rejoint ADEIO en novembre." /><button type="button" className="admin-submit admin-submit-secondary" disabled={isConcernPending || concernReason.trim().length < 3} onClick={() => changeMonthConcernStatus(month)}>{isConcernPending ? "Enregistrement…" : "Confirmer"}</button></div>}
            </>}
          </div>}
        </div>;
      })}
      {!memberId && !loading && <p>Choisissez un membre pour afficher ses soldes mensuels.</p>}
      {memberId && !loading && !visibleLoadError && months.every((month) => !month.due_id) && <p>Aucune échéance INR n’a été générée pour cette année. Générez d’abord les mois depuis le plan de cotisation.</p>}
    </fieldset>
    {concernFeedback && <p role={concernFeedbackError ? "alert" : "status"} className={concernFeedbackError ? "form-error" : "form-success"}>{concernFeedback}</p>}
    <p className="contribution-allocation-total">Total réparti : <strong>{allocatedTotal.toLocaleString("en-IN")} ₹</strong></p>
    <div><label htmlFor="payment-note">Commentaire (facultatif)</label><textarea id="payment-note" name="note" maxLength={500} /></div>
    {validationError && <p role="alert" className="form-error">{validationError}</p>}
    <FinanceSubmitButton pendingLabel="Enregistrement…">Enregistrer le paiement</FinanceSubmitButton>
  </form>;
}
