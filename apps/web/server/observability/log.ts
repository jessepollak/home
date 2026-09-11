import {
  normalizeObservabilityEvent,
  type ObservabilityEvent,
  type ObservabilityLogLine,
} from "./schema";

export type ObservabilityLogWriter = (
  serializedLine: string,
  level: ObservabilityLogLine["level"],
) => void;

function defaultWriter(serializedLine: string): void {
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
    writer(JSON.stringify(line), line.level);
  } catch {
    // Observability is never allowed to change application behavior.
  }
  return line;
}
