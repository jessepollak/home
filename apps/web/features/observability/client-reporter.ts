import {
  sanitizeIdentifier,
  sanitizeRoutePath,
  scrubString,
} from "./scrub";

export const CLIENT_ERROR_ENDPOINT = "/api/client-errors";
export const CLIENT_ERROR_MAX_REPORTS_PER_PAGE = 5;

export type ClientErrorReport = {
  name: string;
  message: string;
  route: string;
};

export type ClientErrorTransport = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status">>;

export function buildClientErrorReport(input: ClientErrorReport): ClientErrorReport {
  return {
    name: sanitizeIdentifier(input.name, "Error"),
    message: scrubString(input.message).trim().slice(0, 256) || "Client error",
    route: sanitizeRoutePath(input.route),
  };
}

export async function reportClientError(
  input: ClientErrorReport,
  send: ClientErrorTransport = (url, init) => fetch(url, init),
): Promise<void> {
  try {
    const body = JSON.stringify(buildClientErrorReport(input));
    await send(CLIENT_ERROR_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
  } catch {
    // Reporting must never affect the application.
  }
}

export function createBoundedClientErrorReporter(
  send: ClientErrorTransport = (url, init) => fetch(url, init),
): (report: ClientErrorReport) => void {
  let reportsSent = 0;

  return (report) => {
    if (reportsSent >= CLIENT_ERROR_MAX_REPORTS_PER_PAGE) return;
    reportsSent += 1;
    void reportClientError(report, send);
  };
}

function safeThrownDescription(value: unknown): { name: string; message: string } {
  try {
    if (value instanceof Error) {
      return {
        name: typeof value.name === "string" ? value.name : "Error",
        message: typeof value.message === "string" ? value.message : "Client error",
      };
    }
    if (typeof value === "string") {
      return { name: "UnhandledRejection", message: value };
    }
  } catch {
    // Hostile getters and proxy values are intentionally ignored.
  }
  return { name: "UnhandledRejection", message: "Non-Error rejection" };
}

declare global {
  interface Window {
    __homeClientErrorReportingInstalled?: boolean;
  }
}

export function installClientErrorReporting(
  send: ClientErrorTransport = (url, init) => fetch(url, init),
): void {
  try {
    if (typeof window === "undefined" || window.__homeClientErrorReportingInstalled) return;
    window.__homeClientErrorReportingInstalled = true;
    const report = createBoundedClientErrorReporter(send);

    window.addEventListener("error", (event) => {
      try {
        const description = safeThrownDescription(event.error);
        report({
          name: description.name,
          message: event.message || description.message,
          route: window.location.pathname,
        });
      } catch {
        // Error reporting must not create another error.
      }
    });

    window.addEventListener("unhandledrejection", (event) => {
      try {
        const description = safeThrownDescription(event.reason);
        report({ ...description, route: window.location.pathname });
      } catch {
        // Error reporting must not create another rejection.
      }
    });
  } catch {
    // Instrumentation installation cannot block hydration.
  }
}
