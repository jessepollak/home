import { NextResponse, type NextRequest } from "next/server";

const loopbackHostPattern = /^127\.0\.0\.1(?::([0-9]{1,5}))?$/;
const SAVE_QA_NOT_FOUND_BODY = "Not found.\n";

function normalizedNamespacePath(request: NextRequest): string {
  let pathname = request.nextUrl.pathname;
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    } catch {
      break;
    }
  }
  return pathname.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function isSaveQaNamespace(request: NextRequest): boolean {
  const pathname = normalizedNamespacePath(request);
  return pathname === "/dev/save-qa" || pathname.startsWith("/dev/save-qa/");
}

function saveQaNotFoundResponse(): NextResponse {
  return new NextResponse(SAVE_QA_NOT_FOUND_BODY, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function canonicalDevelopmentNavigationResponse(
  request: NextRequest,
  environment = process.env.NODE_ENV,
  saveQaOptIn = process.env.HOME_ENABLE_SAVE_QA,
): NextResponse {
  if (
    isSaveQaNamespace(request) &&
    !(environment === "development" && saveQaOptIn === "1")
  ) {
    return saveQaNotFoundResponse();
  }

  const actualHost = request.headers.get("host")?.toLowerCase() ?? "";
  const match = loopbackHostPattern.exec(actualHost);
  const port = match?.[1] ?? "";
  const isDocumentNavigation =
    request.method === "GET" &&
    request.headers.get("sec-fetch-dest") === "document" &&
    request.headers.get("sec-fetch-mode") === "navigate";

  if (
    environment !== "development" ||
    !match ||
    (port && Number(port) > 65_535) ||
    !isDocumentNavigation ||
    request.nextUrl.pathname === "/api" ||
    request.nextUrl.pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  const destination = request.nextUrl.clone();
  destination.hostname = "localhost";
  destination.port = port;
  return NextResponse.redirect(destination, 307);
}

export function proxy(request: NextRequest): NextResponse {
  return canonicalDevelopmentNavigationResponse(request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
