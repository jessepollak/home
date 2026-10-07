"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { buildAccountExportFile, downloadAccountExport } from "@/client/account/account-export-file";
import { parseAccountExportErrorResponse, parseAccountExportResponse } from "@/shared/account/contracts/data-export";

type ExportState = "idle" | "generating" | "success" | "error";

export function useAccountExport({ ownerKey, fetchAccountResource }: {
  ownerKey: string | null;
  fetchAccountResource: AccountWalletClient["fetchAccountResource"];
}) {
  const [result, setResult] = useState<{ ownerKey: string | null; state: ExportState }>({ ownerKey, state: "idle" });
  const current = useRef<{ ownerKey: string | null; generation: number; mounted: boolean; controller: AbortController | null }>({ ownerKey, generation: 0, mounted: false, controller: null });

  if (result.ownerKey !== ownerKey) setResult({ ownerKey, state: "idle" });

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

  const start = useCallback(async () => {
    if (!ownerKey || !current.current.mounted || current.current.ownerKey !== ownerKey) return;
    const boundary = current.current;
    boundary.controller?.abort();
    const controller = new AbortController();
    boundary.controller = controller;
    const generation = ++boundary.generation;
    const isCurrent = () => boundary.mounted && boundary.ownerKey === ownerKey &&
      boundary.generation === generation && !controller.signal.aborted;
    setResult({ ownerKey, state: "generating" });
    try {
      const body = await fetchAccountResource("/api/account/export", { method: "GET", signal: controller.signal });
      if (!isCurrent()) return;
      if (parseAccountExportErrorResponse(body)) throw new Error("Account export unavailable");
      const response = parseAccountExportResponse(body);
      if (!response) throw new Error("Invalid account export");
      const file = await buildAccountExportFile(response, ownerKey, controller.signal);
      if (!isCurrent()) return;
      downloadAccountExport(file);
      setResult({ ownerKey, state: "success" });
    } catch {
      if (isCurrent()) {
        setResult({ ownerKey, state: "error" });
        return { status: "error" as const };
      }
      return { status: "discarded" as const };
    } finally {
      if (boundary.controller === controller) boundary.controller = null;
    }
  }, [fetchAccountResource, ownerKey]);

  return { state: result.ownerKey === ownerKey ? result.state : "idle" as const, start };
}
