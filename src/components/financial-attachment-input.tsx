"use client";

import { useRef, useState } from "react";
import { prepareImageUpload } from "@/lib/client-image-processing";

const IMAGE_LIMIT = 1_000_000;
const PDF_LIMIT = 2_000_000;

export function FinancialAttachmentInput({ requiredAboveFcfa }: { requiredAboveFcfa: number | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function onChange(file?: File) {
    setMessage("");
    if (inputRef.current) inputRef.current.setCustomValidity("");
    if (!file || file.size === 0) return;
    if (file.type === "application/pdf") {
      if (file.size > PDF_LIMIT) {
        if (inputRef.current) { inputRef.current.value = ""; inputRef.current.setCustomValidity("Le PDF dépasse la limite de 2 Mo."); }
        setMessage("Le PDF dépasse la limite de 2 Mo.");
      }
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      if (inputRef.current) { inputRef.current.value = ""; inputRef.current.setCustomValidity("Choisissez un PDF, JPG, PNG ou WebP."); }
      setMessage("Choisissez un PDF, un JPG, un PNG ou un WebP.");
      return;
    }
    setBusy(true);
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.setCustomValidity("Compression du justificatif en cours.");
    }
    try {
      const result = await prepareImageUpload(file, { aspect: "original", x: 0.5, y: 0.5 }, 1200, IMAGE_LIMIT, 750_000);
      const transfer = new DataTransfer();
      transfer.items.add(result.file);
      if (inputRef.current) {
        inputRef.current.files = transfer.files;
        inputRef.current.setCustomValidity("");
      }
      setMessage(`Image prête · ${Math.ceil(result.file.size / 1000)} Ko.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "L’image n’a pas pu être compressée.";
      if (inputRef.current) inputRef.current.setCustomValidity(message);
      setMessage(message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="finance-attachment-input"><input ref={inputRef} id="attachment" name="attachment" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void onChange(event.target.files?.[0])} />
    <small>PDF jusqu’à 2 Mo · images redimensionnées à 1 200 px et compressées à 1 Mo maximum. {requiredAboveFcfa ? `Obligatoire au-dessus de ${requiredAboveFcfa.toLocaleString("fr-FR")} FCFA.` : "Facultatif par défaut."}</small>
    {busy && <span role="status">Compression du justificatif…</span>}{message && <span role={message.startsWith("Image prête") ? "status" : "alert"}>{message}</span>}
  </div>;
}
