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
  FetchActivity,
} from "./types";
import type { VerifiedAccountSession } from "@/features/account/session-types";

type OwnedActivityState =
  | {
      requestKey: null;
      status: "unavailable";
      page: null;
      loadingMore: false;
      loadMoreError: false;
    }
  | {
      requestKey: string;
      status: "error";
      page: null;
      loadingMore: false;
      loadMoreError: false;
      error: { code: string | null; message: string | null };
    }
  | {
      requestKey: string;
      status: "ready";
      page: ActivityPage;
      loadingMore: boolean;
      loadMoreError: boolean;
    };

const unavailableState: OwnedActivityState = {
  requestKey: null,
  status: "unavailable",
  page: null,
  loadingMore: false,
  loadMoreError: false,
};

export type UseActivityResult = ActivityState & {
  retry: () => void;
  refresh: () => void;
  loadMore: () => void;
};

export function useActivity(
  session: VerifiedAccountSession | null,
  fetchActivity: FetchActivity,
  refreshTrigger?: string | number,
): UseActivityResult {
  const sequence = useRef(0);
  const loadMoreController = useRef<AbortController | null>(null);
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
    loadMoreController.current?.abort();
    loadMoreController.current = null;
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
          });
        } catch {
          setState({
            requestKey,
            status: "error",
            page: null,
            loadingMore: false,
            loadMoreError: false,
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
          error: readActivityFailure(reason),
        });
      },
    );

    return () => controller.abort();
  }, [fetchActivity, provider, requestKey, subject, walletAddress]);

  const retry = useCallback(() => setRetryRevision((value) => value + 1), []);
  const refresh = useCallback(
    () => setRefreshRevision((value) => value + 1),
    [],
  );

  const loadMore = useCallback(() => {
    if (
      !subject ||
      !walletAddress ||
      !provider ||
      !requestKey ||
      state.requestKey !== requestKey ||
      state.status !== "ready" ||
      state.loadingMore ||
      !state.page.nextCursor
    ) {
      return;
    }

    const currentPage = state.page;
    const cursor = currentPage.nextCursor!;
    const expectedSession: VerifiedAccountSession = {
      user: { subject },
      smartAccount: { address: walletAddress, chainId: 8453 },
      accountProvider: provider,
    };
    setState({ ...state, loadingMore: true, loadMoreError: false });
    loadMoreController.current?.abort();
    const controller = new AbortController();
    loadMoreController.current = controller;
    const requestSequence = sequence.current;
    const query = new URLSearchParams({
      to: currentPage.window.to,
      cursor,
    }).toString();

    void fetchActivity(query, controller.signal).then(
      (payload) => {
        if (controller.signal.aborted || sequence.current !== requestSequence) {
          return;
        }
        try {
          const nextPage = parseActivityPage(
            payload,
            expectedSession,
            currentPage.window.to,
          );
          if (nextPage.nextCursor === cursor) {
            throw new Error("Activity cursor did not advance.");
          }
          const seen = new Set(
            currentPage.transfers.map((transfer) => transfer.id),
          );
          const uniqueTransfers = nextPage.transfers.filter(
            (transfer) => !seen.has(transfer.id),
          );
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
              current.page.window.to !== nextPage.window.to
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
            };
          });
        } catch {
          markLoadMoreFailed(requestKey, setState);
        }
      },
      () => {
        if (controller.signal.aborted || sequence.current !== requestSequence) {
          return;
        }
        markLoadMoreFailed(requestKey, setState);
      },
    );
  }, [fetchActivity, provider, requestKey, state, subject, walletAddress]);

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
          };

  return { ...visibleState, retry, refresh, loadMore };
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
  setState: React.Dispatch<React.SetStateAction<OwnedActivityState>>,
) {
  setState((current) =>
    current.requestKey === requestKey && current.status === "ready"
      ? { ...current, loadingMore: false, loadMoreError: true }
      : current,
  );
}
