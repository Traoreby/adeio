export function safeRedirectPath(value: string | null, baseUrl: string, fallback: string) {
  if (!value) return fallback;
  try {
    const base = new URL(baseUrl);
    const target = new URL(value, base);
    if (target.origin !== base.origin) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
