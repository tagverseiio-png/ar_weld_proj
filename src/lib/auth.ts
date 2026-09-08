import { useSyncExternalStore } from "react";
import { config } from "./config";

/**
 * Single-admin auth via Cognito Hosted UI (OAuth authorization-code flow).
 * No AWS credentials in the browser — only the public user-pool client id.
 * Tokens live in sessionStorage so a shared studio machine doesn't persist them.
 */

const ACCESS_KEY = "ar_album_access_token";
const ID_KEY = "ar_album_id_token";
const REFRESH_KEY = "ar_album_refresh_token";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getAccessToken(): string | null {
  return storage()?.getItem(ACCESS_KEY) ?? null;
}
export function getIdToken(): string | null {
  return storage()?.getItem(ID_KEY) ?? null;
}

export function decodeJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string | null, skewSeconds = 60): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload["exp"] !== "number") return true;
  return (payload["exp"] as number) * 1000 - skewSeconds * 1000 <= Date.now();
}

export function isSignedIn(): boolean {
  const id = getIdToken();
  return !!id && !isTokenExpired(id);
}

export function useAuthState(): { signedIn: boolean; email: string | null } {
  const snapshot = useSyncExternalStore(subscribe, () => (isSignedIn() ? "1" : "0"));
  const payload = decodeJwtPayload(getIdToken());
  const rawEmail = payload?.["email"];
  const email = typeof rawEmail === "string" ? rawEmail : null;
  return { signedIn: snapshot === "1", email };
}

function cognitoConfigured(): boolean {
  return !!(config.cognito.domain && config.cognito.clientId && config.cognito.redirectUri);
}

const MOCK_ADMIN_EMAIL = "studio@example.com";

/**
 * Unsigned mock JWT (local prototype only — never accepted by AWS).
 * Shaped like a real token so the same decode/expiry path is exercised.
 */
function mockIdToken(): string {
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = encode({ alg: "none", typ: "JWT" });
  const payload = encode({
    sub: "mock-admin",
    email: MOCK_ADMIN_EMAIL,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
  });
  return `${header}.${payload}.mock`;
}

/** Redirect to Cognito Hosted UI login. Falls back to mock mode when unconfigured. */
export function login(): void {
  if (!cognitoConfigured()) {
    // Local prototype: mark a mock session so admin UX is testable offline.
    storage()?.setItem(ID_KEY, mockIdToken());
    storage()?.setItem(ACCESS_KEY, "mock-access-token");
    emit();
    return;
  }
  const params = new URLSearchParams({
    client_id: config.cognito.clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: config.cognito.redirectUri,
  });
  window.location.assign(`https://${config.cognito.domain}/oauth2/authorize?${params}`);
}

/** Exchange an authorization code for tokens (PKCE-less confidential UX kept server-simple for single admin). */
export async function handleAuthCallback(code: string): Promise<void> {
  if (!cognitoConfigured()) {
    storage()?.setItem(ID_KEY, mockIdToken());
    emit();
    return;
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.cognito.clientId,
    code,
    redirect_uri: config.cognito.redirectUri,
  });
  const res = await fetch(`https://${config.cognito.domain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Sign-in failed. Please try again.");
  const tokens = (await res.json()) as {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
  };
  if (!tokens.id_token) throw new Error("Sign-in failed (no id token).");
  storage()?.setItem(ID_KEY, tokens.id_token);
  if (tokens.access_token) storage()?.setItem(ACCESS_KEY, tokens.access_token);
  if (tokens.refresh_token) {
    try {
      storage()?.setItem(REFRESH_KEY, tokens.refresh_token);
    } catch {
      /* sessionStorage may be unavailable — non-fatal */
    }
  }
  emit();
}

export function logout(): void {
  storage()?.removeItem(ACCESS_KEY);
  storage()?.removeItem(ID_KEY);
  try {
    storage()?.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
  emit();
  if (cognitoConfigured() && typeof window !== "undefined") {
    const params = new URLSearchParams({
      client_id: config.cognito.clientId,
      logout_uri: window.location.origin,
    });
    window.location.assign(`https://${config.cognito.domain}/logout?${params}`);
  }
}
