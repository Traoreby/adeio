"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FinanceSubmitButton } from "@/components/finance-submit-button";
import { financialReportRubricLabel, type FinancialReportCell, type FinancialReportData, type FinancialReportSection } from "@/lib/financial-report";

type ServerAction = (formData: FormData) => void | Promise<void>;
type Props = {
  reportId: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  initialData: FinancialReportData;
  saveAction: ServerAction;
  publishAction: ServerAction;
  error?: string;
};

const columns: { key: keyof FinancialReportCell; title: string }[] = [
  { key: "label", title: "Libellés" },
  { key: "quantity", title: "Qté" },
  { key: "unitPrice", title: "P.U" },
  { key: "amount", title: "Montant (ROUPÉE / INR ₹)" },
  { key: "percent", title: "%" },
];

export function FinancialReportEditor(props: Props) {
  const [data, setData] = useState(props.initialData);
  const updateCell = (side: "emplois" | "ressources", sectionIndex: number, rowIndex: number | "subtotal" | "total", key: keyof FinancialReportCell, value: string) => {
    setData((current) => {
      const next = structuredClone(current);
      if (rowIndex === "total") next[side].total[key] = value;
      else if (rowIndex === "subtotal") next[side].sections[sectionIndex].subtotal[key] = value;
      else next[side].sections[sectionIndex].rows[rowIndex][key] = value;
      return next;
    });
  };
  const addRow = (side: "emplois" | "ressources", sectionIndex: number) => setData((current) => {
    const next = structuredClone(current);
    next[side].sections[sectionIndex].rows.push({ label: "", quantity: "", unitPrice: "", amount: "", percent: "" });
    return next;
  });
  const removeRow = (side: "emplois" | "ressources", sectionIndex: number, rowIndex: number) => setData((current) => {
    const next = structuredClone(current);
    next[side].sections[sectionIndex].rows.splice(rowIndex, 1);
    return next;
  });

  const renderCell = (side: "emplois" | "ressources", sectionIndex: number, rowIndex: number | "subtotal" | "total", cell: FinancialReportCell) => (
    <div className="financial-report-input-row" key={`${side}-${sectionIndex}-${rowIndex}`}>
      {columns.map(({ key, title }) => <label className={key === "label" ? "financial-report-label-cell" : ""} key={key}>
        <span>{title}</span>
        <input
          aria-label={`${title} — ${cell.label || "ligne"}`}
          inputMode={key === "label" ? undefined : "decimal"}
          type={key === "label" ? "text" : "number"}
          min={key === "percent" ? 0 : undefined}
          step={key === "percent" ? "0.01" : "any"}
          value={cell[key]}
          onChange={(event) => updateCell(side, sectionIndex, rowIndex, key, event.target.value)}
          placeholder={key === "label" ? "Libellé libre" : "—"}
        />
      </label>)}
      {typeof rowIndex === "number" && <button type="button" className="financial-report-icon-button" onClick={() => removeRow(side, sectionIndex, rowIndex)} aria-label="Supprimer cette ligne" title="Supprimer cette ligne"><Trash2 size={16} /></button>}
    </div>
  );

  const renderSide = (side: "emplois" | "ressources", sections: FinancialReportSection[]) => <section className="financial-report-side financial-report-edit-side"><div className="financial-report-side-inner">
    <h2 className="financial-report-side-heading">{side === "emplois" ? "EMPLOIS" : "RESSOURCES"}</h2>
    <div className="financial-report-column-head" aria-hidden="true">{columns.map((column) => <span key={column.key}>{column.title}</span>)}<span /> </div>
    {sections.map((section, sectionIndex) => <fieldset className="financial-report-section" key={section.key}>
      <legend>{financialReportRubricLabel(side, sectionIndex, section.title)}</legend>
      {section.rows.map((row, rowIndex) => renderCell(side, sectionIndex, rowIndex, row))}
      <button type="button" className="button-secondary financial-report-add-row" onClick={() => addRow(side, sectionIndex)}><Plus size={15} /> Ajouter une ligne</button>
      <div className="financial-report-subtotal-label">Sous-total à saisir manuellement</div>
      {renderCell(side, sectionIndex, "subtotal", section.subtotal)}
    </fieldset>)}
    <div className="financial-report-grand-total"><strong>TOTAL GÉNÉRAL — à saisir</strong>{renderCell(side, -1, "total", data[side].total)}</div>
  </div></section>;

  return <form action={props.saveAction} className="financial-report-editor">
    <input type="hidden" name="report_id" value={props.reportId} />
    <input type="hidden" name="title" value={props.title} />
    <input type="hidden" name="period_start" value={props.periodStart} />
    <input type="hidden" name="period_end" value={props.periodEnd} />
    <input type="hidden" name="report_data" value={JSON.stringify(data)} />
    {props.error && <p role="alert" className="form-error finance-alert">{props.error}</p>}
    <p className="financial-report-manual-note">Tous les montants, pourcentages et sous-totaux sont saisis manuellement. ADEIO ne récupère et ne recalcule aucune opération financière dans ce rapport.</p>
    <div className="financial-report-dual">{renderSide("emplois", data.emplois.sections)}{renderSide("ressources", data.ressources.sections)}</div>
    <div className="financial-report-editor-actions"><FinanceSubmitButton pendingLabel="Enregistrement…" secondary>Enregistrer le brouillon</FinanceSubmitButton><FinanceSubmitButton pendingLabel="Publication…" formAction={props.publishAction}>Publier le rapport</FinanceSubmitButton></div>
  </form>;
}
