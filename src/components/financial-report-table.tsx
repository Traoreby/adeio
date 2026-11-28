import { financialReportRubricLabel, type FinancialReportCell, type FinancialReportData, type FinancialReportSide } from "@/lib/financial-report";
import { Fragment } from "react";

function cellValue(cell: FinancialReportCell, key: keyof FinancialReportCell) {
  const value = cell[key];
  if (!value) return "—";
  return key === "amount" || key === "unitPrice" ? `₹ ${value}` : key === "percent" ? `${value}%` : value;
}

function SideTable({ title, side, sideKey }: { title: string; side: FinancialReportSide; sideKey: "emplois" | "ressources" }) {
  return <section className="financial-report-side financial-report-view-side">
    <h2 className="financial-report-side-heading">{title}</h2>
    <div className="financial-report-view-scroll"><table className="financial-report-view-table">
      <thead><tr><th>Libellés</th><th>Qté</th><th>P.U</th><th>Montant (ROUPÉE / INR ₹)</th><th>%</th></tr></thead>
      <tbody>
        {side.sections.map((section, index) => <Fragment key={section.key}>
          <tr className="financial-report-rubric"><th colSpan={5}>{financialReportRubricLabel(sideKey, index, section.title)}</th></tr>
          {section.rows.filter((row) => row.label || row.quantity || row.unitPrice || row.amount || row.percent).map((row, rowIndex) => <tr key={`${section.key}-${rowIndex}`}>
            <td>{row.label || "—"}</td><td>{row.quantity || "—"}</td><td>{cellValue(row, "unitPrice")}</td><td>{cellValue(row, "amount")}</td><td>{cellValue(row, "percent")}</td>
          </tr>)}
          <tr className="financial-report-subtotal"><th>{section.subtotal.label || `Sous-total ${section.title}`}</th><td>{section.subtotal.quantity || "—"}</td><td>{cellValue(section.subtotal, "unitPrice")}</td><td>{cellValue(section.subtotal, "amount")}</td><td>{cellValue(section.subtotal, "percent")}</td></tr>
        </Fragment>)}
        <tr className="financial-report-total"><th>{side.total.label || `TOTAL ${title}`}</th><td>{side.total.quantity || "—"}</td><td>{cellValue(side.total, "unitPrice")}</td><td>{cellValue(side.total, "amount")}</td><td>{cellValue(side.total, "percent")}</td></tr>
      </tbody>
    </table></div>
  </section>;
}

export function FinancialReportTable({ data }: { data: FinancialReportData }) {
  return <div className="financial-report-dual financial-report-view"><SideTable title="EMPLOIS" side={data.emplois} sideKey="emplois" /><SideTable title="RESSOURCES" side={data.ressources} sideKey="ressources" /></div>;
}
