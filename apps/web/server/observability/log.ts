import { ACCOUNT_PROVIDER_HEADER } from "@/features/account/session-types";
import { scrubString } from "@/features/observability/scrub";

export const OBSERVABILITY_SCHEMA = "home.observability.v1" as const;

export type LoggedAccountProvider = "cdp-embedded" | "base-account" | "restore";

export type ObservabilityKind =
  | "request"
  | "unhandled-server-error"
  | "client-error";

export type ObservabilityEvent = {
  kind: ObservabilityKind;
  route: string;
  status?: number;
  errorCode?: string;
  accountProvider?: LoggedAccountProvider;
  name?: string;
  message?: string;
  routeType?: string;
};

export type ObservabilityLogLine = {
  schema: typeof OBSERVABILITY_SCHEMA;
  kind: ObservabilityKind;
  route: string;
  status?: number;
  errorCode?: string;
  accountProvider?: LoggedAccountProvider;
  name?: string;
  message?: string;
  routeType?: string;
  level: "error" | "warn" | "info";
};

export type ObservabilityLogWriter = (
  line: string,
  level: ObservabilityLogLine["level"],
) => void;

function defaultWriter(line: string, level: ObservabilityLogLine["level"]): void {
  if (process.env.npm_lifecycle_event === "test") {
    return;
  }
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

let writer: ObservabilityLogWriter = defaultWriter;

export function setObservabilityLogWriterForTests(
  next?: ObservabilityLogWriter,
): void {
  writer = next ?? defaultWriter;
}

export function observabilityLevel(
  event: ObservabilityEvent,
): ObservabilityLogLine["level"] {
  if (event.kind !== "request") {
    return "error";
  }
  const status = event.status ?? 0;
  if (status >= 500) {
    return "error";
  }
  if (status >= 400) {
    return "warn";
  }
  return "info";
}

function compactString(value: string | undefined, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = scrubString(value).trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, max);
}

export function buildObservabilityLogLine(
  event: ObservabilityEvent,
): ObservabilityLogLine {
  const line: ObservabilityLogLine = {
    schema: OBSERVABILITY_SCHEMA,
    kind: event.kind,
    route: compactString(event.route, 256) ?? "/",
    level: observabilityLevel(event),
  };
  if (typeof event.status === "number" && Number.isInteger(event.status)) {
    line.status = event.status;
  }
  const errorCode = compactString(event.errorCode, 64);
  if (errorCode) {
    line.errorCode = errorCode;
  }
  if (
    event.accountProvider === "cdp-embedded" ||
    event.accountProvider === "base-account" ||
    event.accountProvider === "restore"
  ) {
    line.accountProvider = event.accountProvider;
  }
  const name = compactString(event.name, 128);
  if (name) {
    line.name = name;
  }
  const message = compactString(event.message, 256);
  if (message) {
    line.message = message;
  }
  const routeType = compactString(event.routeType, 32);
  if (routeType) {
    line.routeType = routeType;
  }
  return line;
}

export function writeStructuredLog(event: ObservabilityEvent): ObservabilityLogLine {
  const line = buildObservabilityLogLine(event);
  writer(JSON.stringify(line), line.level);
  return line;
}

export function readLoggedAccountProvider(
  request: Request,
): LoggedAccountProvider | undefined {
  const value = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (
    value === "cdp-embedded" ||
    value === "base-account" ||
    value === "restore"
  ) {
    return value;
  }
  return undefined;
}
