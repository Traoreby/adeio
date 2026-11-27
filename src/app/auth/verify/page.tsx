import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { verifyAuthEmailLinkAction } from "@/app/auth/verify/actions";
import { EmailCodeSubmitButton } from "@/components/email-code-submit-button";

export const metadata: Metadata = { title: "Vérifier l’e-mail · ADEIO", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ token_hash?: string; type?: string; flow?: string; next?: string; erreur?: string }>;

const flowLabels = {
  invitation: { title: "Accepter votre invitation ADEIO", action: "Vérifier l’invitation" },
  signup: { title: "Confirmer votre adresse e-mail", action: "Confirmer l’adresse" },
  recovery: { title: "Continuer la récupération du compte", action: "Vérifier la demande" },
  reactivation: { title: "Confirmer la réactivation de votre compte", action: "Vérifier la demande" },
} as const;

const errors: Record<string, string> = {
  "lien-incomplet": "Le lien reçu est incomplet. Demandez un nouvel envoi uniquement si l’e-mail ou son lien est incomplet.",
  "lien-invalide": "Ce lien ne correspond pas au type d’opération attendu. Vérifiez que vous avez ouvert le dernier e-mail reçu.",
  "lien-expire": "Ce lien a expiré ou a déjà été utilisé. Un lien ne peut servir qu’une fois.",
  "trop-de-demandes": "Trop de tentatives ont été effectuées. Attendez quelques minutes avant de réessayer.",
  "session-absente": "La vérification a abouti, mais la session n’a pas pu être établie. Demandez un nouvel e-mail si le problème persiste.",
  "service-indisponible": "Le service de vérification est momentanément indisponible. Réessayez plus tard.",
};

export default async function VerifyAuthEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const allowedFlows = ["invitation", "signup", "recovery", "reactivation"] as const;
  const flow = allowedFlows.find((item) => item === params.flow) ?? "recovery";
  const typeMatchesFlow = (flow === "invitation" && params.type === "invite")
    || (flow === "signup" && params.type === "signup")
    || ((flow === "recovery" || flow === "reactivation") && params.type === "recovery");
  const tokenHash = params.token_hash && /^[a-zA-Z0-9_-]{20,256}$/.test(params.token_hash) ? params.token_hash : "";
  const linkReady = Boolean(tokenHash && typeMatchesFlow);
  const error = params.erreur ? errors[params.erreur] : null;

  return <section className="auth-page"><div className="container auth-single"><div className="auth-card">
    <div className="auth-card-mark"><KeyRound size={19} /></div>
    <div className="eyebrow eyebrow-green">SÉCURITÉ DU COMPTE</div>
    <h1>{flowLabels[flow].title}</h1>
    <p>Confirmez la vérification sur ADEIO pour éviter qu’un aperçu automatique de votre messagerie ne consomme le lien. Après validation, vous pourrez choisir votre mot de passe.</p>
    {error && <div className="form-alert error-alert" role="alert">{error}{params.erreur === "lien-expire" && (flow === "recovery" ? <p><Link className="text-link" href="/connexion?recovery=1">Demander un nouvel e-mail de récupération</Link></p> : <p>Contactez l’administration pour renvoyer une invitation ou une instruction de réactivation.</p>)}</div>}
    {linkReady ? <form action={verifyAuthEmailLinkAction} className="form-stack">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={params.type} />
      <input type="hidden" name="flow" value={flow} />
      {params.next && <input type="hidden" name="next" value={params.next} />}
      <EmailCodeSubmitButton label={flowLabels[flow].action} />
    </form> : !error ? <div className="form-alert error-alert" role="alert">Le lien reçu est incomplet ou ne correspond pas à cette opération. Ouvrez le lien complet du dernier e-mail reçu.</div> : null}
    <p className="auth-security"><Link href="/connexion">Retour à la connexion</Link></p>
  </div></div></section>;
}
