import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pin } from "lucide-react";
import { getAnnouncementBySlug } from "@/lib/content";
import { formatDate } from "@/lib/utils";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getAnnouncementBySlug(slug);
  return { title: article?.title ?? "Actualité" };
}

export default async function NewsArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getAnnouncementBySlug(slug);
  if (!article) notFound();
  return <article className="article-page"><div className="container article-container"><Link className="back-link" href="/actualites"><ArrowLeft size={16} /> Toutes les actualités</Link><div className="eyebrow eyebrow-green">{article.is_pinned && <Pin size={13} />} ACTUALITÉ ADEIO</div><time>{formatDate(article.published_at)}</time><h1>{article.title}</h1>{article.summary && <p className="article-summary">{article.summary}</p>}<div className="article-rule" /><div className="article-body">{article.body.split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></div></article>;
}
