import { headers } from "next/headers";

export async function getSiteBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  // Email links must always use the configured HTTPS application URL in production.
  if (process.env.NODE_ENV === "production") return null;

  const developmentDomain = process.env.VERCEL_URL;
  if (developmentDomain) return `https://${developmentDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  if (!host) return null;
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  return `${protocol}://${host}`;
}
