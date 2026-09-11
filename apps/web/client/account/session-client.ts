import { recordAuthDiagnostic } from "./auth-diagnostics";
import {
  ACCOUNT_PROVIDER_HEADER,
  BASE_CHAIN_ID,
  type AccountProviderRequest,
  type VerifiedAccountSession,
} from "./session-types";

export { BASE_CHAIN_ID } from "./session-types";
export type { VerifiedAccountSession } from "./session-types";

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

export type VerifiedSessionOwner = {
  ownerKey: string;
  session: VerifiedAccountSession;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeAddress(value: string): `0x${string}` {
  return value.toLowerCase() as `0x${string}`;
}

function parseSession(value: unknown): VerifiedAccountSession | null {
  if (!isRecord(value) || !isRecord(value.user)) {
    return null;
  }

  const subject = value.user.subject;
  if (typeof subject !== "string" || subject.trim().length === 0) {
    return null;
  }

  const accountProvider = value.accountProvider;
  if (
    accountProvider !== "cdp-embedded" &&
    accountProvider !== "base-account"
  ) {
    return null;
  }

  if (value.smartAccount === null) {
    if (accountProvider === "base-account") {
      return null;
    }
    return {
      user: { subject },
      smartAccount: null,
      accountProvider,
    };
  }

  if (!isRecord(value.smartAccount)) {
    return null;
  }

  const { address, chainId } = value.smartAccount;
  if (
    typeof address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    chainId !== BASE_CHAIN_ID
  ) {
    return null;
  }

  return {
    user: { subject },
    smartAccount: {
      address: normalizeAddress(address),
      chainId: BASE_CHAIN_ID,
    },
    accountProvider,
  };
}

export function normalizeProjectId(value: string | undefined): string | null {
  const projectId = value?.trim();
  return projectId ? projectId : null;
}

export function getVisibleVerifiedSession(
  verified: VerifiedSessionOwner | null,
  currentOwnerKey: string | null,
  isSigningOut: boolean,
): VerifiedAccountSession | null {
  if (isSigningOut || !verified || verified.ownerKey !== currentOwnerKey) {
    return null;
  }

  return verified.session;
}

export type SessionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type SessionValidationOptions = {
  accountProvider?: AccountProviderRequest;
  expectedAddress?: `0x${string}`;
};

export async function validateAccountSession(
  accessToken: string,
  signal?: AbortSignal,
  fetchImplementation: SessionFetch = fetch,
  options: SessionValidationOptions = {},
): Promise<VerifiedAccountSession> {
  if (!accessToken.trim()) {
    throw new SessionValidationError("unauthenticated");
  }

  const accountProvider = options.accountProvider ?? "cdp-embedded";
  let response: Response;
  try {
    response = await fetchImplementation("/api/session", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
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
