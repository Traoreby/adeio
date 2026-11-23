import Link from "next/link";
import { ArrowLeft, CircleHelp } from "lucide-react";

export default function NotFound() {
  return <section className="section-pad"><div className="container empty-state"><span className="empty-state-icon"><CircleHelp size={26} /></span><div className="eyebrow eyebrow-green">PAGE INTROUVABLE</div><h1>Cette page n’existe pas.</h1><p>Le lien est peut-être incorrect ou le contenu a été déplacé.</p><Link href="/" className="text-link" style={{ justifyContent: "center", marginTop: 18 }}><ArrowLeft size={15} /> Retour à l’accueil</Link></div></section>;
}
