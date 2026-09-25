"use client";

import { useCallback, useEffect, useRef } from "react";
import { useOptionalAppChrome } from "@/components/app-chrome";

type BalancesRestoreProvenance =
  | "disarmed"
  | "awaiting-asset-detail"
  | "asset-detail"
  | "account-overlay";

export function useBalancesRestore() {
  const provenanceRef = useRef<BalancesRestoreProvenance>("disarmed");
  const disarmBalancesRestore = useCallback(() => {
    provenanceRef.current = "disarmed";
  }, []);
  const awaitBalancesAssetDetail = useCallback(() => {
    provenanceRef.current = "awaiting-asset-detail";
  }, []);
  const armBalancesAccountOverlay = useCallback(() => {
    provenanceRef.current = "account-overlay";
  }, []);
  const isBalancesRestoreArmed = useCallback(
    () => provenanceRef.current === "asset-detail" || provenanceRef.current === "account-overlay",
    [],
  );

  const chrome = useOptionalAppChrome();
  const backLabel = chrome?.nested?.backLabel ?? null;
  useEffect(() => {
    if (!backLabel) return;
    if (backLabel === "Back" && provenanceRef.current === "awaiting-asset-detail") {
      provenanceRef.current = "asset-detail";
      return;
    }
    if (backLabel !== "Back") provenanceRef.current = "disarmed";
  }, [backLabel]);

  return {
    disarmBalancesRestore,
    awaitBalancesAssetDetail,
    armBalancesAccountOverlay,
    isBalancesRestoreArmed,
  };
}
