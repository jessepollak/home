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
import type { HomeAssetBalancesPresentation } from "./home-types";

export type HomeBalancesStatus = {
  message: string;
  recovery: "retry" | "choose-country" | "none";
};

export function homeBalancesStatus(
  assetBalances: HomeAssetBalancesPresentation | undefined,
): HomeBalancesStatus | null {
  if (!assetBalances || assetBalances.status === "loading") return null;
  if (assetBalances.status === "unavailable") {
    return { message: "Balances are unavailable", recovery: "retry" };
  }
  if (assetBalances.needsCountry && assetBalances.statusLabel) {
    return { message: assetBalances.statusLabel, recovery: "choose-country" };
  }
  return null;
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

export function headerStatus({
  interruption,
  coverage,
}: {
  interruption: { kind: "offline" | "interrupted" } | null;
  coverage: HomeBalancesStatus | null;
}): HomeBalancesStatus | null {
  if (interruption?.kind === "offline") {
    return { message: "You’re offline. Home will update when you reconnect.", recovery: "none" };
  }
  if (interruption?.kind === "interrupted") {
    return { message: "Home can’t refresh right now. Some information may be out of date.", recovery: "retry" };
  }
  return coverage;
}

export function HomeHeaderStatus({
  status,
  onRetry,
  onOpenAccount,
}: {
  status: HomeBalancesStatus;
  onRetry: () => void;
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
      <PopoverContent align="end" aria-label="Status" data-home-status-detail="">
        <div className="flex items-center gap-2">
          <PopoverDescription className="min-w-0 flex-1">{status.message}</PopoverDescription>
          {status.recovery === "retry" ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-11 md:pointer-fine:size-8"
              aria-label="Retry"
              onClick={onRetry}
            >
              <RotateCw aria-hidden="true" />
            </Button>
          ) : status.recovery === "choose-country" ? (
            <Button variant="secondary" size="lg" className="h-11 md:pointer-fine:h-8" onClick={onOpenAccount}>
              Open Account
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
