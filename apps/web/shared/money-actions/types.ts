import type { AccountProvider } from "@/shared/account/session-types";

export const ACTION_KINDS = [
  "send",
  "savings-deposit",
  "savings-withdraw",
  "borrow",
  "repay",
  "trade",
  "supply-collateral",
  "withdraw-collateral",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export function isActionKind(value: unknown): value is ActionKind {
  return typeof value === "string" && (ACTION_KINDS as readonly string[]).includes(value);
}

export type MoneyActionCall = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  approval?: {
    assetId: string;
    spender: `0x${string}`;
  };
};

export type MoneyActionAmount = {
  assetId: string;
  symbol: string;
  decimals: number;
  amountBaseUnits: string;
  direction: "spend" | "receive";
  estimated?: boolean;
  maximum?: boolean;
};

export type MoneyActionDraft = {
  kind: ActionKind;
  title: string;
  calls: MoneyActionCall[];
  amounts: MoneyActionAmount[];
  warnings: string[];
  expiresAt: string;
  quoteId?: string;
};

export type MoneyActionOwner = {
  subject: string;
  address: `0x${string}`;
  chainId: 8453;
  accountProvider: AccountProvider;
};

export type PreparedMoneyAction = MoneyActionDraft & {
  id: string;
  owner: MoneyActionOwner;
  createdAt: string;
};

export type DerivedActionStatus = "pending" | "unknown" | "confirmed" | "failed";

export type OperationResult = {
  id: string;
  status: DerivedActionStatus | "rejected" | "submitted";
  transactionHash?: `0x${string}`;
  userOperationHash?: `0x${string}`;
};
