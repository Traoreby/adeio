import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Newspaper } from "lucide-react";
import { getPublishedAnnouncements } from "@/lib/content";
import { formatDate, formatShortDate } from "@/lib/utils";
import { PaginationLinks } from "@/components/pagination-links";

export const metadata: Metadata = { title: "Actualités" };

type Props = { searchParams: Promise<{ page?: string }> };

export default async function NewsPage({ searchParams }: Props) {
  const params = await searchParams;
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const pageSize = 10;
  const announcements = await getPublishedAnnouncements(pageSize + 1, (page - 1) * pageSize);
  const hasNext = announcements.length > pageSize;
  const visibleAnnouncements = announcements.slice(0, pageSize);
  return <>
    <section className="page-hero"><div className="container"><div className="eyebrow eyebrow-green">VIE ASSOCIATIVE</div><h1>Les actualités <span>d’ADEIO</span></h1><p>Retrouvez les annonces et les temps forts publiés par l’association.</p></div></section>
    <section className="section-pad"><div className="container news-list">
      {visibleAnnouncements.length ? visibleAnnouncements.map((item) => <Link href={`/actualites/${item.slug}`} className="news-list-item" key={item.id}><div className="news-list-date"><span>{formatShortDate(item.published_at)}</span></div><div className="news-list-copy"><div className="eyebrow eyebrow-green">{item.is_pinned ? "À LA UNE" : "ACTUALITÉ ADEIO"}</div><h2>{item.title}</h2><p>{item.summary || item.body.slice(0, 180)}</p><time>{formatDate(item.published_at)}</time></div><ArrowRight className="news-list-arrow" size={20} /></Link>) : <div className="empty-state"><span className="empty-state-icon"><Newspaper size={26} /></span><h2>Aucune actualité pour le moment</h2><p>Les nouvelles de l’association seront publiées ici dès qu’elles seront disponibles.</p></div>}
      <PaginationLinks pathname="/actualites" page={page} hasNext={hasNext} />
    </div></section>
  </>;
}
