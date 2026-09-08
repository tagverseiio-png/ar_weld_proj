/**
 * Public runtime config. Only VITE_* values — never AWS secrets.
 * Empty API base means "local mock mode" (prototype behaviour).
 */

const env = import.meta.env as Record<string, string | undefined>;

export const config = {
  apiBaseUrl: (env["VITE_API_BASE_URL"] ?? "").replace(/\/$/, ""),
  cognito: {
    userPoolId: env["VITE_COGNITO_USER_POOL_ID"] ?? "",
    clientId: env["VITE_COGNITO_CLIENT_ID"] ?? "",
    domain: env["VITE_COGNITO_DOMAIN"] ?? "",
    redirectUri:
      env["VITE_COGNITO_REDIRECT_URI"] ??
      (typeof window !== "undefined" ? `${window.location.origin}/admin/callback` : ""),
  },
  cloudfrontOrigin: env["VITE_CLOUDFRONT_ORIGIN"] ?? "",
  canonicalOrigin: env["VITE_CANONICAL_ORIGIN"] ?? "",
  studioName: "Marikkanu Studios",
  studioCity: "Chennai",
} as const;

export const isProductionApiConfigured = () => config.apiBaseUrl.length > 0;

/** Canonical origin for printable QR codes — never a preview domain. */
export function canonicalOrigin(): string {
  if (config.canonicalOrigin) return config.canonicalOrigin.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    // Guard against generating permanent QR from preview deployments.
    if (/localhost|vercel\.app|lovable\.app|preview/i.test(host)) return "";
    return window.location.origin;
  }
  return "";
}
