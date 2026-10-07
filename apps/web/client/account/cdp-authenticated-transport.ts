"use client";

import { useCallback, useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AccountResourceOptions,
  AccountSessionStatus,
} from "./cdp-client";
import type { OwnerGenerationFence } from "./cdp-session-lifecycle";
import type { SessionFetch, VerifiedAccountSession } from "./session-client";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { readJson } from "@/shared/http/read-json";
import { TransferExecutionError } from "@/shared/transfers/types";
import { parsePrepareActionErrorResponse, parseProductNotOfferedPrepareErrorResponse } from "@/shared/actions/contracts/prepare";
import { parseConfirmActionErrorResponse } from "@/shared/actions/contracts/confirm";
import { parseHandleActionErrorResponse } from "@/shared/actions/contracts/handle";
import { browserHomeQueryClient, useHomeQueryClient } from "@/client/query/query-client";
import {
  deploymentHeaders,
  throwIfDeploymentExpired,
} from "@/client/query/deployment-headers";
import {
  applyActionHandleEffects,
  createBalanceFreshnessState,
  invalidateAfterAction,
  resetBalanceFreshness,
  startBalanceFreshness,
} from "@/client/query/after-action";
import { redirectOnAccessRequired, type AccessNavigation } from "./access-response";
import { dataOwnerKey } from "./owner-keys";
import { ResourceFailure, type ResourceFailureKind } from "./resource-failure";

type MoneyActionApiFetch = (path: string, init?: RequestInit) => Promise<unknown>;

const walletFreeAccountResourcePrefixes = ["/api/account/country-preference", "/api/support"] as const;

const accountResourcePrefixes = [
  ...walletFreeAccountResourcePrefixes,
  "/api/account/email-request",
  "/api/invites/link",
  "/api/actions",
  "/api/activity/orders",
  "/api/balances",
  "/api/trades",
  "/api/transfers",
  "/api/borrow",
  "/api/cards",
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

function actionErrorDetails(pathname: string, payload: unknown): { code: string | null; serverMessage: string | null } {
  if (/^\/api\/actions\/[^/]+\/confirm$/.test(pathname)) {
    const parsed = parseConfirmActionErrorResponse(payload);
    return parsed
      ? { code: parsed.error.code, serverMessage: parsed.error.message }
      : { code: null, serverMessage: responseErrorDetails(payload).serverMessage };
  }
  if (/^\/api\/actions\/[^/]+\/handle$/.test(pathname)) {
    const parsed = parseHandleActionErrorResponse(payload);
    return parsed
      ? { code: parsed.error.code, serverMessage: parsed.error.message }
      : { code: null, serverMessage: responseErrorDetails(payload).serverMessage };
  }
  if (pathname === "/api/actions/prepare") {
    const parsed = parsePrepareActionErrorResponse(payload);
    if (parsed) return { code: parsed.error.code, serverMessage: parsed.error.message };
    const productNotOffered = parseProductNotOfferedPrepareErrorResponse(payload);
    if (productNotOffered) return { code: productNotOffered.error.code, serverMessage: productNotOffered.error.message };
  }
  return responseErrorDetails(payload);
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

/** @public Regression surface for an already-aborted handle request. */
export function handleRequestShowsBroadcast(body: string | undefined): boolean {
  if (!body) return false;
  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    return (
      ("transactionHash" in payload && typeof payload.transactionHash === "string" && payload.transactionHash.length > 0) ||
      ("providerHandle" in payload && typeof payload.providerHandle === "string" && payload.providerHandle.length > 0)
    );
  } catch {
    return false;
  }
}

export function qualifyBalancesForUnrecordedHandle({ queryClient, dataOwnerKey, actionId, recordsHandle, status, unreadable, dispatched = true, transactionHash = false }: {
  queryClient: QueryClient;
  dataOwnerKey: string;
  actionId: string;
  recordsHandle: boolean;
  status: number | null;
  unreadable: boolean;
  dispatched?: boolean;
  transactionHash?: boolean;
}): void {
  if (!recordsHandle || !dispatched) return;
  if (!(unreadable || status === null || status === 409 || status >= 500 || (status === 404 && transactionHash))) return;
  void invalidateAfterAction({ queryClient, dataOwnerKey, actionId });
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
  accessNavigation,
}: {
  session: VerifiedAccountSession | null;
  status: AccountSessionStatus;
  verification: "provisional" | "server" | null;
  ownerKey: string | null;
  ownerFence: OwnerGenerationFence;
  getAccessToken: () => Promise<string | null>;
  sessionFetch?: SessionFetch;
  authentication?: "cdp" | "native-base";
  accessNavigation?: AccessNavigation;
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
        | "/api/balances"
        | "/api/activity"
        | "/api/actions"
        | "/api/account/country-preference",
      signal?: AbortSignal,
      query?: string,
      allowProvisionalRead = false,
      onStage?: (stage: "fetch" | "response") => void,
    ): Promise<unknown> => {
      const provisionalRead = allowProvisionalRead &&
        (endpoint === "/api/balances" || endpoint === "/api/account/country-preference") &&
        verification === "provisional" && status === "validating" &&
        session?.smartAccount;
      if (!session || !ownerKey || (!provisionalRead && (status !== "verified" || verification !== "server"))) {
        throw new ResourceFailure("session");
      }
      const generation = provisionalRead ? ownerFence.capture() : null;
      const assertCurrent = () => {
        if (generation !== null && !ownerFence.isCurrent(generation)) {
          throw new ResourceFailure("session");
        }
      };
      assertCurrent();
      const accessToken = await getAccessToken();
      assertCurrent();
      if (authentication === "cdp" && !accessToken) {
        throw new ResourceFailure("session");
      }

      const skewHeaders = deploymentHeaders();
      let response: Response;
      try {
        onStage?.("fetch");
        response = await (sessionFetch ?? fetch)(
          query ? `${endpoint}?${query}` : endpoint,
          {
            method: "GET",
            headers: {
              ...skewHeaders,
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
        throw new ResourceFailure("network");
      }
      onStage?.("response");
      assertCurrent();
      if (await redirectOnAccessRequired(response, accessNavigation)) {
        assertCurrent();
        throw new ResourceFailure("access", "Deployment access is required.");
      }
      if (!response.ok) {
        let details = { code: null as string | null, serverMessage: null as string | null };
        try {
          details = responseErrorDetails(await readJson(response));
        } catch {
        }
        throwIfDeploymentExpired(response, skewHeaders, details.code);
        assertCurrent();
        const unavailable = new ResourceFailure("http", undefined, response.status);
        Object.assign(unavailable, { status: response.status, ...details });
        throw unavailable;
      }
      try {
        const value = await readJson(response);
        assertCurrent();
        return value;
      } catch (error) {
        if (error instanceof ResourceFailure) throw error;
        throw new ResourceFailure("parse");
      }
    },
    [accessNavigation, authentication, getAccessToken, ownerFence, ownerKey, session, sessionFetch, status, verification],
  );

  const startActionBalanceFreshness = useCallback((actionId: string) => startBalanceFreshness({
    actionId,
    session,
    queryClient,
    fetchVerifiedResource,
    state: freshnessState.current,
  }), [fetchVerifiedResource, queryClient, session]);

  const requestAccountResource = useCallback(
    async (path: string, options: { method: "GET" | "POST" | "PUT"; body?: string; accept: string; signal?: AbortSignal }): Promise<{ response: Response; assertActive: () => void; recordsHandle: boolean; qualifyUncertainHandle: (status: number | null, unreadable: boolean, dispatched?: boolean) => void }> => {
      const safePath = normalizeAccountResourcePath(path);
      const pathname = new URL(safePath, "https://home.invalid").pathname;
      const walletFree = walletFreeAccountResourcePrefixes.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      );
      if (!session || status !== "verified" || verification !== "server" ||
          (!walletFree && (!ownerKey || !session.smartAccount))) {
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
      const method = options.method;
      if (method === "GET" && options.body !== undefined) {
        throw new TransferExecutionError("invalid-request");
      }

      const recordsHandle = method === "POST" && /^\/api\/actions\/[^/]+\/handle$/.test(pathname);
      let transactionHash = false;
      try {
        const body: unknown = JSON.parse(options.body ?? "{}");
        transactionHash = Boolean(body && typeof body === "object" && "transactionHash" in body &&
          typeof body.transactionHash === "string" && body.transactionHash.length > 0);
      } catch {
      }
      const qualifyUncertainHandle = (status: number | null, unreadable: boolean, dispatched = true) => {
        const actionId = pathname.split("/")[3];
        if (!recordsHandle || !actionId || !session.smartAccount || !ownerFence.isCurrent(identity)) return;
        qualifyBalancesForUnrecordedHandle({ queryClient, dataOwnerKey: dataOwnerKey(session), actionId, recordsHandle, status, unreadable, dispatched, transactionHash });
        if (status === 404 && transactionHash && dispatched) void startActionBalanceFreshness(actionId);
      };
      const skewHeaders = deploymentHeaders();
      let response: Response;
      const abortedBeforeSend = options.signal?.aborted === true;
      try {
        response = await (sessionFetch ?? fetch)(safePath, {
          method,
          headers: {
            ...skewHeaders,
            Accept: options.accept,
            ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
            ...(authentication === "cdp" ? { Authorization: `Bearer ${accessToken}` } : {}),
            [ACCOUNT_PROVIDER_HEADER]: session.accountProvider,
          },
          ...(method !== "GET" ? { body: options.body ?? "{}" } : {}),
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) {
          qualifyUncertainHandle(null, false, !abortedBeforeSend || handleRequestShowsBroadcast(options.body));
          throw error;
        }
        if (error instanceof TransferExecutionError) throw error;
        qualifyUncertainHandle(null, false);
        throw Object.assign(new TransferExecutionError("unavailable", error), { kind: "network" satisfies ResourceFailureKind });
      }
      assertActive();
      if (await redirectOnAccessRequired(response, accessNavigation)) {
        assertActive();
        throw Object.assign(new TransferExecutionError("unavailable"), { kind: "access" satisfies ResourceFailureKind });
      }
      if (!response.ok) {
        let details = { code: null as string | null, serverMessage: null as string | null };
        try {
          const payload: unknown = await readJson(response);
          details = actionErrorDetails(pathname, payload);
        } catch {
        }
        throwIfDeploymentExpired(response, skewHeaders, details.code);
        qualifyUncertainHandle(response.status, false);
        const failure = new TransferExecutionError(
          response.status === 409 ? "submission-pending" : "unavailable",
        );
        Object.assign(failure, { kind: "http" satisfies ResourceFailureKind, status: response.status, ...details });
        throw failure;
      }
      return { response, assertActive, recordsHandle, qualifyUncertainHandle };
    },
    [accessNavigation, authentication, getAccessToken, ownerFence, ownerKey, queryClient, session, sessionFetch, startActionBalanceFreshness, status, verification],
  );

  const fetchAccountResource = useCallback(
    async (path: string, options: AccountResourceOptions = {}): Promise<unknown> => {
      const safePath = normalizeAccountResourcePath(path);
      const { response, assertActive, recordsHandle, qualifyUncertainHandle } = await requestAccountResource(path, {
        method: options.method ?? "GET",
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        accept: "application/json",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (!session) throw new TransferExecutionError("stale-session");
      try {
        const value = await readJson(response);
        assertActive();
        if (recordsHandle) {
          const ownerDataKey = dataOwnerKey(session);
          void applyActionHandleEffects({
            path: safePath,
            body: options.body,
            response: value,
            dataOwnerKey: ownerDataKey,
            queryClient,
            startBalanceFreshness: startActionBalanceFreshness,
          });
        }
        return value;
      } catch (error) {
        if (error instanceof TransferExecutionError) throw error;
        qualifyUncertainHandle(response.status, true);
        throw Object.assign(new TransferExecutionError("unavailable", error), { kind: "parse" satisfies ResourceFailureKind });
      }
    },
    [queryClient, requestAccountResource, session, startActionBalanceFreshness],
  );

  const fetchAccountResponse = useCallback(
    async (path: string, options: { body: string; signal?: AbortSignal }): Promise<Response> => {
      const { response } = await requestAccountResource(path, {
        method: "POST",
        body: options.body,
        accept: "text/event-stream",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      return response;
    },
    [requestAccountResource],
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

  const fetchCountryPreference = useCallback(
    (signal?: AbortSignal) => fetchVerifiedResource("/api/account/country-preference", signal, undefined, true),
    [fetchVerifiedResource],
  );
  const fetchBalances = useCallback(
    (region: import("@/config/regions").RegionId, signal?: AbortSignal, onStage?: (stage: "fetch" | "response") => void) =>
      fetchVerifiedResource(
        "/api/balances",
        signal,
        new URLSearchParams({ region }).toString(),
        true,
        onStage,
      ),
    [fetchVerifiedResource],
  );
  const fetchActivity = useCallback(
    (query: string, signal?: AbortSignal) =>
      fetchVerifiedResource("/api/activity", signal, query),
    [fetchVerifiedResource],
  );
  return {
    fetchBalances,
    fetchActivity,
    fetchAccountResource,
    fetchAccountResponse,
    fetchCountryPreference,
    fetchMoneyActionApi,
    reset,
  };
}

export type AuthenticatedTransport = ReturnType<typeof useAuthenticatedTransport>;
