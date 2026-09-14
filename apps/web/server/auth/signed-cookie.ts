import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export function requestOrigin(request: Request): URL | null {
  try {
    const url = new URL(request.url);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) return null;
    // Next.js dev rebuilds request.url from the bind address (127.0.0.1),
    // not the Host the browser used; the SIWE domain must match the browser.
    const host = request.headers.get("host");
    if (host) return new URL(`${url.protocol}//${host}`);
    return new URL(url.origin);
  } catch {
    return null;
  }
}

function hmac(secret: Buffer, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signedValue(secret: Buffer, value: string): string {
  const encoded = Buffer.from(value, "utf8").toString("base64url");
  return `v1.${encoded}.${hmac(secret, `v1.${encoded}`)}`;
}

export function readSignedValue(secret: Buffer, token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const input = `${parts[0]}.${parts[1]}`;
  if (!equalText(parts[2], hmac(secret, input))) return null;
  try {
    return Buffer.from(parts[1], "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): { present: boolean; value: string | null } {
  const header = request.headers.get("cookie");
  if (!header) return { present: false, value: null };
  const values = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length === 0) return { present: false, value: null };
  return { present: true, value: values.length === 1 && values[0] ? values[0] : null };
}

export function cookie(
  name: string,
  value: string,
  request: Request,
  maxAge: number,
  { httpOnly = true }: { httpOnly?: boolean } = {},
): string {
  const secure = requestOrigin(request)?.protocol === "https:" ? "; Secure" : "";
  const httpOnlyAttribute = httpOnly ? "; HttpOnly" : "";
  return `${name}=${value}; Path=/${httpOnlyAttribute}; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(name: string, request: Request): string {
  return cookie(name, "", request, 0);
}
