import { describe, expect, it } from "vitest";
import { decodeJwtPayload, isTokenExpired } from "./auth";

function unsigned(payload: unknown): string {
  const b = (o: unknown) => btoa(JSON.stringify(o));
  return `${b({ alg: "none", typ: "JWT" })}.${b(payload)}.mock`;
}

describe("auth tokens", () => {
  it("treats undecodable tokens as expired (mock bypass must not slip through)", () => {
    expect(isTokenExpired("mock-id-token")).toBe(true);
    expect(isTokenExpired("")).toBe(true);
    expect(isTokenExpired(null)).toBe(true);
  });

  it("accepts a fresh mock JWT with a future exp (admin sign-in works offline)", () => {
    const token = unsigned({
      sub: "mock-admin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(isTokenExpired(token)).toBe(false);
    expect(decodeJwtPayload(token)?.["sub"]).toBe("mock-admin");
  });

  it("rejects a mock JWT whose exp already passed", () => {
    const token = unsigned({ sub: "mock-admin", exp: 1 });
    expect(isTokenExpired(token)).toBe(true);
  });
});
