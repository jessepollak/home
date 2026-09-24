"use client";

import { useCallback } from "react";
import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";
import { browserHomeQueryClient, useHomeQueryClient } from "@/client/query/query-client";
import type { HomeMoneySummary } from "@/shared/balances/present";
import type { HomeAssetBalancesPresentation } from "./home-types";

export type HomeBalancesStatus = {
  message: string;
  recovery: "reload" | "choose-country";
};

export function homeBalancesStatus(
  assetBalances: HomeAssetBalancesPresentation | undefined,
): HomeBalancesStatus | null {
  if (!assetBalances || assetBalances.status === "loading") return null;
  if (assetBalances.needsCountry && assetBalances.statusLabel) {
    return { message: assetBalances.statusLabel, recovery: "choose-country" };
  }
  if (assetBalances.status === "unavailable") {
    return { message: "Balances are unavailable", recovery: "reload" };
  }
  if (assetBalances.totalStatus !== "complete" || summaryIncomplete(assetBalances.summary)) {
    return { message: "Some balances are unavailable", recovery: "reload" };
  }
  return null;
}

function summaryIncomplete(summary: HomeMoneySummary | null): boolean {
  if (!summary) return true;
  return summary.cash.status !== "complete" ||
    summary.investments.status !== "complete" ||
    summary.borrow.kind === "unavailable" ||
    (summary.borrow.kind === "position" && summary.borrow.status !== "complete");
}

export function useReloadHomeBalances(): () => void {
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  return useCallback(() => {
    void queryClient.refetchQueries({
      predicate: (query) => query.queryKey[1] === "balances",
      type: "active",
    });
  }, [queryClient]);
}

export function HomeHeaderStatus({
  status,
  onReload,
  onOpenAccount,
}: {
  status: HomeBalancesStatus;
  onReload: () => void;
  onOpenAccount: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:pointer-fine:size-8"
            aria-label={status.message}
            data-home-status=""
          />
        }
      >
        <CircleAlert aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Balance status" data-home-status-detail="">
        <div className="flex items-center gap-2">
          <PopoverDescription className="min-w-0 flex-1">{status.message}</PopoverDescription>
          {status.recovery === "reload" ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-11 md:pointer-fine:size-8"
              aria-label="Reload"
              onClick={onReload}
            >
              <RotateCw aria-hidden="true" />
            </Button>
          ) : (
            <Button variant="secondary" size="lg" className="h-11 md:pointer-fine:h-8" onClick={onOpenAccount}>
              Open Account
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
