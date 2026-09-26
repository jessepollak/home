import "server-only";

import { generateJwt } from "@coinbase/cdp-sdk/auth";
import type { Address, Hex } from "@/shared/trading/server-types";

export const SWAPS_PATH = "/platform/v2/evm/swaps";
export const PRICE_PATH = `${SWAPS_PATH}/quote`;
const HOST = "api.cdp.coinbase.com";
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hexPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const uintPattern = /^(?:0|[1-9][0-9]*)$/;

export class CdpSwapsUnavailableError extends Error {
  constructor() {
    super("CDP Swaps unavailable.");
    this.name = "CdpSwapsUnavailableError";
  }
}

export type SwapsRequest = {
  fromToken: Address;
  toToken: Address;
  fromAmount: bigint;
  taker: Address;
  signerAddress?: Address;
  slippageBps: number;
  requestKey?: string;
};
type Fee = { token: Address; amount: bigint };
type Common = {
  liquidityAvailable: true;
  fromToken: Address;
  toToken: Address;
  fromAmount: bigint;
  toAmount: bigint;
  minToAmount: bigint;
  blockNumber: bigint;
  fees: { gasFee: Fee | null; protocolFee: Fee | null };
  issues: {
    allowance: { currentAllowance: bigint; spender: Address } | null;
    balance: { token: Address; currentBalance: bigint; requiredBalance: bigint } | null;
    simulationIncomplete: boolean;
  };
};
export type SwapPrice = { liquidityAvailable: false } | (Common & { gas: bigint | null; gasPrice: bigint });
export type SwapQuote = { liquidityAvailable: false } | (Common & {
  permit2: { hash: Hex; eip712: unknown } | null;
  transaction: { to: Address; data: Hex; value: bigint; gas: bigint; gasPrice: bigint };
});
export type CdpSwapsClient = {
  getPrice(request: SwapsRequest): Promise<SwapPrice>;
  createQuote(request: SwapsRequest): Promise<SwapQuote>;
};

export function createCdpSwapsClient({
  env = process.env,
  fetchImpl = fetch,
  generateJwtImpl = generateJwt,
  timeoutMs = 10_000,
}: {
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  generateJwtImpl?: typeof generateJwt;
  timeoutMs?: number;
} = {}): CdpSwapsClient {
  const apiKeyId = env.CDP_API_KEY_ID?.trim();
  const apiKeySecret = env.CDP_API_KEY_SECRET?.trim();
  if (!apiKeyId || !apiKeySecret || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) unavailable();
  const usedKeys = new Set<string>();
  async function send(method: "GET" | "POST", path: string, request: SwapsRequest): Promise<unknown> {
    const fromToken = address(request.fromToken);
    const toToken = address(request.toToken);
    const taker = address(request.taker);
    const signerAddress = request.signerAddress === undefined ? undefined : address(request.signerAddress);
    if (request.fromAmount <= BigInt(0) || request.fromAmount > UINT256_MAX || !Number.isInteger(request.slippageBps) || request.slippageBps < 1 || request.slippageBps > 300) unavailable();
    const payload = {
      network: "base",
      fromToken, toToken, fromAmount: request.fromAmount.toString(), taker,
      ...(signerAddress ? { signerAddress } : {}),
      slippageBps: request.slippageBps,
    };
    let key: string | undefined;
    if (method === "POST") {
      key = request.requestKey ?? crypto.randomUUID();
      if (!/^[0-9a-fA-F-]{36}$/.test(key) || usedKeys.has(key)) unavailable();
      usedKeys.add(key);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const jwt = await generateJwtImpl({ apiKeyId: apiKeyId!, apiKeySecret: apiKeySecret!, requestMethod: method, requestHost: HOST, requestPath: path, expiresIn: 120 });
      if (controller.signal.aborted || typeof jwt !== "string" || !jwt || /\s/.test(jwt)) unavailable();
      const url = new URL(`https://${HOST}${path}`);
      if (method === "GET") for (const [field, value] of Object.entries(payload)) url.searchParams.set(field, String(value));
      const response = await fetchImpl(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json", "X-Idempotency-Key": key! } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok || controller.signal.aborted) unavailable();
      return await response.json();
    } catch {
      unavailable();
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    async getPrice(request) { return parsePrice(await send("GET", PRICE_PATH, request)); },
    async createQuote(request) { return parseQuote(await send("POST", SWAPS_PATH, request)); },
  };
}

function common(value: unknown): { liquidityAvailable: false } | Common {
  const row = record(value);
  if (row.liquidityAvailable === false) return { liquidityAvailable: false };
  if (row.liquidityAvailable !== true) unavailable();
  const fees = record(row.fees);
  const issues = record(row.issues);
  if (typeof issues.simulationIncomplete !== "boolean") unavailable();
  const blockNumber = uint(row.blockNumber);
  if (blockNumber === BigInt(0)) unavailable();
  return {
    liquidityAvailable: true,
    fromToken: address(row.fromToken), toToken: address(row.toToken),
    fromAmount: uint(row.fromAmount), toAmount: uint(row.toAmount), minToAmount: uint(row.minToAmount), blockNumber,
    fees: { gasFee: nullable(fees.gasFee, fee), protocolFee: nullable(fees.protocolFee, fee) },
    issues: {
      allowance: nullable(issues.allowance, (value) => {
        const a = record(value);
        return { currentAllowance: uint(a.currentAllowance), spender: address(a.spender) };
      }),
      balance: nullable(issues.balance, (value) => {
        const b = record(value);
        return { token: address(b.token), currentBalance: uint(b.currentBalance), requiredBalance: uint(b.requiredBalance) };
      }),
      simulationIncomplete: issues.simulationIncomplete,
    },
  };
}
function parsePrice(value: unknown): SwapPrice {
  const base = common(value);
  if (!base.liquidityAvailable) return base;
  const row = record(value);
  return { ...base, gas: nullable(row.gas, uint), gasPrice: uint(row.gasPrice) };
}
function parseQuote(value: unknown): SwapQuote {
  const base = common(value);
  if (!base.liquidityAvailable) return base;
  const row = record(value);
  const transaction = record(row.transaction);
  return {
    ...base,
    permit2: nullable(row.permit2, (value) => {
      const permit = record(value);
      const eip712 = record(permit.eip712);
      record(eip712.domain);
      record(eip712.types);
      record(eip712.message);
      return { hash: hash(permit.hash), eip712 };
    }),
    transaction: {
      to: address(transaction.to), data: hex(transaction.data), value: uint(transaction.value),
      gas: uint(transaction.gas), gasPrice: uint(transaction.gasPrice),
    },
  };
}
function fee(value: unknown): Fee { const row = record(value); return { token: address(row.token), amount: uint(row.amount) }; }
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  if (value === null) return null;
  return parse(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) unavailable();
  return value as Record<string, unknown>;
}
function address(value: unknown): Address {
  if (typeof value !== "string" || !addressPattern.test(value)) unavailable();
  return value.toLowerCase() as Address;
}
function hash(value: unknown): Hex {
  if (typeof value !== "string" || !hashPattern.test(value)) unavailable();
  return value.toLowerCase() as Hex;
}
function hex(value: unknown): Hex {
  if (typeof value !== "string" || !hexPattern.test(value)) unavailable();
  return value.toLowerCase() as Hex;
}
function uint(value: unknown): bigint {
  if (typeof value !== "string" || !uintPattern.test(value)) unavailable();
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) unavailable();
  return parsed;
}
function unavailable(): never { throw new CdpSwapsUnavailableError(); }
