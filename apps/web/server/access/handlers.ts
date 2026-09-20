import "server-only";

import { createHash } from "node:crypto";
import { readAccessConfig, type AccessConfig } from "./config";
import { ACCESS_TOKEN_TTL_MS, issueAccessToken } from "./token";
import { clearCookie, cookie, equalText, requestOrigin } from "@/server/auth/signed-cookie";
import {
  ACCESS_CONTRACT_VERSION,
  ACCESS_COOKIE_NAME,
  ACCESS_CREDENTIAL_FIELD,
  ACCESS_RESPONSE_MODE_HEADER,
  parseSafeAccessDestination,
  type AccessErrorCode,
} from "@/shared/access/contract";

const MAX_BODY_BYTES = 4_096;
const MAX_CREDENTIAL_BYTES = 1_024;

type LoginDependencies = {
  getConfig?: () => AccessConfig;
  now?: () => Date;
};

function responseHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    Vary: `Cookie, ${ACCESS_RESPONSE_MODE_HEADER}`,
  });
}

function errorResponse(code: AccessErrorCode, status: number): Response {
  return Response.json(
    { version: ACCESS_CONTRACT_VERSION, error: { code } },
    { status, headers: responseHeaders() },
  );
}

function sameOriginPost(request: Request): URL | null {
  if (request.method !== "POST") return null;
  const expected = requestOrigin(request);
  const origin = request.headers.get("origin");
  if (!expected || !origin || origin === "null") return null;
  try {
    const supplied = new URL(origin);
    if (supplied.origin !== origin || supplied.origin !== expected.origin) return null;
  } catch {
    return null;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin" ? expected : null;
}

async function readForm(request: Request): Promise<URLSearchParams | null> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const lengthText = request.headers.get("content-length");
  const length = lengthText === null ? null : Number(lengthText);
  if (
    !contentType.startsWith("application/x-www-form-urlencoded") ||
    (length !== null && (!Number.isFinite(length) || length < 0 || length > MAX_BODY_BYTES))
  ) return null;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return null;
    return new URLSearchParams(text);
  } catch {
    return null;
  }
}

function credentialDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function createAccessLoginHandler(input: LoginDependencies = {}) {
  return async function POST(request: Request): Promise<Response> {
    const origin = sameOriginPost(request);
    const form = origin ? await readForm(request) : null;
    if (!origin || !form) {
      return errorResponse("INVALID_ACCESS", origin ? 400 : 403);
    }
    const config = (input.getConfig ?? readAccessConfig)();
    if (config.kind === "misconfigured") {
      return errorResponse("ACCESS_UNAVAILABLE", 503);
    }
    if (config.kind !== "enabled") {
      return errorResponse("INVALID_ACCESS", 400);
    }

    const allowedFields = new Set([ACCESS_CREDENTIAL_FIELD, "next"]);
    const fields = [...form.keys()];
    const credentials = form.getAll(ACCESS_CREDENTIAL_FIELD);
    const destinations = form.getAll("next");
    if (
      fields.some((name) => !allowedFields.has(name)) ||
      credentials.length !== 1 ||
      destinations.length > 1 ||
      Buffer.byteLength(credentials[0] ?? "", "utf8") > MAX_CREDENTIAL_BYTES ||
      !equalText(
        credentialDigest(credentials[0] ?? ""),
        credentialDigest(config.credential),
      )
    ) return errorResponse("INVALID_ACCESS", 401);

    const now = (input.now ?? (() => new Date()))();
    const destination = parseSafeAccessDestination(destinations[0]);
    const headers = responseHeaders();
    headers.set(
      "Set-Cookie",
      cookie(
        ACCESS_COOKIE_NAME,
        issueAccessToken(config, now),
        request,
        ACCESS_TOKEN_TTL_MS / 1_000,
      ),
    );
    if (request.headers.get(ACCESS_RESPONSE_MODE_HEADER) === "json") {
      return Response.json(
        { version: ACCESS_CONTRACT_VERSION, destination },
        { status: 200, headers },
      );
    }
    headers.set("Location", new URL(destination, origin).toString());
    return new Response(null, { status: 303, headers });
  };
}

export function createAccessLogoutHandler() {
  return async function POST(request: Request): Promise<Response> {
    const origin = sameOriginPost(request);
    if (!origin) return errorResponse("INVALID_ACCESS", 403);
    const headers = responseHeaders();
    headers.set("Set-Cookie", clearCookie(ACCESS_COOKIE_NAME, request));
    headers.set("Location", new URL("/access", origin).toString());
    return new Response(null, { status: 303, headers });
  };
}
