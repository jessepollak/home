"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { buildAccountExportFile, downloadAccountExport } from "@/client/account/account-export-file";
import { parseAccountExportErrorResponse, parseAccountExportResponse } from "@/shared/account/contracts/data-export";

type ExportState = "idle" | "generating" | "success" | "error";

export function useAccountExport({ ownerKey, cacheOwnerKey, fetchAccountResource }: {
  ownerKey: string | null;
  cacheOwnerKey: string | null;
  fetchAccountResource: AccountWalletClient["fetchAccountResource"];
}) {
  const [result, setResult] = useState<{ ownerKey: string | null; cacheOwnerKey: string | null; state: ExportState }>({ ownerKey, cacheOwnerKey, state: "idle" });
  const current = useRef<{ ownerKey: string | null; cacheOwnerKey: string | null; generation: number; mounted: boolean; controller: AbortController | null }>({ ownerKey, cacheOwnerKey, generation: 0, mounted: false, controller: null });

  if (result.ownerKey !== ownerKey || result.cacheOwnerKey !== cacheOwnerKey) setResult({ ownerKey, cacheOwnerKey, state: "idle" });

  useLayoutEffect(() => {
    const boundary = current.current;
    boundary.ownerKey = ownerKey;
    boundary.cacheOwnerKey = cacheOwnerKey;
    boundary.mounted = true;
    return () => {
      boundary.mounted = false;
      boundary.generation += 1;
      boundary.controller?.abort();
      boundary.controller = null;
    };
  }, [ownerKey, cacheOwnerKey]);

  const start = useCallback(async () => {
    if (!ownerKey || !current.current.mounted || current.current.ownerKey !== ownerKey || current.current.cacheOwnerKey !== cacheOwnerKey) return;
    const boundary = current.current;
    boundary.controller?.abort();
    const controller = new AbortController();
    boundary.controller = controller;
    const generation = ++boundary.generation;
    const isCurrent = () => boundary.mounted && boundary.ownerKey === ownerKey && boundary.cacheOwnerKey === cacheOwnerKey &&
      boundary.generation === generation && !controller.signal.aborted;
    setResult({ ownerKey, cacheOwnerKey, state: "generating" });
    try {
      const body = await fetchAccountResource("/api/account/export", { method: "GET", signal: controller.signal });
      if (!isCurrent()) return;
      if (parseAccountExportErrorResponse(body)) throw new Error("Account export unavailable");
      const response = parseAccountExportResponse(body);
      if (!response) throw new Error("Invalid account export");
      const file = await buildAccountExportFile(response, cacheOwnerKey, controller.signal);
      if (!isCurrent()) return;
      downloadAccountExport(file);
      setResult({ ownerKey, cacheOwnerKey, state: "success" });
    } catch {
      if (isCurrent()) {
        setResult({ ownerKey, cacheOwnerKey, state: "error" });
        return { status: "error" as const };
      }
      return { status: "discarded" as const };
    } finally {
      if (boundary.controller === controller) boundary.controller = null;
    }
  }, [cacheOwnerKey, fetchAccountResource, ownerKey]);

  return { state: result.ownerKey === ownerKey && result.cacheOwnerKey === cacheOwnerKey ? result.state : "idle" as const, start };
}
