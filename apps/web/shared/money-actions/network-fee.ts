import type { MoneyActionNetworkFee } from "./types";

export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const BASE_USDC_PAYMASTER_ADDRESS = "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c" as const;
export const USDC_NETWORK_FEE_DECIMALS = 6 as const;

export const USDC_PAYMASTER_CONTEXT = Object.freeze({ erc20: BASE_USDC_ADDRESS.toLowerCase() });

const DEPLOYED_USDC_NETWORK_FEE_RESERVE_BASE_UNITS = "100000";
const UNDEPLOYED_USDC_NETWORK_FEE_RESERVE_BASE_UNITS = "500000";

export function usdcNetworkFeeReserveBaseUnits(deployed: boolean): string {
  return deployed ? DEPLOYED_USDC_NETWORK_FEE_RESERVE_BASE_UNITS : UNDEPLOYED_USDC_NETWORK_FEE_RESERVE_BASE_UNITS;
}

export const NETWORK_FEE_UNFUNDED_CODE = "NETWORK_FEE_UNFUNDED";
export const NETWORK_FEE_UNFUNDED_MESSAGE = "Add USDC to cover the network fee.";
export const NETWORK_FEE_ETH_UNFUNDED_MESSAGE = "Add ETH to cover this account's network fee.";
export const NETWORK_FEE_UNAVAILABLE_CODE = "NETWORK_FEE_UNAVAILABLE";
export const NETWORK_FEE_UNAVAILABLE_MESSAGE = "The network fee could not be checked. Try again.";

export function networkFeeErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  if (error.code === NETWORK_FEE_UNFUNDED_CODE) return "serverMessage" in error && error.serverMessage === NETWORK_FEE_ETH_UNFUNDED_MESSAGE
    ? NETWORK_FEE_ETH_UNFUNDED_MESSAGE
    : NETWORK_FEE_UNFUNDED_MESSAGE;
  if (error.code !== NETWORK_FEE_UNAVAILABLE_CODE) return null;
  return "serverMessage" in error && typeof error.serverMessage === "string" ? error.serverMessage : NETWORK_FEE_UNAVAILABLE_MESSAGE;
}

export function paymasterProxyPath(actionId: string): string {
  return `/api/actions/${encodeURIComponent(actionId)}/paymaster`;
}

export function parseMoneyActionNetworkFee(value: unknown): MoneyActionNetworkFee | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.payment === "native") return { payment: "native" };
  if (
    record.payment !== "usdc" ||
    typeof record.token !== "string" ||
    record.token.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase() ||
    typeof record.paymaster !== "string" ||
    record.paymaster.toLowerCase() !== BASE_USDC_PAYMASTER_ADDRESS.toLowerCase() ||
    typeof record.maxFeeBaseUnits !== "string" ||
    !/^[1-9]\d{0,17}$/.test(record.maxFeeBaseUnits) ||
    record.decimals !== USDC_NETWORK_FEE_DECIMALS
  ) {
    return null;
  }
  return {
    payment: "usdc",
    token: BASE_USDC_ADDRESS,
    paymaster: BASE_USDC_PAYMASTER_ADDRESS,
    maxFeeBaseUnits: record.maxFeeBaseUnits,
    decimals: USDC_NETWORK_FEE_DECIMALS,
  };
}
