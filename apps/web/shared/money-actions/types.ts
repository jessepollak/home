import type { AccountProvider } from "@/shared/account/session-types";

export type MoneyActionKind =
  | "send"
  | "save-deposit"
  | "save-withdraw"
  | "swap"
  | "supply-collateral"
  | "borrow"
  | "repay"
  | "withdraw-collateral";

export type MoneyActionCall = {
  to: `0x${string}`;
  data: `0x${string}`;
  dataHash?: string;
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
  kind: MoneyActionKind;
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
  sensitivePayload?: true;
  reviewHash: string;
  owner: MoneyActionOwner;
  createdAt: string;
};

export type MoneyActionOperationStatus =
  | "prepared"
  | "submitting"
  | "submitted"
  | "included"
  | "confirmed"
  | "rejected"
  | "expired"
  | "failed"
  | "unknown";

export type OperationResult = {
  id: string;
  status: MoneyActionOperationStatus;
  transactionHash?: `0x${string}`;
  userOperationHash?: `0x${string}`;
};

export type StoredMoneyActionOperation = {
  action: PreparedMoneyAction;
  status: MoneyActionOperationStatus;
  attemptCount: number;
  claimedAt?: string;
  abandonedAt?: string;
  submissionId?: string;
  transactionHash?: `0x${string}`;
  userOperationHash?: `0x${string}`;
  createdAt: string;
  updatedAt: string;
};
