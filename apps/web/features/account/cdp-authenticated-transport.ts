"use client";

import { useCallback } from "react";
import type {
  AccountResourceOptions,
  AccountSessionStatus,
} from "./cdp-client";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import { ACCOUNT_PROVIDER_HEADER } from "./session-types";
import { TransferExecutionError } from "@/features/transfers/types";
import type { MoneyActionApiFetch } from "@/features/money-actions/client";

export function accountAuthorizationBoundary(
  ownerKey: string,
  session: VerifiedAccountSession,
): string | null {
  return session.smartAccount
    ? `${ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

const accountResourcePrefixes = [
  "/api/actions",
  "/api/savings/actions",
  "/api/trades",
  "/api/borrow",
  "/api/funding",
] as const;

export function normalizeAccountResourcePath(path: string): string {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("#") ||
    /(?:^|\/)\.\.?($|\/)|%2e|%2f|%5c/i.test(path)
  ) {
    throw new TransferExecutionError("invalid-request");
  }
  let url: URL;
  try {
    url = new URL(path, "https://home.invalid");
  } catch {
    throw new TransferExecutionError("invalid-request");
  }
  if (
    url.origin !== "https://home.invalid" ||
    !accountResourcePrefixes.some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    )
  ) {
    throw new TransferExecutionError("invalid-request");
  }
  return `${url.pathname}${url.search}`;
}

function responseErrorDetails(payload: unknown): {
  code: string | null;
  serverMessage: string | null;
} {
  let code: string | null = null;
  let serverMessage: string | null = null;
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object"
  ) {
    const error = payload.error;
    if ("code" in error && typeof error.code === "string") code = error.code;
    if ("message" in error && typeof error.message === "string") {
      serverMessage = error.message;
    }
  }
  return { code, serverMessage };
}

export function useAuthenticatedTransport({
  session,
  status,
  ownerKey,
  ownerFence,
  getAccessToken,
  sessionFetch,
}: {
  session: VerifiedAccountSession | null;
  status: AccountSessionStatus;
  ownerKey: string | null;
  ownerFence: OwnerGenerationFence;
  getAccessToken: () => Promise<string | null>;
  sessionFetch?: SessionFetch;
}) {
  const fetchVerifiedResource = useCallback(
    async (
      endpoint:
        | "/api/portfolio"
        | "/api/portfolio/valuation"
        | "/api/activity"
        | "/api/savings/positions",
      signal?: AbortSignal,
      query?: string,
    ): Promise<unknown> => {
      if (!session || status !== "verified" || !ownerKey) {
        throw new Error("Authenticated resource is unavailable.");
      }
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Authenticated resource is unavailable.");
      }

      let response: Response;
      try {
        response = await (sessionFetch ?? fetch)(
          query ? `${endpoint}?${query}` : endpoint,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`,
              [ACCOUNT_PROVIDER_HEADER]: session.accountProvider,
            },
            cache: "no-store",
            credentials: "same-origin",
            signal,
          },
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error("Authenticated resource is unavailable.");
      }
      if (!response.ok) {
        let details = { code: null as string | null, serverMessage: null as string | null };
        try {
          details = responseErrorDetails(await response.json());
        } catch {
          // Fixed-endpoint callers only need the bounded status/code seam.
        }
        const unavailable = new Error("Authenticated resource is unavailable.");
        Object.assign(unavailable, { status: response.status, ...details });
        throw unavailable;
      }
      try {
        return await response.json();
      } catch {
        throw new Error("Authenticated resource is unavailable.");
      }
    },
    [getAccessToken, ownerKey, session, sessionFetch, status],
  );

  const fetchAccountResource = useCallback(
    async (path: string, options: AccountResourceOptions = {}): Promise<unknown> => {
      const safePath = normalizeAccountResourcePath(path);
      if (!session?.smartAccount || status !== "verified" || !ownerKey) {
        throw new TransferExecutionError("stale-session");
      }
      const boundary = accountAuthorizationBoundary(ownerKey, session);
      const identity = ownerFence.capture(ownerKey, boundary);
      const assertActive = () => {
        if (!ownerFence.isCurrent(identity)) {
          throw new TransferExecutionError("stale-session");
        }
      };
      assertActive();
      const accessToken = await getAccessToken();
      assertActive();
      if (!accessToken) throw new TransferExecutionError("stale-session");
      const method = options.method ?? "GET";
      if (method === "GET" && options.body !== undefined) {
        throw new TransferExecutionError("invalid-request");
      }
      let response: Response;
      try {
        response = await (sessionFetch ?? fetch)(safePath, {
          method,
          headers: {
            Accept: "application/json",
            ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
            Authorization: `Bearer ${accessToken}`,
            [ACCOUNT_PROVIDER_HEADER]: session.accountProvider,
          },
          ...(method === "POST" ? { body: JSON.stringify(options.body ?? {}) } : {}),
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (error instanceof TransferExecutionError) throw error;
        throw new TransferExecutionError("unavailable", error);
      }
      assertActive();
      if (!response.ok) {
        let details = { code: null as string | null, serverMessage: null as string | null };
        try {
          details = responseErrorDetails(await response.json());
        } catch {
          // Money-action callers only need the bounded status/code seam.
        }
        const failure = new TransferExecutionError(
          response.status === 409 ? "submission-pending" : "unavailable",
        );
        Object.assign(failure, { status: response.status, ...details });
        throw failure;
      }
      try {
        const value = await response.json();
        assertActive();
        return value;
      } catch (error) {
        if (error instanceof TransferExecutionError) throw error;
        throw new TransferExecutionError("unavailable", error);
      }
    },
    [getAccessToken, ownerFence, ownerKey, session, sessionFetch, status],
  );

  const fetchMoneyActionApi = useCallback<MoneyActionApiFetch>(
    (path, init = {}) =>
      fetchAccountResource(path, {
        method: init.method === "POST" ? "POST" : "GET",
        ...(init.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
        ...(init.signal ? { signal: init.signal } : {}),
      }),
    [fetchAccountResource],
  );

  const fetchPortfolio = useCallback(
    (signal?: AbortSignal) => fetchVerifiedResource("/api/portfolio", signal),
    [fetchVerifiedResource],
  );
  const fetchPortfolioValuation = useCallback(
    (region: import("@/config/regions").RegionId, signal?: AbortSignal) =>
      fetchVerifiedResource(
        "/api/portfolio/valuation",
        signal,
        new URLSearchParams({ region }).toString(),
      ),
    [fetchVerifiedResource],
  );
  const fetchActivity = useCallback(
    (query: string, signal?: AbortSignal) =>
      fetchVerifiedResource("/api/activity", signal, query),
    [fetchVerifiedResource],
  );
  const fetchSavingsPositions = useCallback(
    (signal?: AbortSignal) =>
      fetchVerifiedResource("/api/savings/positions", signal),
    [fetchVerifiedResource],
  );

  return {
    fetchPortfolio,
    fetchPortfolioValuation,
    fetchActivity,
    fetchSavingsPositions,
    fetchAccountResource,
    fetchMoneyActionApi,
  };
}

export type AuthenticatedTransport = ReturnType<typeof useAuthenticatedTransport>;
