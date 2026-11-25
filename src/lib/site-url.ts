import { headers } from "next/headers";

const OFFICIAL_PRODUCTION_ORIGIN = "https://adeio.vercel.app";

export async function getSiteBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!configured) return null;
    try {
      const url = new URL(configured);
      return url.protocol === "https:" && url.origin === OFFICIAL_PRODUCTION_ORIGIN
        ? OFFICIAL_PRODUCTION_ORIGIN
        : null;
    } catch {
      return null;
    }
  }

  if (configured) {
    try {
      const url = new URL(configured);
      return url.origin;
    } catch {
      return null;
    }
  }

  // Vercel/request-host fallbacks are development-only; production is pinned above.
  const developmentDomain = process.env.VERCEL_URL;
  if (developmentDomain) return `https://${developmentDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  if (!host) return null;
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  return `${protocol}://${host}`;
}
