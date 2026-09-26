import type { Address, CoinbaseSmartWalletTypedData, Permit2TypedData } from "./server-types";

export const TRADE_ACTION_CONTRACT_VERSION = 1 as const;
export const TRADE_AVAILABILITY_CONTRACT_VERSION = 1 as const;
export const TRADE_ASSET_ID = "cbbtc" as const;
export const TRADE_SLIPPAGE_BPS = 100 as const;

export type TradeDirection = "buy" | "sell";

export type TradeActionParams = {
  version: typeof TRADE_ACTION_CONTRACT_VERSION;
  assetId: typeof TRADE_ASSET_ID;
  direction: TradeDirection;
  amountBaseUnits: string;
};

export type TradeAssetRef = {
  id: "usdc" | typeof TRADE_ASSET_ID;
  symbol: "USDC" | "cbBTC";
  decimals: 6 | 8;
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
  fromAsset: TradeAssetRef;
  toAsset: TradeAssetRef;
  fromAmountBaseUnits: string;
  expectedToAmountBaseUnits: string;
  minimumToAmountBaseUnits: string;
  slippageBps: number;
  fees: TradeFeeFact[];
  approval: "permit2-exact" | "existing-permit2-allowance";
  quoteBlockNumber: string;
  quotedAt: string;
  permitDeadline: string;
  executionDeadline: string;
};

export type TradeSigningRequest =
  | { signer: "base-account"; typedData: Permit2TypedData }
  | { signer: "cdp-embedded"; evmAccount: Address; typedData: CoinbaseSmartWalletTypedData };

export type TradeConfirmRequest = { signature: `0x${string}` };

export const TRADE_ERROR_CODES = [
  "TRADE_INVALID",
  "TRADE_UNAVAILABLE",
  "TRADE_SIGNER_UNSUPPORTED",
  "TRADE_INSUFFICIENT_BALANCE",
  "TRADE_NO_LIQUIDITY",
  "TRADE_QUOTE_STALE",
  "TRADE_QUOTE_REJECTED",
  "TRADE_STOCK_RESTRICTED",
  "TRADE_NOT_ROUTED",
] as const;
export type TradeErrorCode = (typeof TRADE_ERROR_CODES)[number];

export type TradeAvailabilityResponse = {
  version: typeof TRADE_AVAILABILITY_CONTRACT_VERSION;
} & (
  | { status: "available" }
  | { status: "unavailable"; reason: "provider-unconfigured" | "signer-unsupported" | "account-unavailable" }
);

const integerPattern = /^(?:0|[1-9][0-9]*)$/;
const MAX_TRADE_BASE_UNITS = BigInt("1000000000000000000000000");

export function parseTradeActionParams(value: unknown): TradeActionParams | null {
  if (!isRecord(value) || Object.keys(value).length !== 4 ||
    value.version !== TRADE_ACTION_CONTRACT_VERSION ||
    value.assetId !== TRADE_ASSET_ID ||
    (value.direction !== "buy" && value.direction !== "sell") ||
    typeof value.amountBaseUnits !== "string" || !integerPattern.test(value.amountBaseUnits)) return null;
  const amount = BigInt(value.amountBaseUnits);
  if (amount <= BigInt(0) || amount > MAX_TRADE_BASE_UNITS) return null;
  return {
    version: TRADE_ACTION_CONTRACT_VERSION,
    assetId: TRADE_ASSET_ID,
    direction: value.direction,
    amountBaseUnits: value.amountBaseUnits,
  };
}

export function parseTradeAvailabilityResponse(value: unknown): TradeAvailabilityResponse | null {
  if (!isRecord(value) || value.version !== TRADE_AVAILABILITY_CONTRACT_VERSION) return null;
  if (value.status === "available") return { version: TRADE_AVAILABILITY_CONTRACT_VERSION, status: "available" };
  if (value.status === "unavailable" && (
    value.reason === "provider-unconfigured" || value.reason === "signer-unsupported" || value.reason === "account-unavailable"
  )) return { version: TRADE_AVAILABILITY_CONTRACT_VERSION, status: "unavailable", reason: value.reason };
  return null;
}

export function isTradeErrorCode(value: unknown): value is TradeErrorCode {
  return typeof value === "string" && (TRADE_ERROR_CODES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
