import { getAddress, isAddress } from "viem";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";

type Address = `0x${string}`;

export const OPERATOR_FEE_MAX_BPS = 300;
export const OPERATOR_FEE_BPS_DENOMINATOR = 10_000;

export type OperatorFeeActionType = "trade";
export type OperatorFeeCollection = "in-batch-transfer" | "provider-native";
export type OperatorFeePolicy = { bps: number; recipient: Address | null };
export type OperatorFeeSettings = Record<OperatorFeeActionType, OperatorFeePolicy>;

export const OPERATOR_FEE_SETTINGS_DEFAULTS: OperatorFeeSettings = { trade: { bps: 0, recipient: null } };

export const OPERATOR_FEE_TOKEN = {
  assetId: "usdc", symbol: "USDC", decimals: 6, address: BASE_USDC_ADDRESS.toLowerCase() as Address,
} as const;

export type OperatorFeeRecord = {
  amountBaseUnits: string;
  token: typeof OPERATOR_FEE_TOKEN;
  bps: number;
  recipient: Address;
  collectedBy: OperatorFeeCollection;
};

export function parseRevenueDestination(value: unknown): Address | null {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) return null;
  const lower = value.toLowerCase() as Address;
  if (/^0x0{40}$/.test(lower)) return null;
  return lower;
}

export function revenueDestinationChecksum(value: Address): Address {
  return getAddress(value);
}

function parsePolicy(value: unknown): OperatorFeePolicy | null {
  if (!isObject(value) || !exactKeys(value, ["bps", "recipient"])) return null;
  const { bps, recipient } = value;
  if (typeof bps !== "number" || !Number.isSafeInteger(bps) || bps < 0 || bps > OPERATOR_FEE_MAX_BPS) return null;
  if (recipient === null) return bps === 0 ? { bps, recipient: null } : null;
  const parsed = parseRevenueDestination(recipient);
  return parsed ? { bps, recipient: parsed } : null;
}

export function parseOperatorFeeSettings(value: unknown): OperatorFeeSettings | null {
  if (!isObject(value) || !exactKeys(value, ["trade"])) return null;
  const trade = parsePolicy(value.trade);
  return trade ? { trade } : null;
}

export function operatorFeeAmount(amountBaseUnits: bigint, bps: number): bigint {
  if (amountBaseUnits <= BigInt(0) || bps <= 0) return BigInt(0);
  return amountBaseUnits * BigInt(bps) / BigInt(OPERATOR_FEE_BPS_DENOMINATOR);
}

export function parseOperatorFeeRecord(value: unknown): OperatorFeeRecord | null {
  if (!isObject(value) || !exactKeys(value, ["amountBaseUnits", "token", "bps", "recipient", "collectedBy"])) return null;
  const { amountBaseUnits, token, bps, recipient, collectedBy } = value;
  if (typeof amountBaseUnits !== "string" || !/^[1-9][0-9]{0,77}$/.test(amountBaseUnits)) return null;
  if (!isObject(token) || !exactKeys(token, ["assetId", "symbol", "decimals", "address"]) || token.assetId !== OPERATOR_FEE_TOKEN.assetId ||
    token.symbol !== OPERATOR_FEE_TOKEN.symbol || token.decimals !== OPERATOR_FEE_TOKEN.decimals ||
    typeof token.address !== "string" || token.address.toLowerCase() !== OPERATOR_FEE_TOKEN.address) return null;
  if (typeof bps !== "number" || !Number.isSafeInteger(bps) || bps < 1 || bps > OPERATOR_FEE_MAX_BPS) return null;
  const destination = parseRevenueDestination(recipient);
  if (!destination || (collectedBy !== "in-batch-transfer" && collectedBy !== "provider-native")) return null;
  return { amountBaseUnits, token: OPERATOR_FEE_TOKEN, bps, recipient: destination, collectedBy };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
