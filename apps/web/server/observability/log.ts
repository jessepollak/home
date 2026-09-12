import {
  normalizeObservabilityEvent,
  type ObservabilityEvent,
  type ObservabilityLogLine,
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
