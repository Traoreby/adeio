export const financeDirectionLabels = { income: "Recette", expense: "Dépense" } as const;
export const financeMethodLabels = { cash: "Espèces", online: "Online", mobile_money: "Mobile money", bank_transfer: "Virement", other: "Autre" } as const;
export const contributionPeriodicityLabels = { monthly: "Mensuelle", yearly: "Annuelle", custom: "Périodicité personnalisée" } as const;

export function financeDirectionLabel(value: string) {
  return value === "income" ? financeDirectionLabels.income : financeDirectionLabels.expense;
}

export function financeMethodLabel(value: string) {
  return value === "cash" ? financeMethodLabels.cash : value === "mobile_money" ? financeMethodLabels.mobile_money : value === "bank_transfer" ? financeMethodLabels.bank_transfer : financeMethodLabels.other;
}

export function contributionPeriodicityLabel(value: string) {
  return value === "monthly" ? contributionPeriodicityLabels.monthly : value === "yearly" ? contributionPeriodicityLabels.yearly : contributionPeriodicityLabels.custom;
}

export function currentFinancialPeriod(value: string, now = new Date()) {
  if (!["month", "quarter", "year"].includes(value)) return { from: null, to: null };
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "01";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const firstMonth = value === "year" ? 1 : value === "quarter" ? Math.floor((month - 1) / 3) * 3 + 1 : month;
  return { from: `${year}-${String(firstMonth).padStart(2, "0")}-01`, to: today };
}

export function formatInr(amount: number | string | null | undefined) {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(amount ?? 0))}`;
}

export function formatFinancialDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(`${value.slice(0, 10)}T00:00:00+05:30`));
}
