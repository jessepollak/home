import { NextResponse, type NextRequest } from "next/server";

const loopbackHostPattern = /^127\.0\.0\.1(?::([0-9]{1,5}))?$/;

export function canonicalDevelopmentNavigationResponse(
  request: NextRequest,
  environment = process.env.NODE_ENV,
): NextResponse {
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
