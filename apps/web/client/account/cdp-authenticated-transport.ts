"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
  AccountResourceOptions,
  AccountSessionStatus,
} from "./cdp-client";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { TransferExecutionError } from "@/shared/transfers/types";
import { browserHomeQueryClient, useHomeQueryClient } from "@/client/query/query-client";
import {
  applyActionHandleEffects,
  createBalanceFreshnessState,
  resetBalanceFreshness,
  startBalanceFreshness,
} from "@/client/query/after-action";
import { dataOwnerKey } from "./owner-keys";

type MoneyActionApiFetch = (path: string, init?: RequestInit) => Promise<unknown>;

const accountResourcePrefixes = [
  "/api/actions",
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
  verification,
  ownerKey,
  ownerFence,
  getAccessToken,
  sessionFetch,
  authentication = "cdp",
}: {
  session: VerifiedAccountSession | null;
  status: AccountSessionStatus;
  verification: "provisional" | "server" | null;
  ownerKey: string | null;
  ownerFence: OwnerGenerationFence;
  getAccessToken: () => Promise<string | null>;
  sessionFetch?: SessionFetch;
  authentication?: "cdp" | "native-base";
}) {
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const freshnessState = useRef(createBalanceFreshnessState());
  const reset = useCallback(() => {
    resetBalanceFreshness(freshnessState.current);
  }, []);
  useEffect(() => reset, [reset]);

  const fetchVerifiedResource = useCallback(
    async (
      endpoint:
        | "/api/portfolio"
        | "/api/portfolio/valuation"
        | "/api/activity"
        | "/api/savings/positions"
        | "/api/actions",
      signal?: AbortSignal,
      query?: string,
    ): Promise<unknown> => {
      if (!session || status !== "verified" || verification !== "server" || !ownerKey) {
        throw new Error("Authenticated resource is unavailable.");
      }
      const accessToken = await getAccessToken();
      if (authentication === "cdp" && !accessToken) {
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
              ...(authentication === "cdp" ? { Authorization: `Bearer ${accessToken}` } : {}),
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
    [authentication, getAccessToken, ownerKey, session, sessionFetch, status, verification],
  );

  const startActionBalanceFreshness = useCallback((actionId: string) => startBalanceFreshness({
    actionId,
    session,
    queryClient,
    fetchVerifiedResource,
    state: freshnessState.current,
  }), [fetchVerifiedResource, queryClient, session]);

  const fetchAccountResource = useCallback(
    async (path: string, options: AccountResourceOptions = {}): Promise<unknown> => {
      const safePath = normalizeAccountResourcePath(path);
      if (!session?.smartAccount || status !== "verified" || verification !== "server" || !ownerKey) {
        throw new TransferExecutionError("stale-session");
      }
      const identity = ownerFence.capture();
      const assertActive = () => {
        if (!ownerFence.isCurrent(identity)) {
          throw new TransferExecutionError("stale-session");
        }
      };
      assertActive();
      const accessToken = await getAccessToken();
      assertActive();
      if (authentication === "cdp" && !accessToken) throw new TransferExecutionError("stale-session");
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
            ...(authentication === "cdp" ? { Authorization: `Bearer ${accessToken}` } : {}),
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
        if (/^\/api\/actions\/[^/]+\/handle$/.test(new URL(safePath, "https://home.invalid").pathname)) {
          const ownerDataKey = dataOwnerKey(session);
          void applyActionHandleEffects({
            path: safePath,
            body: options.body,
            dataOwnerKey: ownerDataKey,
            queryClient,
            startBalanceFreshness: startActionBalanceFreshness,
          });
        }
        return value;
      } catch (error) {
        if (error instanceof TransferExecutionError) throw error;
        throw new TransferExecutionError("unavailable", error);
      }
    },
    [authentication, getAccessToken, ownerFence, ownerKey, queryClient, session, sessionFetch, startActionBalanceFreshness, status, verification],
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
    fetchPortfolioValuation,
    fetchActivity,
    fetchSavingsPositions,
    fetchAccountResource,
    fetchMoneyActionApi,
    reset,
  };
}

export type AuthenticatedTransport = ReturnType<typeof useAuthenticatedTransport>;
