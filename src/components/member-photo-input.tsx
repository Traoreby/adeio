"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus } from "lucide-react";
import { prepareImageUpload, type ImageCrop } from "@/lib/client-image-processing";

const MAX_PHOTO_BYTES = 500_000;

export function MemberPhotoInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [crop, setCrop] = useState<ImageCrop>({ aspect: "square", x: 0.5, y: 0.5 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preparedSize, setPreparedSize] = useState<number | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function prepare(file: File, nextCrop: ImageCrop) {
    setBusy(true);
    setMessage("");
    setPreparedSize(null);
    if (inputRef.current) inputRef.current.setCustomValidity("Compression de la photo en cours.");
    try {
      const result = await prepareImageUpload(file, nextCrop, 800, MAX_PHOTO_BYTES, 200_000);
      const transfer = new DataTransfer();
      transfer.items.add(result.file);
      if (inputRef.current) {
        inputRef.current.files = transfer.files;
        inputRef.current.setCustomValidity("");
      }
      setPreview(URL.createObjectURL(result.file));
      setPreparedSize(result.file.size);
    } catch (cause) {
      if (inputRef.current) {
        inputRef.current.value = "";
        inputRef.current.setCustomValidity("");
      }
      setPreview("");
      setMessage(cause instanceof Error ? `${cause.message} Vérifiez que le navigateur prend en charge le format HEIC.` : "Cette image n’a pas pu être traitée.");
    } finally {
      setBusy(false);
    }
  }

  function onSelect(file?: File) {
    setSource(file ?? null);
    setPreview("");
    setPreparedSize(null);
    setMessage("");
    setCrop({ aspect: "square", x: 0.5, y: 0.5 });
    if (inputRef.current) inputRef.current.setCustomValidity("");
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.hei[cf]$/i.test(file.name)) {
      setMessage("Choisissez une photo JPG, PNG, WebP ou HEIC.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    void prepare(file, { aspect: "square", x: 0.5, y: 0.5 });
  }

  return <div className="member-photo-input">
    <label htmlFor="member-photo"><ImagePlus size={15} /> Photo du membre</label>
    <input ref={inputRef} id="member-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onChange={(event) => onSelect(event.target.files?.[0])} />
    {source && <div className="photo-crop-controls"><label htmlFor="photo-crop-shape">Format du recadrage</label><select id="photo-crop-shape" value={crop.aspect} onChange={(event) => { setCrop({ ...crop, aspect: event.target.value as Exclude<ImageCrop["aspect"], "original"> }); inputRef.current?.setCustomValidity("Cliquez sur Mettre à jour l’aperçu pour valider ce recadrage."); }}><option value="square">Carré · 1:1</option><option value="portrait">Portrait · 4:5</option></select><label htmlFor="photo-crop-x">Position horizontale</label><input id="photo-crop-x" type="range" min="0" max="1" step="0.01" value={crop.x} onChange={(event) => { setCrop({ ...crop, x: Number(event.target.value) }); inputRef.current?.setCustomValidity("Cliquez sur Mettre à jour l’aperçu pour valider ce recadrage."); }} /><label htmlFor="photo-crop-y">Position verticale</label><input id="photo-crop-y" type="range" min="0" max="1" step="0.01" value={crop.y} onChange={(event) => { setCrop({ ...crop, y: Number(event.target.value) }); inputRef.current?.setCustomValidity("Cliquez sur Mettre à jour l’aperçu pour valider ce recadrage."); }} /><button type="button" className="text-action" disabled={busy} onClick={() => void prepare(source, crop)}>Mettre à jour l’aperçu</button></div>}
    {preview && <div className={`member-photo-input-preview ${crop.aspect === "portrait" ? "is-portrait" : ""}`}><Image src={preview} alt="Aperçu de la photo recadrée et compressée" fill sizes="(max-width: 760px) 42vw, 180px" unoptimized />{busy && <span>Recompression…</span>}</div>}
    {busy && <p role="status">Compression de la photo…</p>}
    {preparedSize !== null && !busy && <p role="status">Photo prête · {Math.ceil(preparedSize / 1000)} Ko · 800 px maximum.</p>}
    {message && <p role="alert">{message}</p>}
    <small>JPG, PNG, WebP et HEIC si votre navigateur le décode. Le recadrage et la compression sont faits avant l’envoi; maximum 500 Ko.</small>
  </div>;
}
