import { sanitizePathname, scrubString } from "./scrub";

export type ClientErrorReport = {
  name: string;
  message: string;
  route: string;
};

export function buildClientErrorReport(input: {
  name: string;
  message: string;
  route: string;
}): ClientErrorReport {
  return {
    name: scrubString(input.name).slice(0, 128),
    message: scrubString(input.message).slice(0, 256),
    route: sanitizePathname(input.route),
  };
}

export type ClientErrorTransport = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status">>;

export async function reportClientError(
  input: { name: string; message: string; route: string },
  send: ClientErrorTransport = fetch,
): Promise<void> {
  try {
    await send("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildClientErrorReport(input)),
      keepalive: true,
      credentials: "omit",
    });
  } catch {
    // Reporting must never affect the app.
  }
}

declare global {
  interface Window {
    __homeClientErrorReportingInstalled?: boolean;
  }
}

export function installClientErrorReporting(
  send: ClientErrorTransport = fetch,
): void {
  if (typeof window === "undefined" || window.__homeClientErrorReportingInstalled) {
    return;
  }
  window.__homeClientErrorReportingInstalled = true;

  window.addEventListener("error", (event) => {
    void reportClientError(
      {
        name: event.error instanceof Error ? event.error.name : "Error",
        message: event.message,
        route: window.location.pathname,
      },
      send,
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    void reportClientError(
      {
        name: reason instanceof Error ? reason.name : "UnhandledRejection",
        message: reason instanceof Error ? reason.message : String(reason),
        route: window.location.pathname,
      },
      send,
    );
  });
}
