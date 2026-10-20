"use client";

import { LoadErrorCard } from "@/components/load-error";

export function BalancesCantLoad({ onRetry }: { onRetry: () => void }) {
  return <LoadErrorCard texture="cant-load" title="Can’t load balances" onRetry={onRetry} />;
}
