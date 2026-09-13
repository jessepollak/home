"use client";

import { useCallback, useEffect, useRef } from "react";
import { AppChromeProvider, useOptionalAppChrome } from "@/components/app-chrome";
import { HomeShell } from "./shell";
import type { HomeExperienceProps } from "./home-types";

type BalancesRestoreProvenance =
  | "disarmed"
  | "awaiting-asset-detail"
  | "asset-detail"
  | "account-overlay";

function BalancesRestoreChromeObserver({
  onChrome,
}: {
  onChrome: (backLabel: string) => void;
}) {
  const chrome = useOptionalAppChrome();
  const backLabel = chrome?.nested?.backLabel ?? null;
  useEffect(() => {
    if (backLabel) onChrome(backLabel);
  }, [backLabel, onChrome]);
  return null;
}

export function HomeExperience(props: HomeExperienceProps) {
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
  const observeBalancesChrome = useCallback((backLabel: string) => {
    if (backLabel === "Back" && provenanceRef.current === "awaiting-asset-detail") {
      provenanceRef.current = "asset-detail";
      return;
    }
    if (backLabel !== "Back") provenanceRef.current = "disarmed";
  }, []);

  return (
    <AppChromeProvider>
      <BalancesRestoreChromeObserver onChrome={observeBalancesChrome} />
      <HomeShell
        {...props}
        disarmBalancesRestore={disarmBalancesRestore}
        awaitBalancesAssetDetail={awaitBalancesAssetDetail}
        armBalancesAccountOverlay={armBalancesAccountOverlay}
        isBalancesRestoreArmed={isBalancesRestoreArmed}
      />
    </AppChromeProvider>
  );
}
