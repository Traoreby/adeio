import { headers } from "next/headers";

export async function getSiteBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;

  const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (productionDomain) return `https://${productionDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  if (!host) return null;
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  return `${protocol}://${host}`;
}
