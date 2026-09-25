import type { AccountProvider } from "@/shared/account/session-types";
import type { TradeMoneyActionMetadata, TradeSigningRequest } from "@/shared/trading/contract";

export const ACTION_KINDS = [
  "send",
  "cash-out",
  "cash-out-withdraw",
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

export type BorrowMoneyActionMetadata = {
  product: "borrow";
  operation:
    | "supply-collateral"
    | "borrow"
    | "supply-and-borrow"
    | "repay"
    | "repay-all"
    | "withdraw-collateral"
    | "close-position";
  marketId: `0x${string}`;
  loanAsset: { id: string; symbol: string };
  collateralAsset: { id: string; symbol: string };
  projectedHealthFactorWad: string | null;
  projectedLiquidationPriceRaw: string | null;
  borrowAprWad: string;
  source: { blockNumber: string; blockHash: `0x${string}`; blockTimestamp: string };
};
type CashoutMoneyActionMetadataBase = {
  product: "cashout";
  providerId: string;
  providerName: string;
  environment: "production" | "sandbox";
  region?: string;
  platform: string;
  platformLabel: string;
  currency: string;
  approximateFiatAmount: string;
  etaSeconds?: number | null;
  minConversionRate: string;
  intentAmountRange: { min: string; max: string };
  estimateAsOf: string;
  escrow: `0x${string}`;
};
export type CashoutMoneyActionMetadata = CashoutMoneyActionMetadataBase & (
  | { operation: "deposit"; canonicalHandle: string; payeeHash?: `0x${string}`; depositId?: never }
  | { operation: "withdraw"; canonicalHandle?: never; payeeHash?: never; depositId: string }
);

export type SavingsMoneyActionMetadata = {
  product: "savings";
  operation: "deposit" | "withdraw";
  vaultAddress: `0x${string}`;
  vaultName: string;
  network: { name: "Base"; chainId: 8453 };
  feeWad: string;
  limitBaseUnits: string;
  previewSharesBaseUnits: string;
  shareDecimals: number;
  minimumSharesBaseUnits?: string;
  exchangeConstraint:
    | "deposit-minimum-shares-or-revert"
    | "deposit-preview-no-minimum-shares"
    | "withdraw-exact-assets-or-revert";
  discoveryRate:
    | {
        status: "current" | "stale";
        netApy: string;
        fetchedAt: string;
        stateAsOf: string;
      }
    | {
        status: "unavailable";
        netApy: null;
        fetchedAt: null;
        stateAsOf: null;
      };
  source: {
    blockNumber: string;
    blockHash: `0x${string}`;
    blockTimestamp: string;
  };
};

export type MoneyActionMetadata =
  | BorrowMoneyActionMetadata
  | CashoutMoneyActionMetadata
  | SavingsMoneyActionMetadata
  | TradeMoneyActionMetadata;

export type MoneyActionNetworkFee =
  | {
      payment: "usdc";
      token: `0x${string}`;
      paymaster: `0x${string}`;
      maxFeeBaseUnits: string;
      decimals: 6;
    }
  | { payment: "native" };

export type MoneyActionDraft = {
  kind: ActionKind;
  title: string;
  calls: MoneyActionCall[];
  amounts: MoneyActionAmount[];
  warnings: string[];
  expiresAt: string;
  quoteId?: string;
  metadata?: MoneyActionMetadata;
  networkFee?: MoneyActionNetworkFee;
  signing?: TradeSigningRequest;
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
