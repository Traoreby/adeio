import { existsSync } from "node:fs";
import { join } from "node:path";
import Image from "next/image";

type OptionalBackgroundProps = {
  asset: "hero-bg" | "about-bg" | "cta-bg";
  className: string;
  sizes?: string;
  priority?: boolean;
};

/** Prefer a future local photo; use the local SVG artwork until one is added. */
export function OptionalBackground({ asset, className, sizes = "100vw", priority = false }: OptionalBackgroundProps) {
  const extensions = ["jpg", "jpeg", "webp", "png", "svg"] as const;
  const src = extensions
    .map((extension) => `/images/${asset}.${extension}`)
    .find((candidate) => existsSync(join(process.cwd(), "public", candidate.slice(1))));

  return (
    <div className={className} aria-hidden="true">
      {src && <Image src={src} alt="" fill sizes={sizes} priority={priority} unoptimized={src.endsWith(".svg")} className="optional-background-image" />}
    </div>
  );
}
