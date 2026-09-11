"use client";

import { useEffect, useRef, useState } from "react";
import { isVerifiedPortfolioSession, parsePortfolioSnapshot } from "./parse";
import type {
  FetchPortfolio,
  PortfolioSnapshot,
  PortfolioState,
  VerifiedPortfolioSession,
} from "./types";

type OwnedPortfolioState =
  | { ownerKey: null; status: "unavailable"; snapshot: null; error: null }
  | { ownerKey: string; status: "loading"; snapshot: null; error: null }
  | {
      ownerKey: string;
      status: "ready";
      snapshot: PortfolioSnapshot;
      error: null;
    }
  | {
      ownerKey: string;
      status: "error";
      snapshot: null;
      error: "portfolio-unavailable";
    };

const unavailableState: OwnedPortfolioState = {
  ownerKey: null,
  status: "unavailable",
  snapshot: null,
  error: null,
};

export function usePortfolio(
  session: VerifiedPortfolioSession | null,
  fetchPortfolio: FetchPortfolio,
  refreshTrigger?: string | number,
): PortfolioState {
  const sequence = useRef(0);
  const [state, setState] = useState<OwnedPortfolioState>(unavailableState);

  const validSession = isVerifiedPortfolioSession(session) ? session : null;
  const subject = validSession?.subject ?? null;
  const smartAccountAddress = validSession?.smartAccountAddress ?? null;
  const chainId = validSession?.chainId ?? null;
  const ownerKey = validSession
    ? `${subject}\u0000${smartAccountAddress?.toLowerCase()}\u0000${chainId}`
    : null;

  useEffect(() => {
    const requestSequence = ++sequence.current;
    if (!subject || !smartAccountAddress || chainId !== 8453 || !ownerKey) {
      return;
    }

    const controller = new AbortController();
    const expectedSession: VerifiedPortfolioSession = {
      subject,
      smartAccountAddress,
      chainId,
    };

    void fetchPortfolio(controller.signal).then(
      (payload) => {
        if (controller.signal.aborted || sequence.current !== requestSequence) {
          return;
        }
        try {
          const snapshot = parsePortfolioSnapshot(payload, expectedSession);
          setState({
            ownerKey,
            status: "ready",
            snapshot,
            error: null,
          });
        } catch {
          setState({
            ownerKey,
            status: "error",
            snapshot: null,
            error: "portfolio-unavailable",
          });
        }
      },
      () => {
        if (controller.signal.aborted || sequence.current !== requestSequence) {
          return;
        }
        setState({
          ownerKey,
          status: "error",
          snapshot: null,
          error: "portfolio-unavailable",
        });
      },
    );

    return () => controller.abort();
  }, [
    chainId,
    fetchPortfolio,
    ownerKey,
    refreshTrigger,
    smartAccountAddress,
    subject,
  ]);

  if (state.ownerKey !== ownerKey) {
    setState(
      ownerKey
        ? { ownerKey, status: "loading", snapshot: null, error: null }
        : unavailableState,
    );
    return ownerKey
      ? { status: "loading", snapshot: null, error: null }
      : unavailableState;
  }

  return state;
}
