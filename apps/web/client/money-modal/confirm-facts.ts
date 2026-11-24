import type { ActionKind, MoneyActionNetworkFee, MoneyActionOwner, PreparedMoneyAction } from "@/shared/money-actions/types";

type ConfirmFactsBase = {
  owner: MoneyActionOwner;
  network: { name: "Base"; chainId: 8453 };
  fee: MoneyActionNetworkFee;
};

export type MoneyConfirmFacts =
  | (ConfirmFactsBase & { kind: "trade"; slippage: { maxBps: number } })
  | (ConfirmFactsBase & { kind: "savings-deposit"; slippage: { maxBps: number } })
  | (ConfirmFactsBase & { kind: Exclude<ActionKind, "trade" | "savings-deposit">; slippage?: never });

export function moneyConfirmFacts(action: PreparedMoneyAction): MoneyConfirmFacts | null {
  const base: ConfirmFactsBase = {
    owner: action.owner,
    network: { name: "Base", chainId: action.owner.chainId },
    fee: action.networkFee ?? { payment: "native" },
  };
  if (action.kind === "savings-deposit") {
    const metadata = action.metadata;
    if (metadata?.product !== "savings" || metadata.operation !== "deposit" ||
      metadata.exchangeConstraint !== "deposit-minimum-shares-or-revert" ||
      typeof metadata.previewSharesBaseUnits !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(metadata.previewSharesBaseUnits) ||
      typeof metadata.minimumSharesBaseUnits !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(metadata.minimumSharesBaseUnits)) return null;
    const preview = BigInt(metadata.previewSharesBaseUnits);
    const minimum = BigInt(metadata.minimumSharesBaseUnits);
    if (minimum <= BigInt(0) || minimum > preview) return null;
    const maxBps = Number(((preview - minimum) * BigInt(10_000) + preview - BigInt(1)) / preview);
    return { ...base, kind: "savings-deposit", slippage: { maxBps } };
  }
  if (action.kind !== "trade") return { ...base, kind: action.kind };
  if (action.metadata?.product !== "trade" || !Number.isFinite(action.metadata.slippageBps)) return null;
  return { ...base, kind: "trade", slippage: { maxBps: action.metadata.slippageBps } };
}
