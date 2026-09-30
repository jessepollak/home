import "server-only";

import { createHash } from "node:crypto";
import {
  normalizeObservabilityEvent,
  type ObservabilityEvent,
  type ObservabilityLogLine,
  type ServerEventKind,
  type ServerEventOutcome,
  type UpstreamCallCode,
  type UpstreamCallOutcome,
} from "./schema";

export type ObservabilityLogWriter = (
  serializedLine: string,
  level: ObservabilityLogLine["level"],
) => unknown | PromiseLike<unknown>;

function defaultWriter(
  serializedLine: string,
  level: ObservabilityLogLine["level"],
): void {
  if (level === "info") {
    console.info(serializedLine);
    return;
  }
  console.error(serializedLine);
}

let writer: ObservabilityLogWriter = defaultWriter;

/** @public exercised by app/api/client-errors/route.test.ts */
export function setObservabilityLogWriterForTests(
  nextWriter?: ObservabilityLogWriter,
): void {
  writer = nextWriter ?? defaultWriter;
}

export function emitServerEvent(
  kind: Exclude<ServerEventKind, "upstream-call">,
  fields: {
    route: string;
    code: string;
    outcome: ServerEventOutcome;
    provider?: string;
    region?: string;
    sandbox?: boolean;
    owner?: { subject: string; accountProvider: string };
    durationMs?: number;
  },
): ObservabilityLogLine | undefined {
  try {
    const ownerHash = fields.owner
      ? createHash("sha256")
          .update(`${fields.owner.accountProvider}\0${fields.owner.subject}`)
          .digest("hex")
          .slice(0, 32)
      : undefined;
    return writeObservabilityEvent({
      kind,
      route: fields.route,
      code: fields.code,
      outcome: fields.outcome,
      ...(fields.provider ? { provider: fields.provider } : {}),
      ...(fields.region ? { region: fields.region } : {}),
      ...(typeof fields.sandbox === "boolean" ? { sandbox: fields.sandbox } : {}),
      ...(ownerHash ? { ownerHash } : {}),
      durationMs: fields.durationMs ?? 0,
    });
  } catch {
    return undefined;
  }
}

export function emitUpstreamCall(fields: {
  route: string;
  code: UpstreamCallCode;
  outcome: UpstreamCallOutcome;
  method: string;
  statusCode?: number;
  errorType?: string;
  provider?: string;
  durationMs: number;
}): ObservabilityLogLine | undefined {
  try {
    return writeObservabilityEvent({
      kind: "upstream-call",
      route: fields.route,
      code: fields.code,
      outcome: fields.outcome,
      "http.request.method": fields.method,
      ...(fields.statusCode === undefined ? {} : { "http.response.status_code": fields.statusCode }),
      ...(fields.errorType === undefined ? {} : { "error.type": fields.errorType }),
      ...(fields.provider === undefined ? {} : { provider: fields.provider }),
      durationMs: fields.durationMs,
    });
  } catch {
    return undefined;
  }
}

export function writeObservabilityEvent(
  event: ObservabilityEvent,
): ObservabilityLogLine | undefined {
  try {
    const line = normalizeObservabilityEvent(event);
    const result = writer(JSON.stringify(line), line.level);
    void Promise.resolve(result).catch(() => {
    });
    return line;
  } catch {
    return undefined;
  }
}

export function observeSafely(report: () => unknown): void {
  try {
    void Promise.resolve(report()).catch(() => undefined);
  } catch {
    return;
  }
}
