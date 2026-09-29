import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { BalancesSnapshot } from "@/shared/balances/types";

export type PendingCashoutStoryState = "none" | "waiting" | "partial" | "paid" | "returned";

const time = "2026-09-15T12:00:00.000Z";
const settledAt = "2026-09-15T12:40:00.000Z";

type Progress = NonNullable<RecentMoneyActionOperation["cashout"]>;

const progressByState: Record<Exclude<PendingCashoutStoryState, "none">, Partial<Progress>> = {
  waiting: {},
  partial: { filledAtomic: "30000000", remainingAtomic: "20000000" },
  paid: { state: "delivered", filledAtomic: "50000000", remainingAtomic: "0", withdrawable: false, settledAt },
  returned: { state: "returned", returnedAtomic: "50000000", remainingAtomic: "0", withdrawable: false, settledAt },
};

export function pendingCashoutOperations(
  state: PendingCashoutStoryState,
  snapshot: BalancesSnapshot,
): RecentMoneyActionOperation[] {
  if (state === "none") return [];
  const gb = snapshot.region === "GB";
  const platform = gb ? "monzo" : "cashapp";
  const platformLabel = gb ? "Monzo" : "Cash App";
  const cashout: Progress = {
    version: 1, providerId: "peer", region: snapshot.region, depositId: `story-escrow-${state}`,
    depositBlockNumber: snapshot.block.number, progressConfirmed: true, state: "awaiting-buyer", platform, platformLabel,
    amountAtomic: "50000000", filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "50000000",
    withdrawable: true, withdrawing: false, etaSeconds: 3600, settledAt: null, updatedAt: time,
    ...progressByState[state],
  };
  return [{
    action: {
      id: `story-cash-out-${state}`, kind: "cash-out", title: "Cash out with Peer",
      amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "50000000", direction: "spend" }],
      warnings: [], expiresAt: time, createdAt: time,
      metadata: {
        product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "sandbox",
        platform, platformLabel, currency: gb ? "GBP" : "USD", canonicalHandle: "story-payee",
        approximateFiatAmount: gb ? "40.00" : "50.00", etaSeconds: 3600, minConversionRate: "1",
        intentAmountRange: { min: "50000000", max: "50000000" }, estimateAsOf: time,
        escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
      },
    },
    status: "confirmed", cashout, createdAt: time, updatedAt: cashout.settledAt ?? time,
  }];
}

export function withCashUnitPrice(snapshot: BalancesSnapshot): BalancesSnapshot {
  const currency = snapshot.quoteCurrency;
  if (!currency) return snapshot;
  const amount = currency === "GBP" ? { atoms: "8", scale: 1 } : { atoms: "1", scale: 0 };
  return {
    ...snapshot,
    holdings: snapshot.holdings.map((holding) => holding.id === "usdc" ? { ...holding, unitValue: { currency, amount } } : holding),
  };
}
