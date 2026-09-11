const STORAGE_KEY = "home:dev-auth-diagnostics:v1";
const MAX_EVENTS = 20;

export type AuthDiagnosticSignOutReason =
  | "quarantine"
  | "blocked-or-pending"
  | "invalidated-base"
  | "no-token-or-401"
  | "explicit-logout"
  | "explicit-cancel";

type AuthDiagnosticEvent =
  | {
      at: string;
      kind: "auth-state";
      initialized: boolean;
      signedIn: boolean;
      ownerPresent: boolean;
      status:
        | "restoring"
        | "validating"
        | "verified"
        | "signed-out"
        | "unavailable"
        | "signing-out"
        | "signout-error";
      providerSelection:
        | "restoring"
        | "cdp-embedded"
        | "base-account"
        | "pending-authentication"
        | "blocked-authentication";
      suppressed: boolean;
    }
  | { at: string; kind: "signout"; reason: AuthDiagnosticSignOutReason }
  | {
      at: string;
      kind: "token";
      outcome: "present" | "missing" | "error";
      errorClass?: "abort" | "sdk-error" | "unknown";
    }
  | {
      at: string;
      kind: "session";
      outcome:
        | "http-2xx"
        | "http-401"
        | "http-4xx"
        | "http-5xx"
        | "network-error"
        | "invalid-json"
        | "invalid-response";
      errorClass?: "abort" | "fetch-error" | "unknown";
    };

declare global {
  interface Window {
    __HOME_AUTH_DIAGNOSTICS__?: () => readonly AuthDiagnosticEvent[];
  }
}

type AuthDiagnosticInput = AuthDiagnosticEvent extends infer Event
  ? Event extends { at: string }
    ? Omit<Event, "at">
    : never
  : never;

export function recordAuthDiagnostic(event: AuthDiagnosticInput): void {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
    return;
  }
  const next: AuthDiagnosticEvent = {
    ...event,
    at: new Date().toISOString(),
  } as AuthDiagnosticEvent;
  try {
    const events = readStoredEvents();
    events.push(next);
    const bounded = events.slice(-MAX_EVENTS);
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
    window.__HOME_AUTH_DIAGNOSTICS__ = () => readStoredEvents();
  } catch {
    // Diagnostics must never affect authentication behavior.
  }
}

export function classifyAuthDiagnosticError(
  error: unknown,
): "abort" | "sdk-error" | "unknown" {
  if (error instanceof DOMException && error.name === "AbortError") return "abort";
  if (error instanceof Error) return "sdk-error";
  return "unknown";
}

function readStoredEvents(): AuthDiagnosticEvent[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed.filter(isSafeEvent).slice(-MAX_EVENTS) as AuthDiagnosticEvent[])
      : [];
  } catch {
    return [];
  }
}

function isSafeEvent(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const event = value as Record<string, unknown>;
  return (
    typeof event.at === "string" &&
    typeof event.kind === "string" &&
    ["auth-state", "signout", "token", "session"].includes(event.kind)
  );
}
