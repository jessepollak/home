"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  compareActivityTransferKeys,
  isVerifiedActivitySession,
  parseActivityPage,
} from "./parse";
import type {
  ActivityPage,
  ActivityState,
  ActivityTransfer,
  FetchActivity,
} from "./types";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

type OwnedActivityState =
  | {
      requestKey: null;
      status: "unavailable";
      page: null;
      loadingMore: false;
      loadMoreError: false;
      autoLoadPaused: false;
    }
  | {
      requestKey: string;
      status: "error";
      page: null;
      loadingMore: false;
      loadMoreError: false;
      autoLoadPaused: false;
      error: { code: string | null; message: string | null };
    }
  | {
      requestKey: string;
      status: "ready";
      page: ActivityPage;
      loadingMore: boolean;
      loadMoreError: boolean;
      autoLoadPaused: boolean;
    };

type LoadMoreRequest = {
  requestKey: string;
  sequence: number;
  cursor: string;
  controller: AbortController;
};

const unavailableState: OwnedActivityState = {
  requestKey: null,
  status: "unavailable",
  page: null,
  loadingMore: false,
  loadMoreError: false,
  autoLoadPaused: false,
};

export type UseActivityResult = ActivityState & {
  retry: () => void;
  refresh: () => void;
  loadMore: () => void;
  retryLoadMore: () => void;
};

export function useActivity(
  session: VerifiedAccountSession | null,
  fetchActivity: FetchActivity,
  refreshTrigger?: string | number,
): UseActivityResult {
  const sequence = useRef(0);
  const loadMoreRequest = useRef<LoadMoreRequest | null>(null);
  const attemptedCursors = useRef(new Set<string>());
  const [retryRevision, setRetryRevision] = useState(0);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [state, setState] = useState<OwnedActivityState>(unavailableState);
  const validSession = isVerifiedActivitySession(session) ? session : null;
  const subject = validSession?.user.subject ?? null;
  const walletAddress = validSession?.smartAccount.address ?? null;
  const provider = validSession?.accountProvider ?? null;
  const ownerKey =
    subject && walletAddress && provider
      ? `${subject}\u0000${walletAddress.toLowerCase()}\u00008453\u0000${provider}`
      : null;
  const requestKey = ownerKey
    ? `${ownerKey}\u0000${retryRevision}\u0000${refreshRevision}\u0000${String(refreshTrigger ?? "")}`
    : null;

  useEffect(() => {
    const requestSequence = ++sequence.current;
    loadMoreRequest.current?.controller.abort();
    loadMoreRequest.current = null;
    attemptedCursors.current = new Set();
    if (!subject || !walletAddress || !provider || !requestKey) {
      return;
    }

    const expectedSession: VerifiedAccountSession = {
      user: { subject },
      smartAccount: { address: walletAddress, chainId: 8453 },
      accountProvider: provider,
    };
    const controller = new AbortController();
    const windowEnd = new Date().toISOString();
    const query = new URLSearchParams({ to: windowEnd }).toString();

    void fetchActivity(query, controller.signal).then(
      (payload) => {
        if (controller.signal.aborted || sequence.current !== requestSequence) {
          return;
        }
        try {
          setState({
            requestKey,
            status: "ready",
            page: parseActivityPage(payload, expectedSession, windowEnd),
            loadingMore: false,
            loadMoreError: false,
            autoLoadPaused: false,
          });
        } catch {
          setState({
            requestKey,
            status: "error",
            page: null,
            loadingMore: false,
            loadMoreError: false,
            autoLoadPaused: false,
            error: {
              code: "ACTIVITY_RESPONSE_INVALID",
              message: "Activity history could not be verified.",
            },
          });
        }
      },
      (reason) => {
        if (controller.signal.aborted || sequence.current !== requestSequence) {
          return;
        }
        setState({
          requestKey,
          status: "error",
          page: null,
          loadingMore: false,
          loadMoreError: false,
          autoLoadPaused: false,
          error: readActivityFailure(reason),
        });
      },
    );

    return () => controller.abort();
  }, [fetchActivity, provider, requestKey, subject, walletAddress]);

  useEffect(
    () => () => {
      loadMoreRequest.current?.controller.abort();
      loadMoreRequest.current = null;
    },
    [],
  );

  const retry = useCallback(() => setRetryRevision((value) => value + 1), []);
  const refresh = useCallback(
    () => setRefreshRevision((value) => value + 1),
    [],
  );

  const requestMore = useCallback((manualRetry: boolean) => {
    if (
      !subject ||
      !walletAddress ||
      !provider ||
      !requestKey ||
      state.requestKey !== requestKey ||
      state.status !== "ready" ||
      state.loadingMore ||
      (!manualRetry && state.autoLoadPaused) ||
      loadMoreRequest.current
    ) {
      return;
    }

    const currentPage = state.page;
    const cursor = currentPage.nextCursor;
    if (!cursor) {
      return;
    }
    if (!manualRetry && attemptedCursors.current.has(cursor)) {
      return;
    }

    const expectedSession: VerifiedAccountSession = {
      user: { subject },
      smartAccount: { address: walletAddress, chainId: 8453 },
      accountProvider: provider,
    };
    const controller = new AbortController();
    const requestSequence = sequence.current;
    const request: LoadMoreRequest = {
      requestKey,
      sequence: requestSequence,
      cursor,
      controller,
    };
    loadMoreRequest.current = request;
    attemptedCursors.current.add(cursor);
    setState((current) =>
      current.requestKey === requestKey &&
      current.status === "ready" &&
      current.page.nextCursor === cursor &&
      !current.loadingMore
        ? { ...current, loadingMore: true, loadMoreError: false }
        : current,
    );

    const query = new URLSearchParams({
      to: currentPage.window.to,
      cursor,
    }).toString();

    void fetchActivity(query, controller.signal).then(
      (payload) => {
        if (!isCurrentLoadMoreRequest(loadMoreRequest.current, request, sequence.current)) {
          return;
        }
        try {
          const nextPage = parseActivityPage(
            payload,
            expectedSession,
            currentPage.window.to,
          );
          if (
            nextPage.nextCursor === cursor ||
            (nextPage.nextCursor !== null &&
              attemptedCursors.current.has(nextPage.nextCursor))
          ) {
            throw new Error("Activity cursor did not advance.");
          }
          const seen = new Map(
            currentPage.transfers.map((transfer) => [transfer.id, transfer]),
          );
          const uniqueTransfers: ActivityTransfer[] = [];
          for (const transfer of nextPage.transfers) {
            const existing = seen.get(transfer.id);
            if (existing) {
              if (!sameActivityTransfer(existing, transfer)) {
                throw new Error("Activity overlap changed an existing transfer.");
              }
              continue;
            }
            uniqueTransfers.push(transfer);
          }
          const previousLast = currentPage.transfers.at(-1);
          if (
            previousLast &&
            uniqueTransfers[0] &&
            compareActivityTransferKeys(previousLast, uniqueTransfers[0]) <= 0
          ) {
            throw new Error("Activity page order did not advance.");
          }
          setState((current) => {
            if (
              current.requestKey !== requestKey ||
              current.status !== "ready" ||
              current.page.window.to !== nextPage.window.to ||
              current.page.nextCursor !== cursor
            ) {
              return current;
            }
            return {
              requestKey,
              status: "ready",
              page: {
                ...current.page,
                transfers: [...current.page.transfers, ...uniqueTransfers],
                nextCursor: nextPage.nextCursor,
              },
              loadingMore: false,
              loadMoreError: false,
              autoLoadPaused:
                nextPage.nextCursor !== null && uniqueTransfers.length === 0,
            };
          });
        } catch {
          markLoadMoreFailed(requestKey, cursor, setState);
        } finally {
          clearLoadMoreRequest(request);
        }
      },
      () => {
        if (!isCurrentLoadMoreRequest(loadMoreRequest.current, request, sequence.current)) {
          return;
        }
        markLoadMoreFailed(requestKey, cursor, setState);
        clearLoadMoreRequest(request);
      },
    );
  }, [fetchActivity, provider, requestKey, state, subject, walletAddress]);

  const loadMore = useCallback(() => requestMore(false), [requestMore]);
  const retryLoadMore = useCallback(() => requestMore(true), [requestMore]);

  const visibleState: ActivityState =
    !requestKey
      ? unavailableState
      : state.requestKey === requestKey
        ? state
        : {
            status: "loading",
            page: null,
            loadingMore: false,
            loadMoreError: false,
            autoLoadPaused: false,
          };

  return {
    ...visibleState,
    retry,
    refresh,
    loadMore,
    retryLoadMore,
  };

  function clearLoadMoreRequest(request: LoadMoreRequest) {
    if (loadMoreRequest.current === request) {
      loadMoreRequest.current = null;
    }
  }
}

function isCurrentLoadMoreRequest(
  current: LoadMoreRequest | null,
  expected: LoadMoreRequest,
  sequence: number,
): boolean {
  return (
    current === expected &&
    !expected.controller.signal.aborted &&
    expected.sequence === sequence
  );
}

function sameActivityTransfer(
  left: ActivityTransfer,
  right: ActivityTransfer,
): boolean {
  return (
    left.id === right.id &&
    left.chainId === right.chainId &&
    left.assetId === right.assetId &&
    left.tokenAddress === right.tokenAddress &&
    left.walletAddress === right.walletAddress &&
    left.fromAddress === right.fromAddress &&
    left.toAddress === right.toAddress &&
    left.direction === right.direction &&
    left.amountBaseUnits === right.amountBaseUnits &&
    left.blockNumber === right.blockNumber &&
    left.blockHash === right.blockHash &&
    left.transactionHash === right.transactionHash &&
    left.logIndex === right.logIndex &&
    left.blockTimestamp === right.blockTimestamp
  );
}

function readActivityFailure(reason: unknown): {
  code: string | null;
  message: string | null;
} {
  if (!reason || typeof reason !== "object") {
    return { code: null, message: null };
  }
  const code =
    "code" in reason &&
    typeof reason.code === "string" &&
    /^[A-Z][A-Z0-9_]{1,64}$/.test(reason.code)
      ? reason.code
      : null;
  const message =
    "serverMessage" in reason &&
    typeof reason.serverMessage === "string" &&
    reason.serverMessage.length > 0 &&
    reason.serverMessage.length <= 200
      ? reason.serverMessage
      : null;
  return { code, message };
}

function markLoadMoreFailed(
  requestKey: string,
  cursor: string,
  setState: React.Dispatch<React.SetStateAction<OwnedActivityState>>,
) {
  setState((current) =>
    current.requestKey === requestKey &&
    current.status === "ready" &&
    current.page.nextCursor === cursor
      ? { ...current, loadingMore: false, loadMoreError: true }
      : current,
  );
}
