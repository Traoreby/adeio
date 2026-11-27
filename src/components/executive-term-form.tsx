"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { startExecutiveTermAction } from "@/app/admin/actions";
import { getExecutiveTermEnd, getExecutiveTermTitle } from "@/lib/executive-terms";
import { Button } from "@/components/ui/button";

function displayDate(value: string) {
  if (!value) return "Calculée automatiquement";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function ExecutiveTermForm() {
  const [startsOn, setStartsOn] = useState("");
  const endsOn = useMemo(() => getExecutiveTermEnd(startsOn), [startsOn]);
  const title = useMemo(() => getExecutiveTermTitle(startsOn, endsOn), [startsOn, endsOn]);

  return <form action={startExecutiveTermAction} className="admin-form">
    <div className="admin-form-grid">
      <div>
        <label htmlFor="term-start">Date de début</label>
        <input
          id="term-start"
          name="starts_on"
          type="date"
          required
          value={startsOn}
          onChange={(event) => setStartsOn(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="term-title-preview">Nom du mandat</label>
        <input id="term-title-preview" value={title} readOnly aria-live="polite" />
      </div>
    </div>
    <div className="admin-form-grid">
      <div>
        <label htmlFor="term-end-preview">Date de fin calculée</label>
        <input id="term-end-preview" value={displayDate(endsOn)} readOnly aria-live="polite" />
      </div>
      <div className="form-helper"><CalendarDays size={16} /> Un mandat dure 12 mois, jusqu’à la veille de sa date anniversaire. Son historique et ses affectations sont conservés.</div>
    </div>
    <Button type="submit" className="admin-submit" disabled={!startsOn}>Créer le mandat <ArrowUpRight size={15} /></Button>
  </form>;
}
