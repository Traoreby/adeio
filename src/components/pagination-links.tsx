import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

export function PaginationLinks({ pathname, page, hasNext, query = {} }: {
  pathname: string;
  page: number;
  hasNext: boolean;
  query?: Record<string, string>;
}) {
  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams({ ...query, page: String(nextPage) });
    return `${pathname}?${params.toString()}`;
  };
  return <nav className="pagination-links" aria-label="Pagination">
    {page > 1 ? <Link href={hrefFor(page - 1)}><ArrowLeft size={15} /> Précédent</Link> : <span />}
    <span>Page {page}</span>
    {hasNext ? <Link href={hrefFor(page + 1)}>Suivant <ArrowRight size={15} /></Link> : <span />}
  </nav>;
}
