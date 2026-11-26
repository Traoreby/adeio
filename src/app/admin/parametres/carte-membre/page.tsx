import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Stamp } from "lucide-react";
import { getSignedInUser } from "@/lib/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { uploadMemberCardOfficialAssetAction } from "@/app/admin/card-actions";

export const metadata: Metadata = { title: "Éléments officiels des cartes · ADEIO" };
type Props = { searchParams: Promise<{ statut?: string; erreur?: string }> };

const errors: Record<string, string> = {
  "fichier-invalide": "Choisissez une image PNG valide.",
  "png-invalide": "Le fichier doit être un PNG de 1 Mo maximum.",
  "service-indisponible": "Le stockage privé n’est pas configuré sur le serveur.",
  "upload-impossible": "Le fichier n’a pas pu être importé. Réessayez.",
  "enregistrement-impossible": "Le fichier a été importé, mais son enregistrement officiel a échoué.",
};

export default async function MemberCardSettingsPage({ searchParams }: Props) {
  const [{ supabase, roles }, params] = await Promise.all([getSignedInUser(), searchParams]);
  if (!supabase || !roles.includes("super_admin")) return null;
  const { data: assets } = await supabase.from("member_card_official_assets")
    .select("id,asset_kind,storage_path,created_at,created_by")
    .eq("is_current", true);
  const service = createSupabaseServiceClient();
  const signed = service && assets?.length
    ? await service.storage.from("member-card-official-assets").createSignedUrls(assets.map((item) => item.storage_path), 300)
    : { data: [] };
  const previewByPath = new Map((signed.data ?? []).flatMap((item) => item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : []));
  const current = new Map((assets ?? []).map((item) => [item.asset_kind, { ...item, url: previewByPath.get(item.storage_path) ?? null }]));
  const statusMessage = params.statut === "signature-enregistre" ? "La nouvelle signature est active. Les versions historiques sont conservées."
    : params.statut === "seal-enregistre" ? "Le nouveau cachet est actif. Les versions historiques sont conservées."
      : null;

  return <>
    <div className="admin-page-heading">
      <div><div className="eyebrow eyebrow-green">PARAMÈTRES · CARTE DE MEMBRE</div><h1>Signature et cachet</h1><p>Ces éléments seront intégrés aux nouvelles cartes délivrées. Les anciennes versions ne sont jamais remplacées.</p></div>
      <Link href="/admin/parametres" className="text-link"><ArrowLeft size={15} /> Retour aux paramètres</Link>
    </div>
    {statusMessage && <p role="status" className="form-success">{statusMessage}</p>}
    {params.erreur && <p role="alert" className="form-error">{errors[params.erreur] ?? "L’opération n’a pas pu être terminée."}</p>}
    {(["signature", "seal"] as const).map((kind) => {
      const asset = current.get(kind);
      const label = kind === "signature" ? "Signature officielle" : "Cachet officiel";
      const Icon = kind === "signature" ? BadgeCheck : Stamp;
      return <section className="admin-card" key={kind}>
        <h2><Icon size={19} /> {label}</h2>
        <p>Importez un PNG avec fond transparent. Taille maximale : 1 Mo. Chaque import crée une nouvelle version privée.</p>
        {asset?.url ? <div className="admin-card-asset-preview"><Image src={asset.url} alt={`Aperçu de la ${label.toLowerCase()}`} width={320} height={150} unoptimized /></div>
          : <p className="admin-banner">Aucun fichier configuré. La délivrance des cartes est bloquée jusqu’à son ajout.</p>}
        {asset && <p className="admin-form-note">Version active depuis le {new Date(asset.created_at).toLocaleDateString("fr-FR", { timeZone: "Asia/Kolkata" })}.</p>}
        <form action={uploadMemberCardOfficialAssetAction} className="admin-form">
          <input type="hidden" name="asset_kind" value={kind} />
          <label htmlFor={`official-${kind}`}>Nouveau fichier PNG</label>
          <input id={`official-${kind}`} name="asset" type="file" accept="image/png" required />
          <button className="admin-submit" type="submit">{asset ? "Remplacer par une nouvelle version" : `Importer ${label.toLowerCase()}`}</button>
        </form>
      </section>;
    })}
  </>;
}
