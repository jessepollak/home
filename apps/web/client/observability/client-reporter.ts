import { deploymentHeaders } from "@/client/query/deployment-headers";
import {
  sanitizeIdentifier,
  sanitizeRoutePath,
  scrubString,
} from "@/shared/observability/scrub";

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
      headers: {
        ...deploymentHeaders(),
        "content-type": "application/json",
      },
      body,
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
  } catch {
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
  }
  return { name: "UnhandledRejection", message: "Non-Error rejection" };
}

declare global {
  interface Window {
    __homeClientErrorReportingInstalled?: boolean;
    __homeClientErrorReport?: (report: ClientErrorReport) => void;
  }
}

const reportedErrors = new WeakSet<object>();

function claimFirstReport(value: unknown): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return true;
  if (reportedErrors.has(value)) return false;
  reportedErrors.add(value);
  return true;
}

function pageClientErrorReporter(send: ClientErrorTransport): (report: ClientErrorReport) => void {
  window.__homeClientErrorReport ??= createBoundedClientErrorReporter(send);
  return window.__homeClientErrorReport;
}

export function reportCaughtClientError(
  error: unknown,
  send: ClientErrorTransport = (url, init) => fetch(url, init),
): void {
  try {
    if (!claimFirstReport(error)) return;
    pageClientErrorReporter(send)({ ...safeThrownDescription(error), route: window.location.pathname });
  } catch {
  }
}

export function reportPageClientError(
  report: ClientErrorReport,
  send: ClientErrorTransport = (url, init) => fetch(url, init),
): void {
  try {
    pageClientErrorReporter(send)(report);
  } catch {
  }
}

export function installClientErrorReporting(
  send: ClientErrorTransport = (url, init) => fetch(url, init),
): void {
  try {
    if (typeof window === "undefined" || window.__homeClientErrorReportingInstalled) return;
    window.__homeClientErrorReportingInstalled = true;
    const report = pageClientErrorReporter(send);

    window.addEventListener("error", (event) => {
      try {
        if (!claimFirstReport(event.error)) return;
        const description = safeThrownDescription(event.error);
        report({
          name: description.name,
          message: event.message || description.message,
          route: window.location.pathname,
        });
      } catch {
      }
    });

    window.addEventListener("unhandledrejection", (event) => {
      try {
        if (!claimFirstReport(event.reason)) return;
        const description = safeThrownDescription(event.reason);
        report({ ...description, route: window.location.pathname });
      } catch {
      }
    });
  } catch {
  }
}
