"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AccountWalletClient } from "./cdp-client";
import { parseAccountDeletionErrorResponse, parseAccountDeletionReceipt, type AccountDeletionReceipt } from "@/shared/account/contracts/account-deletion";

type Result = { ownerKey: string | null; receipt: AccountDeletionReceipt | null; loading: boolean; error: boolean };

export function useAccountDeletion({ ownerKey, fetchAccountResource, onCompleted }: {
  ownerKey: string | null;
  fetchAccountResource: AccountWalletClient["fetchAccountResource"];
  onCompleted: (receipt: AccountDeletionReceipt) => void;
}) {
  const [result, setResult] = useState<Result>({ ownerKey, receipt: null, loading: Boolean(ownerKey), error: false });
  const current = useRef<{ ownerKey: string | null; generation: number; mounted: boolean; controller: AbortController | null }>({ ownerKey, generation: 0, mounted: false, controller: null });
  const completed = useRef(onCompleted);
  useLayoutEffect(() => { completed.current = onCompleted; }, [onCompleted]);
  if (result.ownerKey !== ownerKey) setResult({ ownerKey, receipt: null, loading: Boolean(ownerKey), error: false });

  useLayoutEffect(() => {
    const boundary = current.current;
    boundary.ownerKey = ownerKey;
    boundary.mounted = true;
    return () => {
      boundary.mounted = false;
      boundary.generation += 1;
      boundary.controller?.abort();
      boundary.controller = null;
    };
  }, [ownerKey]);

  const request = useCallback(async (method: "GET" | "POST" = "GET") => {
    const boundary = current.current;
    if (!ownerKey || !boundary.mounted || boundary.ownerKey !== ownerKey || boundary.controller) return;
    const controller = new AbortController();
    boundary.controller = controller;
    const generation = ++boundary.generation;
    const isCurrent = () => boundary.mounted && boundary.ownerKey === ownerKey && boundary.generation === generation && !controller.signal.aborted;
    setResult((previous) => ({ ...previous, loading: true, error: false }));
    try {
      let body: unknown;
      try {
        body = await fetchAccountResource("/api/account/deletion", { method, signal: controller.signal });
      } catch (error) {
        const failure = error && typeof error === "object" && "code" in error
          ? parseAccountDeletionErrorResponse({ error: { code: error.code, message: "Account deletion request failed" } })
          : null;
        if (!failure) throw error;
        body = failure;
      }
      if (!isCurrent()) return;
      const failure = parseAccountDeletionErrorResponse(body);
      if (method === "GET" && failure?.error.code === "ACCOUNT_DELETION_NOT_FOUND") {
        setResult({ ownerKey, receipt: null, loading: false, error: false });
        return;
      }
      if (failure) throw new Error(failure.error.message);
      const receipt = parseAccountDeletionReceipt(body);
      if (!receipt) throw new Error("Account deletion unavailable");
      setResult({ ownerKey, receipt, loading: false, error: false });
      if (receipt.status === "completed") completed.current(receipt);
    } catch {
      if (isCurrent()) setResult((previous) => ({ ...previous, loading: false, error: true }));
      return { status: "error" as const };
    } finally {
      if (boundary.controller === controller) boundary.controller = null;
    }
  }, [fetchAccountResource, ownerKey]);

  useEffect(() => { void Promise.resolve().then(() => request()); }, [request]);
  const receipt = result.ownerKey === ownerKey ? result.receipt : null;
  useEffect(() => {
    if (receipt?.status !== "queued") return;
    const poll = () => { if (document.visibilityState === "visible") void request(); };
    const interval = setInterval(poll, 15_000);
    document.addEventListener("visibilitychange", poll);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", poll); };
  }, [receipt?.status, request]);

  return { receipt, loading: result.ownerKey === ownerKey ? result.loading : Boolean(ownerKey), error: result.ownerKey === ownerKey && result.error, refresh: request, start: () => request("POST") };
}
