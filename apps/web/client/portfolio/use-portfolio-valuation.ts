"use client";

import { useEffect, useRef, useState } from "react";
import type { RegionId } from "@/config/regions";
import { isVerifiedPortfolioSession } from "@/client/portfolio/parse";
import { parsePortfolioValuationSnapshot } from "@/shared/portfolio/parse-valuation";
import type {
  FetchPortfolioValuation,
  PortfolioValuationSnapshot,
  PortfolioValuationState,
  VerifiedPortfolioValuationSession,
} from "@/shared/portfolio/valuation-state";

type OwnedState =
  | { requestKey: null; status: "unavailable"; snapshot: null; error: null }
  | { requestKey: string; status: "loading"; snapshot: null; error: null }
  | {
      requestKey: string;
      status: "ready";
      snapshot: PortfolioValuationSnapshot;
      error: null;
    }
  | {
      requestKey: string;
      status: "error";
      snapshot: null;
      error: "portfolio-valuation-unavailable";
    };

const unavailableState: OwnedState = {
  requestKey: null,
  status: "unavailable",
  snapshot: null,
  error: null,
};

export function usePortfolioValuation(
  session: VerifiedPortfolioValuationSession | null,
  region: RegionId,
  fetchValuation: FetchPortfolioValuation,
  refreshTrigger?: string | number,
): PortfolioValuationState {
  const sequence = useRef(0);
  const [state, setState] = useState<OwnedState>(unavailableState);
  const validSession = isVerifiedPortfolioSession(session) ? session : null;
  const subject = validSession?.subject ?? null;
  const smartAccountAddress = validSession?.smartAccountAddress ?? null;
  const chainId = validSession?.chainId ?? null;
  const requestKey = validSession
    ? `${subject}\u0000${smartAccountAddress?.toLowerCase()}\u0000${chainId}\u0000${region}`
    : null;

  useEffect(() => {
    const requestSequence = ++sequence.current;
    if (!subject || !smartAccountAddress || chainId !== 8453 || !requestKey) return;
    const controller = new AbortController();
    const expectedSession: VerifiedPortfolioValuationSession = {
      subject,
      smartAccountAddress,
      chainId,
    };

    void fetchValuation(region, controller.signal).then(
      (payload) => {
        if (controller.signal.aborted || sequence.current !== requestSequence) return;
        try {
          const snapshot = parsePortfolioValuationSnapshot(
            payload,
            expectedSession,
            region,
          );
          setState({
            requestKey,
            status: "ready",
            snapshot,
            error: null,
          });
        } catch {
          setState({
            requestKey,
            status: "error",
            snapshot: null,
            error: "portfolio-valuation-unavailable",
          });
        }
      },
      () => {
        if (controller.signal.aborted || sequence.current !== requestSequence) return;
        setState({
          requestKey,
          status: "error",
          snapshot: null,
          error: "portfolio-valuation-unavailable",
        });
      },
    );
    return () => controller.abort();
  }, [
    chainId,
    fetchValuation,
    refreshTrigger,
    region,
    requestKey,
    smartAccountAddress,
    subject,
  ]);

  if (state.requestKey !== requestKey) {
    setState(
      requestKey
        ? { requestKey, status: "loading", snapshot: null, error: null }
        : unavailableState,
    );
    return requestKey
      ? { status: "loading", snapshot: null, error: null }
      : unavailableState;
  }
  return state;
}
