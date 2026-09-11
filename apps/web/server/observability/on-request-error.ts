import { writeObservabilityEvent } from "./log";
import type { ObservabilityEvent } from "./schema";

export type RequestErrorInfo = {
  path: string;
  method: string;
  headers: { [key: string]: string | string[] | undefined };
};

export type RequestErrorContext = {
  routePath: string;
  routeType: string;
};

function safeErrorName(error: unknown): string {
  try {
    return error instanceof Error && typeof error.name === "string"
      ? error.name
      : "Error";
  } catch {
    return "Error";
  }
}

export function buildUnhandledServerErrorEvent(
  error: unknown,
  request: RequestErrorInfo,
  context: RequestErrorContext,
): ObservabilityEvent {
  return {
    kind: "unhandled-server-error",
    route: context.routePath,
    method: request.method,
    errorName: safeErrorName(error),
    routeType: context.routeType,
  };
}

export async function handleRequestError(
  error: unknown,
  request: RequestErrorInfo,
  context: RequestErrorContext,
): Promise<void> {
  try {
    writeObservabilityEvent(
      buildUnhandledServerErrorEvent(error, request, context),
    );
  } catch {
    // Next error handling must remain the only owner of the application failure.
  }
}
