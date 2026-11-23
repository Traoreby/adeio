"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus } from "lucide-react";

export function MemberPhotoInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");

  async function compress(file?: File) {
    setMessage("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Choisissez une image PNG, JPEG ou WebP."); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const side = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = 720; canvas.height = 720;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Impossible de traiter cette image.");
      context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 720, 720);
      bitmap.close();
      let blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) throw new Error("La photo n’a pas pu être compressée.");
      if (blob.size > 850_000) blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.66));
      if (!blob || blob.size > 850_000) throw new Error("Cette photo reste trop volumineuse après compression.");
      const compressed = new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
      const transfer = new DataTransfer(); transfer.items.add(compressed);
      if (inputRef.current) inputRef.current.files = transfer.files;
      setPreview(URL.createObjectURL(blob));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Image invalide."); }
  }

  return <div className="member-photo-input"><label htmlFor="member-photo"><ImagePlus size={15} /> Photo du membre (recadrage carré et compression automatiques)</label><input ref={inputRef} id="member-photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void compress(event.target.files?.[0])} />{preview && <Image src={preview} alt="Aperçu de la photo recadrée" width={108} height={108} unoptimized />}{message && <p role="alert">{message}</p>}<small>La photo est stockée dans un espace privé. Elle n’apparaît sur la vérification QR qu’avec le consentement du membre.</small></div>;
}
