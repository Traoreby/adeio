import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Download, Plus, ReceiptText } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { financeDirectionLabel, financeMethodLabel, formatFinancialAmount, formatFinancialDate } from "@/lib/finance";
import { PaginationLinks } from "@/components/pagination-links";

type Props = { searchParams: Promise<{ page?: string; type?: string; de?: string; a?: string; statut?: string; erreur?: string }> };

export default async function FinanceOperationsPage({ searchParams }: Props) {
  const [{ supabase }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase) return null;
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const type = params.type === "income" || params.type === "expense" ? params.type : "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.de ?? "") ? params.de! : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.a ?? "") ? params.a! : "";
  const pageSize = 30;
  let query = supabase.from("financial_transactions").select("id,occurred_on,direction,label,amount_fcfa,amount_inr,currency_code,payment_method,correction_of,transaction_categories(name),financial_attachments(storage_path,file_name)").eq("is_published", true).order("occurred_on", { ascending: false }).order("id", { ascending: false }).range((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  if (type) query = query.eq("direction", type);
  if (from) query = query.gte("occurred_on", from);
  if (to) query = query.lte("occurred_on", to);
  const { data: rows } = await query;
  const pageRows = (rows ?? []).slice(0, pageSize);
  const attachmentByTransaction = new Map(pageRows.flatMap((row) => {
    const attachment = row.financial_attachments?.[0];
    return attachment ? [[row.id, attachment] as const] : [];
  }));
  const attachmentPaths = [...attachmentByTransaction.values()].map((attachment) => attachment.storage_path);
  const { data: signedAttachments } = attachmentPaths.length
    ? await supabase.storage.from("financial-attachments").createSignedUrls(attachmentPaths, 60 * 10)
    : { data: [] };
  const signedUrlByPath = new Map((signedAttachments ?? []).map((attachment) => [attachment.path, attachment.signedUrl]));
  const operationRows = pageRows.map((row) => ({
    ...row,
    attachmentUrl: signedUrlByPath.get(attachmentByTransaction.get(row.id)?.storage_path ?? "") ?? null,
  }));
  const alert = params.erreur ? ({ "formulaire-invalide": "Vérifiez les champs du formulaire.", "categorie-invalide": "La catégorie choisie ne correspond pas à la nature de l’opération.", "correction-invalide": "Une correction doit être liée à une opération publiée de sens opposé.", "justificatif-invalide": "Joignez un justificatif PDF, JPG ou PNG de 10 Mo maximum.", "enregistrement-impossible": "L’opération n’a pas pu être enregistrée.", "justificatif-impossible": "Le justificatif n’a pas pu être enregistré. L’opération a été annulée.", "publication-impossible": "La publication a échoué. L’opération en brouillon a été annulée." } as Record<string, string>)[params.erreur] : undefined;
  return <>
    <div className="admin-page-heading"><div><div className="eyebrow eyebrow-green">JOURNAL COMPTABLE</div><h1>Opérations financières</h1><p>Le livre de caisse de l’association : enregistrez ici chaque recette et chaque dépense, avec leur justificatif.</p></div><Link href="/gestion-financiere/operations/nouvelle" className="admin-submit"><Plus size={18} /> Saisir une opération</Link></div>
    {params.statut && <div role="status" className="form-success finance-alert">Opération publiée. Elle ne peut plus être supprimée ; toute correction doit être passée par une nouvelle écriture.</div>}
    {alert && <div role="alert" className="form-error finance-alert">{alert}</div>}
    <div className="admin-card"><div className="admin-card-heading"><div><h2><ReceiptText size={16} /> Filtrer l’historique</h2><p>Page {page} · {pageRows.length} opération(s) affichée(s), pagination côté serveur.</p></div><div className="finance-export-links"><a href={`/api/finances/export?format=csv&type=${type}&de=${from}&a=${to}`} className="text-link"><Download size={14} /> CSV Excel</a><a href={`/api/finances/export?format=pdf&type=${type}&de=${from}&a=${to}`} className="text-link"><Download size={14} /> PDF</a></div></div>
      <form className="admin-filter-form finance-filter-form"><label>Nature<select name="type" defaultValue={type}><option value="">Toutes</option><option value="income">Recettes</option><option value="expense">Dépenses</option></select></label><label>Du<input type="date" name="de" defaultValue={from} /></label><label>Au<input type="date" name="a" defaultValue={to} /></label><button className="admin-submit" type="submit">Filtrer</button><Link href="/gestion-financiere/operations" className="text-link">Effacer</Link></form>
      <div className="member-table-scroll"><table className="member-table"><thead><tr><th>Date</th><th>Nature</th><th>Libellé</th><th>Catégorie</th><th>Moyen</th><th>Correction de</th><th>Justificatif</th><th>Montant</th></tr></thead><tbody>{operationRows.map((item) => <tr key={item.id}><td>{formatFinancialDate(item.occurred_on)}</td><td><span className={`status-chip ${item.direction === "expense" ? "draft" : ""}`}>{item.direction === "income" ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{financeDirectionLabel(item.direction)}</span></td><td>{item.label}</td><td>{item.transaction_categories?.[0]?.name ?? "—"}</td><td>{financeMethodLabel(item.payment_method)}</td><td>{item.correction_of ? <code>{item.correction_of.slice(0, 8)}</code> : "—"}</td><td>{item.attachmentUrl ? <a href={item.attachmentUrl} target="_blank" rel="noreferrer" className="text-link">Ouvrir</a> : "—"}</td><td className="finance-amount">{formatFinancialAmount(item.currency_code, item.amount_fcfa, item.amount_inr)}</td></tr>)}</tbody></table></div>
      {!pageRows.length && <div className="admin-empty">Aucune opération ne correspond à ces filtres.</div>}
      <PaginationLinks pathname="/gestion-financiere/operations" page={page} hasNext={(rows?.length ?? 0) > pageSize} query={{ type, de: from, a: to }} />
    </div>
    <p className="finance-dashboard-footnote">Une écriture publiée est immuable ; ajoutez une écriture rectificative liée à l’écriture d’origine.</p>
  </>;
}
