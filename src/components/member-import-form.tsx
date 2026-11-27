"use client";

import { useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { normalizeMemberHeader } from "@/lib/members";

type MemberRow = { firstName: string; lastName: string; joinedYear: number | string; exitYear: number | string | null; status: string; phone: string; studyProgram: string; institution: string; sex: string };
type ImportReport = { row: number; ok: boolean; message: string };

const aliases: Record<string, keyof MemberRow> = {
  nom: "lastName", nom_de_famille: "lastName", last_name: "lastName", surname: "lastName",
  prenoms: "firstName", prenom: "firstName", first_name: "firstName", given_name: "firstName",
  annee_entree: "joinedYear", annee_adhesion: "joinedYear", joined_year: "joinedYear", entry_year: "joinedYear",
  annee_sortie: "exitYear", exit_year: "exitYear", telephone: "phone", phone: "phone",
  filiere: "studyProgram", study_program: "studyProgram", institution: "institution", etablissement: "institution",
  sexe: "sex", sex: "sex",
  statut: "status", status: "status",
};

function parseCsv(text: string) {
  const delimiter = (text.split(/\r?\n/, 1)[0].match(/;/g) ?? []).length > (text.split(/\r?\n/, 1)[0].match(/,/g) ?? []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function toMemberRows(data: unknown[][]): MemberRow[] {
  const [headerRow = [], ...dataRows] = data;
  const mapped = headerRow.map((header) => aliases[normalizeMemberHeader(header)]);
  return dataRows.filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== "")).map((values) => {
    const item: MemberRow = { firstName: "", lastName: "", joinedYear: "", exitYear: null, status: "active", phone: "", studyProgram: "", institution: "KIIT University", sex: "" };
    mapped.forEach((key, index) => {
      if (!key) return;
      const raw = values[index];
      if (key === "status") {
        const status = String(raw ?? "active").trim().toLowerCase();
        item.status = ({ actif: "active", active: "active", ancien: "former", ancienne: "former", former: "former", suspendu: "suspended", suspended: "suspended", decede: "deceased", deceased: "deceased" } as Record<string, string>)[status] ?? status;
      } else if (key === "joinedYear" || key === "exitYear") item[key] = raw == null || String(raw).trim() === "" ? "" : Number(raw instanceof Date ? raw.getFullYear() : raw);
      else item[key] = String(raw ?? "").trim();
    });
    return item;
  });
}

function validationMessage(row: MemberRow) {
  if (!row.firstName || !row.lastName) return "Nom et prénoms obligatoires.";
  if (!Number.isInteger(Number(row.joinedYear)) || Number(row.joinedYear) < 1900 || Number(row.joinedYear) > 2200) return "Année d’entrée invalide.";
  if (!Number.isInteger(Number(row.exitYear)) || Number(row.exitYear) < Number(row.joinedYear)) return "Année de fin de cycle obligatoire et invalide.";
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (row.status === "active" && Number(row.exitYear) < currentYear) return "L’année de fin de cycle d’un membre actif ne peut pas être dépassée.";
  if (!row.studyProgram || !row.institution || row.studyProgram.length < 2 || row.institution.length < 2) return "Filière et établissement obligatoires.";
  if (!/^\+?[0-9() .-]{6,40}$/.test(row.phone)) return "Téléphone obligatoire et invalide.";
  if (!["female", "male"].includes(row.sex)) return "Sexe obligatoire : female ou male.";
  if (!["active", "former", "suspended", "deceased"].includes(row.status)) return "Statut invalide.";
  return "";
}

export function MemberImportForm() {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ImportReport[] | null>(null);
  const invalidCount = rows.filter(validationMessage).length;

  async function selectFile(file?: File) {
    setError(""); setReport(null); setRows([]);
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("Le fichier est trop volumineux (5 Mo maximum).");
      let parsedRows: MemberRow[];
      if (file.name.toLowerCase().endsWith(".csv")) parsedRows = toMemberRows(parseCsv(await file.text()));
      else if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        const sheet = await readSheet(file);
        parsedRows = toMemberRows(sheet);
      } else throw new Error("Choisissez un fichier Excel (.xlsx) ou CSV.");
      if (!parsedRows.length) throw new Error("Aucune ligne de membre n’a été trouvée.");
      if (parsedRows.length > 250) throw new Error("Limite de 250 membres par import.");
      if (!parsedRows.some((row) => row.firstName && row.lastName)) throw new Error("En-têtes inconnus. Utilisez le modèle ADEIO téléchargeable.");
      setRows(parsedRows);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Le fichier n’a pas pu être lu."); }
  }

  async function importRows() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/members/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: rows.map((row) => ({ ...row, joinedYear: Number(row.joinedYear), exitYear: row.exitYear ? Number(row.exitYear) : null })) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "L’import a échoué.");
      setReport(result.report);
      setRows([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "L’import a échoué."); }
    finally { setLoading(false); }
  }

  return <div className="admin-import">
    <div className="admin-import-top"><div><strong><FileSpreadsheet size={17} /> Importer depuis Excel ou CSV</strong><p>Un aperçu et les erreurs sont affichés avant la validation. Maximum 250 lignes.</p></div><a href="/templates/adeio-members-template.csv" download className="text-link">Télécharger le modèle CSV</a></div>
    <label className="admin-import-picker"><Upload size={17} /><span>Sélectionner un fichier .xlsx ou .csv</span><input type="file" accept=".xlsx,.csv" onChange={(event) => void selectFile(event.target.files?.[0])} /></label>
    {error && <p role="alert" className="import-error">{error}</p>}
    {rows.length > 0 && <><div className="import-summary" role="status">{rows.length} ligne(s) · {invalidCount} erreur(s) à corriger dans le fichier avant import</div><div className="member-table-scroll"><table className="member-table"><thead><tr><th>Ligne</th><th>Nom</th><th>Prénoms</th><th>Entrée</th><th>Sortie</th><th>Filière</th><th>Établissement</th><th>Statut</th><th>Validation</th></tr></thead><tbody>{rows.slice(0, 20).map((row, index) => <tr key={index}><td>{index + 2}</td><td>{row.lastName}</td><td>{row.firstName}</td><td>{row.joinedYear}</td><td>{row.exitYear || "—"}</td><td>{row.studyProgram}</td><td>{row.institution}</td><td>{row.status}</td><td>{validationMessage(row) || "Prêt"}</td></tr>)}</tbody></table></div>{rows.length > 20 && <small>Les {rows.length} lignes seront importées ; aperçu des 20 premières.</small>}<button className="admin-submit" disabled={loading || invalidCount > 0} onClick={() => void importRows()} type="button">{loading ? "Import en cours…" : `Importer ${rows.length} membre(s)`}</button></>}
    {report && <div className="import-report" role="status"><strong>Rapport d’import : {report.filter((item) => item.ok).length} importé(s), {report.filter((item) => !item.ok).length} erreur(s).</strong><ul>{report.map((item) => <li className={item.ok ? "import-ok" : "import-fail"} key={item.row}>Ligne {item.row} — {item.message}</li>)}</ul></div>}
  </div>;
}
