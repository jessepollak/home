import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import type { InvestAssetId } from "@/config/invest-assets";
import type {
  CoinbaseSmartWalletTypedData,
  Permit2TypedData,
} from "@/shared/trading/server-types";
import type { TradeSide } from "./assets";

export const DEFAULT_TRADE_SLIPPAGE_BPS = 100 as const;

export type PrepareTradeRequest = {
  assetId: InvestAssetId;
  side: TradeSide;
  amountBaseUnits: string;
  slippageBps: number;
};

export type TradeIntentReview = {
  status: "signature-required";
  id: string;
  intentHash: string;
  title: string;
  signerAddress: `0x${string}`;
  signingRequestId: string;
  signingTypedData: CoinbaseSmartWalletTypedData;
  permit: Permit2TypedData;
  spend: {
    assetId: string;
    symbol: string;
    decimals: number;
    amountBaseUnits: string;
  };
  receive: {
    assetId: string;
    symbol: string;
    decimals: number;
    minimumAmountBaseUnits: string;
  };
  warnings: string[];
  permitExpiresAt: string;
  expiresAt: string;
};

export type TradeUnavailableReason =
  | "insufficient-balance"
  | "no-liquidity"
  | "stale-quote"
  | "quote-rejected"
  | "signer-unsupported"
  | "permit-expired"
  | "permit-used";

export type PrepareTradeResponse =
  | TradeIntentReview
  | {
      status: "unavailable";
      reason: TradeUnavailableReason;
      message: string;
    };

export type FinalizeTradeResponse = PreparedMoneyAction;

export type TradeApiErrorCode =
  | "INVALID_TRADE_REQUEST"
  | "INVALID_TRADE_FINALIZATION"
  | "SMART_ACCOUNT_UNAVAILABLE"
  | "STOCK_EXECUTION_UNAVAILABLE"
  | "INSUFFICIENT_BALANCE"
  | "NO_LIQUIDITY"
  | "STALE_QUOTE"
  | "QUOTE_REJECTED"
  | "SIGNER_UNSUPPORTED"
  | "PERMIT_EXPIRED"
  | "PERMIT_USED"
  | "HOSTED_SWAP_UNAVAILABLE"
  | "TRADE_UNAVAILABLE";

export class TradeClientError extends Error {
  readonly code: TradeApiErrorCode | "UNAUTHENTICATED";

  constructor(code: TradeApiErrorCode | "UNAUTHENTICATED") {
    super(code);
    this.name = "TradeClientError";
    this.code = code;
  }
}
