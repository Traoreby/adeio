import Link from "next/link";
import { KeyRound } from "lucide-react";
import { verifyEmailCodeAction } from "@/app/auth/email-code-action";
import { EmailCodeSubmitButton } from "@/components/email-code-submit-button";

const errors: Record<string, string> = {
  "code-invalide": "Ce code est invalide ou a expiré. Vérifiez l’adresse e-mail et demandez de nouvelles instructions à l’administration.",
  "trop-de-tentatives": "Trop de tentatives. Attendez quelques minutes avant de réessayer.",
  "service-indisponible": "La vérification est momentanément indisponible. Réessayez plus tard.",
};

export function EmailCodeForm({ flow, error }: { flow: "invitation" | "signup" | "recovery"; error?: string }) {
  const invitation = flow !== "recovery";
  return <div className="auth-card">
    <div className="auth-card-mark"><KeyRound size={19} /></div>
    <div className="eyebrow eyebrow-green">{invitation ? "INVITATION ADEIO" : "RÉCUPÉRATION DU COMPTE"}</div>
    <h1>{invitation ? "Activez votre compte membre." : "Vérifiez votre demande."}</h1>
    <p>{invitation
      ? "Ouvrez le lien reçu par e-mail, puis saisissez ici l’adresse invitée et le code à 6 chiffres du message pour choisir votre premier mot de passe."
      : "Ouvrez le lien reçu par e-mail, puis saisissez ici l’adresse de votre compte et le code à 6 chiffres du message pour choisir un nouveau mot de passe."}</p>
    {error && <div role="alert" className="form-alert error-alert">{errors[error] ?? "La vérification n’a pas pu aboutir. Réessayez."}</div>}
    <form action={verifyEmailCodeAction} className="form-stack">
      <input type="hidden" name="flow" value={flow} />
      <label htmlFor="activation-email">Adresse e-mail</label>
      <input id="activation-email" className="form-input" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="nom@exemple.com" />
      <label htmlFor="activation-code">Code à 6 chiffres</label>
      <input id="activation-code" className="form-input activation-code-input" name="token" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required aria-describedby="activation-code-help" placeholder="000000" />
      <small id="activation-code-help">Le code est à usage unique et n’est jamais conservé par ADEIO.</small>
      <EmailCodeSubmitButton label={invitation ? "Vérifier l’invitation" : "Vérifier le code"} />
    </form>
    <p className="auth-security">Besoin d’aide ? <Link href="/connexion">Retour à la connexion</Link></p>
  </div>;
}
