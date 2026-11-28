export type FinancialReportCell = {
  label: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  percent: string;
};

export type FinancialReportSection = {
  key: string;
  title: string;
  rows: FinancialReportCell[];
  subtotal: FinancialReportCell;
};

export type FinancialReportSide = {
  sections: FinancialReportSection[];
  total: FinancialReportCell;
};

export type FinancialReportData = {
  emplois: FinancialReportSide;
  ressources: FinancialReportSide;
};

export const FINANCIAL_REPORT_SECTIONS = {
  emplois: [
    "Dépenses mensuelles",
    "Charges d'activités et d'actions",
    "Projets",
    "Autofinancement",
    "Créances",
    "Dépenses diverses",
  ],
  ressources: [
    "Solde antérieur",
    "Cotisations mensuelles",
    "Produits d'activités et d'actions",
    "Projets",
    "Autofinancement",
    "Recouvrement de créances",
    "Recettes diverses",
  ],
} as const;

function emptyCell(label = ""): FinancialReportCell {
  return { label, quantity: "", unitPrice: "", amount: "", percent: "" };
}

export function createBlankFinancialReportData(): FinancialReportData {
  return {
    emplois: {
      sections: FINANCIAL_REPORT_SECTIONS.emplois.map((title, index) => ({
        key: `emploi-${index + 1}`,
        title,
        rows: [emptyCell(), emptyCell(), emptyCell()],
        subtotal: emptyCell(`Sous-total ${title}`),
      })),
      total: emptyCell("TOTAL EMPLOIS"),
    },
    ressources: {
      sections: FINANCIAL_REPORT_SECTIONS.ressources.map((title, index) => ({
        key: `ressource-${index + 1}`,
        title,
        rows: [emptyCell(), emptyCell(), emptyCell()],
        subtotal: emptyCell(`Sous-total ${title}`),
      })),
      total: emptyCell("TOTAL RESSOURCES"),
    },
  };
}

export function financialReportTitle(start: string, end: string) {
  const display = (value: string) => {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  };
  return `RAPPORT FINANCIER ${display(start)} AU ${display(end)}`;
}

export function financialReportRubricLabel(side: "emplois" | "ressources", index: number, title: string) {
  if (side === "ressources") return index === 0 ? title : `${index}. ${title}`;
  return `${index + 1}. ${title}`;
}

export function reportCellHasValue(cell: FinancialReportCell) {
  return Boolean(cell.label || cell.quantity || cell.unitPrice || cell.amount || cell.percent);
}

export function isFinancialReportData(value: unknown): value is FinancialReportData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<FinancialReportData>;
  for (const sideName of ["emplois", "ressources"] as const) {
    const side = data[sideName];
    if (!side || !Array.isArray(side.sections) || !isReportCell(side.total)) return false;
    if (!side.sections.every((section) => typeof section.key === "string" && typeof section.title === "string"
      && Array.isArray(section.rows) && section.rows.every(isReportCell) && isReportCell(section.subtotal))) return false;
  }
  return true;
}

function isReportCell(value: unknown): value is FinancialReportCell {
  if (!value || typeof value !== "object") return false;
  const cell = value as Partial<FinancialReportCell>;
  return [cell.label, cell.quantity, cell.unitPrice, cell.amount, cell.percent].every((item) => typeof item === "string");
}
