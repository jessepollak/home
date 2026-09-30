import { parseAddress, type Address, type Hash32 } from "@/shared/chain/hex";
import type { OperatorFeeRecord } from "@/shared/fees/contract";
import type { CoinbaseSmartWalletTypedData, Permit2TypedData } from "./server-types";

export const TRADE_ACTION_CONTRACT_VERSION = 3 as const;
export const TRADE_AVAILABILITY_CONTRACT_VERSION = 2 as const;
export const TRADE_SLIPPAGE_BPS = 100 as const;
export const TRADE_SELL_ALL = "all" as const;

export type TradeDirection = "buy" | "sell";

export type TradeActionParams = {
  version: typeof TRADE_ACTION_CONTRACT_VERSION;
  assetId: string;
  direction: TradeDirection;
  amountBaseUnits: string | typeof TRADE_SELL_ALL;
};

export type TradeAssetRef = {
  id: string;
  symbol: string;
  decimals: number;
  address: Address;
};

export type TradeFeeFact = {
  kind: "protocol" | "gas";
  assetId: string;
  symbol: string;
  decimals: number;
  amountBaseUnits: string;
};

export type TradeMoneyActionMetadata = {
  product: "trade";
  provider: "cdp-swaps";
  direction: TradeDirection;
  network: { name: "Base"; chainId: 8453 };
  assetId: string;
  assetName: string;
  fromAsset: TradeAssetRef;
  toAsset: TradeAssetRef;
  fromAmountBaseUnits: string;
  expectedToAmountBaseUnits: string;
  minimumToAmountBaseUnits: string;
  slippageBps: number;
  fees: TradeFeeFact[];
  operatorFee?: OperatorFeeRecord;
  approval: "permit2-exact" | "existing-permit2-allowance";
  quoteBlockNumber: string;
  quotedAt: string;
  permitDeadline: string;
  executionDeadline: string;
};

export type TradeSigningRequest =
  | { signer: "base-account"; typedData: Permit2TypedData }
  | { signer: "cdp-embedded"; evmAccount: Address; typedData: CoinbaseSmartWalletTypedData };

export type ParsedTradeSigningRequest =
  | { signer: "base-account"; typedData: Permit2TypedData & {
      domain: Permit2TypedData["domain"] & { verifyingContract: Address };
      message: Permit2TypedData["message"] & { permitted: { token: Address; amount: string }; spender: Address };
    } }
  | { signer: "cdp-embedded"; evmAccount: Address; typedData: CoinbaseSmartWalletTypedData & {
      domain: CoinbaseSmartWalletTypedData["domain"] & { verifyingContract: Address };
      message: { hash: Hash32 };
    } };

export type TradeConfirmRequest = { signature: `0x${string}` };

export const TRADE_ERROR_CODES = [
  "TRADE_INVALID",
  "TRADE_UNAVAILABLE",
  "TRADE_SIGNER_UNSUPPORTED",
  "TRADE_INSUFFICIENT_BALANCE",
  "TRADE_ROUTE_UNAVAILABLE",
  "TRADE_BELOW_MINIMUM",
  "TRADE_TOKEN_UNREADABLE",
  "TRADE_BUY_UNAVAILABLE",
  "TRADE_QUOTE_STALE",
  "TRADE_QUOTE_REJECTED",
  "TRADE_STOCK_RESTRICTED",
  "TRADE_NOT_ROUTED",
] as const;
export type TradeErrorCode = (typeof TRADE_ERROR_CODES)[number];

export const TRADE_UNAVAILABLE_REASONS = [
  "provider-unconfigured",
  "signer-unsupported",
  "account-unavailable",
  "asset-unsupported",
  "token-unreadable",
  "chain-unavailable",
] as const;
export type TradeUnavailableReason = (typeof TRADE_UNAVAILABLE_REASONS)[number];

export type TradeToken = {
  assetId: string;
  address: Address;
  symbol: string;
  decimals: number;
};

export type TradeAvailabilityResponse = {
  version: typeof TRADE_AVAILABILITY_CONTRACT_VERSION;
} & (
  | { status: "available"; token: TradeToken; buy: "available" | "blocked"; balanceBaseUnits: string }
  | { status: "unavailable"; reason: TradeUnavailableReason }
);

export const MAX_TRADE_TOKEN_DECIMALS = 36;
const integerPattern = /^(?:0|[1-9][0-9]*)$/;
const symbolPattern = /^[A-Za-z0-9$._-]{1,16}$/;
const MAX_TRADE_BASE_UNITS = (BigInt(1) << BigInt(256)) - BigInt(1);

export function parseTradeActionParams(value: unknown): TradeActionParams | null {
  if (!isRecord(value) || Object.keys(value).length !== 4 ||
    value.version !== TRADE_ACTION_CONTRACT_VERSION ||
    typeof value.assetId !== "string" || value.assetId.length === 0 || value.assetId.length > 64 ||
    (value.direction !== "buy" && value.direction !== "sell") ||
    typeof value.amountBaseUnits !== "string") return null;
  if (value.amountBaseUnits === TRADE_SELL_ALL) {
    if (value.direction !== "sell") return null;
  } else {
    if (!integerPattern.test(value.amountBaseUnits)) return null;
    const amount = BigInt(value.amountBaseUnits);
    if (amount <= BigInt(0) || amount > MAX_TRADE_BASE_UNITS) return null;
  }
  return {
    version: TRADE_ACTION_CONTRACT_VERSION,
    assetId: value.assetId,
    direction: value.direction,
    amountBaseUnits: value.amountBaseUnits,
  };
}

export function isTradeTokenSymbol(value: unknown): value is string {
  return typeof value === "string" && symbolPattern.test(value);
}

function parseTradeToken(value: unknown): TradeToken | null {
  if (!isRecord(value) || typeof value.assetId !== "string" || !value.assetId) return null;
  const address = parseAddress(value.address);
  if (!address ||
    !isTradeTokenSymbol(value.symbol) ||
    typeof value.decimals !== "number" || !Number.isInteger(value.decimals) ||
    value.decimals < 0 || value.decimals > MAX_TRADE_TOKEN_DECIMALS) return null;
  return { assetId: value.assetId, address, symbol: value.symbol, decimals: value.decimals };
}

export function parseTradeAvailabilityResponse(value: unknown): TradeAvailabilityResponse | null {
  if (!isRecord(value) || value.version !== TRADE_AVAILABILITY_CONTRACT_VERSION) return null;
  if (value.status === "available") {
    const token = parseTradeToken(value.token);
    if (!token || (value.buy !== "available" && value.buy !== "blocked") ||
      typeof value.balanceBaseUnits !== "string" || !integerPattern.test(value.balanceBaseUnits)) return null;
    return {
      version: TRADE_AVAILABILITY_CONTRACT_VERSION, status: "available", token,
      buy: value.buy, balanceBaseUnits: value.balanceBaseUnits,
    };
  }
  if (value.status === "unavailable" && (TRADE_UNAVAILABLE_REASONS as readonly unknown[]).includes(value.reason)) {
    return { version: TRADE_AVAILABILITY_CONTRACT_VERSION, status: "unavailable", reason: value.reason as TradeUnavailableReason };
  }
  return null;
}

export function isTradeErrorCode(value: unknown): value is TradeErrorCode {
  return typeof value === "string" && (TRADE_ERROR_CODES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
