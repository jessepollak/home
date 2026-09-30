import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import type { CardAllowanceMoneyActionMetadata } from "@/shared/money-actions/types";

export const CARD_ALLOWANCE_CONTRACT_VERSION = 1 as const;
export type CardSpendingError = Readonly<{ version: 1; error: Readonly<{ code: "CARDS_UNAVAILABLE" }> }>;
/** @public Versioned error for sessions without a readable card wallet. */
export function parseCardSpendingError(value: unknown): CardSpendingError | null {
  return record(value) && value.version === CARD_ALLOWANCE_CONTRACT_VERSION && Object.keys(value).length === 2 &&
    record(value.error) && Object.keys(value.error).length === 1 && value.error.code === "CARDS_UNAVAILABLE"
    ? { version: 1, error: { code: "CARDS_UNAVAILABLE" } } : null;
}
export type CardSpendingResponse =
  | Readonly<{ version: 1; status: "available"; setEnabled: boolean; spender: `0x${string}`; walletBaseUnits: string; allowanceBaseUnits: string; availableBaseUnits: string; retired: ReadonlyArray<Readonly<{ spender: `0x${string}`; allowanceBaseUnits: string }>>; blockNumber: string; fetchedAt: string }>
  | Readonly<{ version: 1; status: "not-configured" }>
  | Readonly<{ version: 1; status: "unavailable"; fetchedAt: string }>;

/** @public Versioned card spending response parser for future client consumers. */
export function parseCardSpendingResponse(value: unknown): CardSpendingResponse | null {
  if (!record(value) || value.version !== CARD_ALLOWANCE_CONTRACT_VERSION) return null;
  if (value.status === "not-configured" && Object.keys(value).length === 2) return { version: 1, status: "not-configured" };
  if (value.status === "unavailable" && Object.keys(value).length === 3 && validTimestamp(value.fetchedAt))
    return { version: 1, status: "unavailable", fetchedAt: value.fetchedAt };
  if (value.status !== "available" || Object.keys(value).length !== 10 || typeof value.setEnabled !== "boolean" ||
      !lowercaseAddress(value.spender) || !Array.isArray(value.retired) ||
      !validUint(value.walletBaseUnits) || !validUint(value.allowanceBaseUnits) || !validUint(value.availableBaseUnits) ||
      !validUint(value.blockNumber) || !validTimestamp(value.fetchedAt)) return null;
  const retired: Array<{ spender: `0x${string}`; allowanceBaseUnits: string }> = [];
  for (const item of value.retired) {
    if (!record(item) || Object.keys(item).length !== 2 || !lowercaseAddress(item.spender) || !validUint(item.allowanceBaseUnits) ||
        item.spender === value.spender || retired.some((entry) => entry.spender === item.spender)) return null;
    retired.push({ spender: item.spender, allowanceBaseUnits: item.allowanceBaseUnits });
  }
  const minimum = BigInt(value.walletBaseUnits) < BigInt(value.allowanceBaseUnits) ? value.walletBaseUnits : value.allowanceBaseUnits;
  if (BigInt(value.availableBaseUnits) !== BigInt(minimum)) return null;
  return { version: 1, status: "available", setEnabled: value.setEnabled, spender: value.spender,
    walletBaseUnits: value.walletBaseUnits, allowanceBaseUnits: value.allowanceBaseUnits, availableBaseUnits: value.availableBaseUnits,
    retired, blockNumber: value.blockNumber, fetchedAt: value.fetchedAt };
}

function lowercaseAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && address.test(value) && value === value.toLowerCase();
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
export const CARD_ALLOWANCE_PREPARE_ERRORS = {
  unavailable: { code: "CARD_ALLOWANCE_UNAVAILABLE", status: 503 },
  "not-ready": { code: "CARD_ALLOWANCE_NOT_READY", status: 409 },
  invalid: { code: "CARD_ALLOWANCE_INVALID", status: 400 },
  unchanged: { code: "CARD_ALLOWANCE_UNCHANGED", status: 409 },
} as const;
export type CardAllowancePrepareErrorReason = keyof typeof CARD_ALLOWANCE_PREPARE_ERRORS;
export type CardAllowancePrepareErrorCode = (typeof CARD_ALLOWANCE_PREPARE_ERRORS)[CardAllowancePrepareErrorReason]["code"];
export type CardAllowancePrepareParams =
  | { version: 1; operation: "set"; allowanceBaseUnits: string }
  | { version: 1; operation: "revoke"; spender: `0x${string}` };

const address = /^0x[0-9a-fA-F]{40}$/;
const integer = /^(0|[1-9][0-9]*)$/;
const uint256 = (BigInt(1) << BigInt(256)) - BigInt(1);

export function parseCardAllowancePrepareParams(value: unknown): CardAllowancePrepareParams | null {
  if (!record(value) || value.version !== CARD_ALLOWANCE_CONTRACT_VERSION) return null;
  if (value.operation === "set" && Object.keys(value).length === 3 && typeof value.allowanceBaseUnits === "string" &&
      integer.test(value.allowanceBaseUnits) && value.allowanceBaseUnits.length <= 78 && BigInt(value.allowanceBaseUnits) <= uint256) {
    return { version: 1, operation: "set", allowanceBaseUnits: value.allowanceBaseUnits };
  }
  if (value.operation === "revoke" && Object.keys(value).length === 3 && hexAddress(value.spender)) {
    return { version: 1, operation: "revoke", spender: value.spender };
  }
  return null;
}

export function parseCardAllowanceMetadata(value: unknown): CardAllowanceMoneyActionMetadata | null {
  if (!record(value) || value.product !== "card" || value.provider !== "bridge" ||
      (value.mode !== "sandbox" && value.mode !== "production") ||
      (value.operation !== "set-allowance" && value.operation !== "revoke-allowance") ||
      value.token !== BASE_USDC_ADDRESS.toLowerCase() || !lowercaseAddress(value.token) || !lowercaseAddress(value.spender) ||
      /^0x(?:0{40}|f{40})$/.test(value.spender) ||
      !validUint(value.allowanceBaseUnits) || !validUint(value.previousAllowanceBaseUnits) ||
      !record(value.source) || !validUint(value.source.blockNumber)) return null;
  if (value.operation === "set-allowance") {
    if (value.mode !== "production" || !validUint(value.maximumBaseUnits) ||
        BigInt(value.maximumBaseUnits) === BigInt(0) || BigInt(value.maximumBaseUnits) > BigInt(1_000_000_000_000) ||
        BigInt(value.allowanceBaseUnits) === BigInt(0) || BigInt(value.allowanceBaseUnits) > BigInt(value.maximumBaseUnits)) return null;
  } else if (value.maximumBaseUnits !== null || value.allowanceBaseUnits !== "0") return null;
  return { product: "card", provider: "bridge", mode: value.mode, operation: value.operation, token: value.token,
    spender: value.spender, allowanceBaseUnits: value.allowanceBaseUnits, previousAllowanceBaseUnits: value.previousAllowanceBaseUnits,
    maximumBaseUnits: value.maximumBaseUnits, source: { blockNumber: value.source.blockNumber } };
}

function hexAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && address.test(value);
}

function validUint(value: unknown): value is string {
  return typeof value === "string" && integer.test(value) && value.length <= 78 && BigInt(value) <= uint256;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
