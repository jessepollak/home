import type { ActionKind, MoneyActionNetworkFee, MoneyActionOwner, PreparedMoneyAction } from "@/shared/money-actions/types";

type ConfirmFactsBase = {
  owner: MoneyActionOwner;
  network: { name: "Base"; chainId: 8453 };
  fee: MoneyActionNetworkFee;
};

export type MoneyConfirmFacts =
  | (ConfirmFactsBase & { kind: "trade"; slippage: { maxBps: number } })
  | (ConfirmFactsBase & { kind: Exclude<ActionKind, "trade">; slippage?: never });

export function moneyConfirmFacts(action: PreparedMoneyAction): MoneyConfirmFacts | null {
  const base: ConfirmFactsBase = {
    owner: action.owner,
    network: { name: "Base", chainId: action.owner.chainId },
    fee: action.networkFee ?? { payment: "native" },
  };
  if (action.kind !== "trade") return { ...base, kind: action.kind };
  if (action.metadata?.product !== "trade" || !Number.isFinite(action.metadata.slippageBps)) return null;
  return { ...base, kind: "trade", slippage: { maxBps: action.metadata.slippageBps } };
}
