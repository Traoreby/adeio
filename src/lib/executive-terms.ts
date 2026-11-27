/** Règles de calcul partagées par l'interface d'administration du Bureau. */
export function getExecutiveTermEnd(startDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const nextYearMonthEnd = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
  const anniversary = new Date(Date.UTC(year + 1, month - 1, Math.min(day, nextYearMonthEnd)));
  anniversary.setUTCDate(anniversary.getUTCDate() - 1);
  return anniversary.toISOString().slice(0, 10);
}

export function getExecutiveTermTitle(startDate: string, endDate: string) {
  if (!startDate || !endDate) return "";
  const startYear = startDate.slice(0, 4);
  const endYear = endDate.slice(0, 4);
  return startYear === endYear
    ? `Bureau exécutif ${startYear}`
    : `Bureau exécutif ${startYear}–${endYear}`;
}

export function getIndiaDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getExecutiveTermStatus(startDate: string, endDate: string | null, today: string) {
  const effectiveEnd = endDate ?? getExecutiveTermEnd(startDate);
  if (today < startDate) return "upcoming" as const;
  if (today > effectiveEnd) return "ended" as const;
  return "current" as const;
}
