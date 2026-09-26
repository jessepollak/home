import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { AccessConfig } from "./config";
import { readAccessToken } from "./token";
import {
  ACCESS_CONTRACT_VERSION,
  ACCESS_COOKIE_NAME,
  parseSafeAccessDestination,
  type AccessErrorCode,
} from "@/shared/access/contract";

const appleAssociationPath =
  "/.well-known/apple-developer-merchantid-domain-association";
const fundingWebhookPattern = /^\/api\/funding\/webhooks\/[a-z0-9_-]+$/;
const actionPaymasterPattern =
  /^\/api\/actions\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/paymaster$/i;

function isPublicPath(pathname: string): boolean {
  return pathname === appleAssociationPath ||
    pathname === "/api/webhooks/cdp" ||
    fundingWebhookPattern.test(pathname) ||
    actionPaymasterPattern.test(pathname) ||
    pathname === "/access" ||
    pathname === "/api/access" ||
    pathname === "/api/access/logout" ||
    pathname.startsWith("/_next/static/");
}

function privateHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set(
    "Vary",
    "Cookie, Authorization, X-Home-Account-Provider",
  );
  return response;
}

function errorResponse(code: AccessErrorCode, status: 401 | 503): NextResponse {
  return privateHeaders(NextResponse.json(
    { version: ACCESS_CONTRACT_VERSION, error: { code } },
    { status },
  ));
}

export function enforceAccess(
  request: NextRequest,
  config: AccessConfig,
  now = new Date(),
): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  if (isPublicPath(pathname) || config.kind === "disabled") return null;
  if (config.kind === "misconfigured") {
    return errorResponse("ACCESS_UNAVAILABLE", 503);
  }

  const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (token && readAccessToken(token, config, now)) {
    return privateHeaders(NextResponse.next());
  }

  if (request.method === "GET" || request.method === "HEAD") {
    if (!pathname.startsWith("/api/") && pathname !== "/api") {
      const current = parseSafeAccessDestination(
        `${pathname}${request.nextUrl.search}`,
      );
      const destination = request.nextUrl.clone();
      destination.pathname = "/access";
      destination.search = "";
      destination.searchParams.set("next", current);
      return privateHeaders(NextResponse.redirect(destination, 307));
    }
  }
  return errorResponse("ACCESS_REQUIRED", 401);
}
