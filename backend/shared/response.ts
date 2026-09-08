/** Minimal HTTP helpers for API Gateway HTTP API v2 (payload 2.0). */

export type ApiEvent = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
  httpMethod?: string;
  path?: string;
  pathParameters?: Record<string, string> | null;
  queryStringParameters?: Record<string, string> | null;
  headers?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: { method?: string; path?: string };
    authorizer?: {
      jwt?: { claims?: Record<string, unknown> };
    };
  };
};

export function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

export const ok = (body: unknown) => json(200, body);
export const created = (body: unknown) => json(201, body);

/**
 * Answer CORS preflights from the explicit unauthenticated OPTIONS routes.
 * The default JWT authorizer would otherwise 401 them (no token on
 * preflights). Echoes the request origin only when allowlisted via the
 * CORS_ORIGINS env var; actual responses get ACAO from API-level CORS.
 */
export function corsPreflight(event: ApiEvent) {
  const allow = (process.env["CORS_ORIGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const headers = event.headers ?? {};
  const origin = headers["origin"] ?? headers["Origin"] ?? "";
  const allowed = (origin && allow.includes(origin) ? origin : allow[0]) ?? "";
  return {
    statusCode: 204,
    headers: {
      "access-control-allow-origin": allowed,
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-max-age": "300",
      vary: "Origin",
    },
    body: "",
  };
}
export const badRequest = (code: string, message: string) =>
  json(400, { error: "AR_ALBUM_ERROR", code, message });
export const unauthorized = () =>
  json(401, { error: "AR_ALBUM_ERROR", code: "NOT_AUTHENTICATED", message: "Sign in first." });
export const forbidden = () =>
  json(403, { error: "AR_ALBUM_ERROR", code: "FORBIDDEN", message: "Forbidden." });
export const notFound = (message = "Not found.") =>
  json(404, { error: "AR_ALBUM_ERROR", code: "NOT_FOUND", message });
export const conflict = (code: string, message: string) =>
  json(409, { error: "AR_ALBUM_ERROR", code, message });
export const tooMany = (message = "Too many requests.") =>
  json(429, { error: "AR_ALBUM_ERROR", code: "THROTTLED", message });
export const failed = (code: string, message: string, buildId?: string) =>
  json(500, { error: "AR_ALBUM_ERROR", code, message, ...(buildId ? { buildId } : {}) });

export function parseBody(event: ApiEvent): unknown {
  if (!event.body) return {};
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Single-studio admin gate. Production uses the API Gateway JWT authorizer
 * (Cognito). Dev stacks may set ALLOW_MOCK_AUTH=true to accept
 * `x-mock-admin: 1` for synthetic end-to-end tests — never enable in prod.
 */
export function requireAdmin(event: ApiEvent): { sub: string; email?: string } | null {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub = claims?.["sub"];
  if (typeof sub === "string" && sub) {
    const email = claims?.["email"];
    return { sub, ...(typeof email === "string" ? { email } : {}) };
  }
  if (process.env["ALLOW_MOCK_AUTH"] === "true" && event.headers?.["x-mock-admin"] === "1") {
    return { sub: "mock-admin" };
  }
  return null;
}
