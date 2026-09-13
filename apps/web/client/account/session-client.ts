import { recordAuthDiagnostic } from "./auth-diagnostics";
import { parseSession } from "@/shared/account/contracts/session";
import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProviderRequest,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";

export { BASE_CHAIN_ID } from "@/shared/account/session-types";
export type { VerifiedAccountSession } from "@/shared/account/session-types";

export type SessionValidationFailure =
  | "unauthenticated"
  | "unavailable"
  | "invalid-response"
  | "address-mismatch";

export class SessionValidationError extends Error {
  readonly reason: SessionValidationFailure;

  constructor(reason: SessionValidationFailure) {
    super(reason);
    this.name = "SessionValidationError";
    this.reason = reason;
  }
}

function normalizeAddress(value: string): `0x${string}` {
  return value.toLowerCase() as `0x${string}`;
}

export function normalizeProjectId(value: string | undefined): string | null {
  const projectId = value?.trim();
  return projectId ? projectId : null;
}

export type SessionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type SessionValidationOptions = {
  accountProvider?: AccountProviderRequest;
  expectedAddress?: `0x${string}`;
  authentication?: "cdp" | "native-base";
};

export async function validateAccountSession(
  accessToken: string | null,
  signal?: AbortSignal,
  fetchImplementation: SessionFetch = fetch,
  options: SessionValidationOptions = {},
): Promise<VerifiedAccountSession> {
  const authentication = options.authentication ?? "cdp";
  if (authentication === "cdp" && !accessToken?.trim()) {
    throw new SessionValidationError("unauthenticated");
  }
  if (authentication === "native-base" && options.accountProvider === "cdp-embedded") {
    throw new SessionValidationError("invalid-response");
  }

  const accountProvider = options.accountProvider ?? "cdp-embedded";
  let response: Response;
  try {
    response = await fetchImplementation("/api/session", {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(authentication === "cdp"
          ? { Authorization: `Bearer ${accessToken}` }
          : {}),
        [ACCOUNT_PROVIDER_HEADER]: accountProvider,
      },
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    recordAuthDiagnostic({
      kind: "session",
      outcome: "network-error",
      errorClass:
        signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
          ? "abort"
          : error instanceof Error
            ? "fetch-error"
            : "unknown",
    });
    if (signal?.aborted) {
      throw error;
    }
    throw new SessionValidationError("unavailable");
  }

  recordAuthDiagnostic({
    kind: "session",
    outcome:
      response.status === 401
        ? "http-401"
        : response.ok
          ? "http-2xx"
          : response.status >= 500
            ? "http-5xx"
            : "http-4xx",
  });

  if (response.status === 401) {
    throw new SessionValidationError("unauthenticated");
  }

  if (!response.ok) {
    throw new SessionValidationError("unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    recordAuthDiagnostic({ kind: "session", outcome: "invalid-json" });
    throw new SessionValidationError("invalid-response");
  }

  const session = parseSession(payload);
  if (
    !session ||
    (accountProvider !== "restore" && session.accountProvider !== accountProvider)
  ) {
    recordAuthDiagnostic({ kind: "session", outcome: "invalid-response" });
    throw new SessionValidationError("invalid-response");
  }

  if (
    options.expectedAddress &&
    session.smartAccount?.address !== normalizeAddress(options.expectedAddress)
  ) {
    throw new SessionValidationError("address-mismatch");
  }

  return session;
}
