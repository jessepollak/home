import { createHash } from "node:crypto";
import {
  normalizeObservabilityEvent,
  type ObservabilityEvent,
  type ObservabilityLogLine,
  type ServerEventKind,
  type ServerEventOutcome,
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

export function setObservabilityLogWriterForTests(
  nextWriter?: ObservabilityLogWriter,
): void {
  writer = nextWriter ?? defaultWriter;
}

export function emitServerEvent(
  kind: ServerEventKind,
  fields: {
    route: string;
    code: string;
    outcome: ServerEventOutcome;
    provider?: string;
    owner?: { subject: string; accountProvider: string };
    durationMs?: number;
  },
): ObservabilityLogLine {
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
    ...(ownerHash ? { ownerHash } : {}),
    durationMs: fields.durationMs ?? 0,
  });
}

export function writeObservabilityEvent(
  event: ObservabilityEvent,
): ObservabilityLogLine {
  const line = normalizeObservabilityEvent(event);
  try {
    const result = writer(JSON.stringify(line), line.level);
    void Promise.resolve(result).catch(() => {
      // Asynchronous sink rejection must never escape application work.
    });
  } catch {
    // Synchronous sink failure must never change application behavior.
  }
  return line;
}
