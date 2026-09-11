import "server-only";

import { generateJwt } from "@coinbase/cdp-sdk/auth";
import type {
  Address,
  Hex,
  TradeFee,
  TradeQuote,
  TradeQuoteClient,
  TradeQuoteRequest,
} from "@/shared/trading/server-types";

const CDP_API_HOST = "api.cdp.coinbase.com";
const CDP_API_PATH = "/platform/v2/evm/swaps";
const CDP_API_URL = `https://${CDP_API_HOST}${CDP_API_PATH}`;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const hexPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const uintPattern = /^(?:0|[1-9][0-9]*)$/;

type CdpEnvironment = Record<string, string | undefined>;

export class TradeProviderUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("CDP Trade API is unavailable.", { cause });
    this.name = "TradeProviderUnavailableError";
  }
}

export async function createCdpTradeQuoteClient({
  env = process.env,
  fetchImpl = fetch,
  generateJwtImpl = generateJwt,
}: {
  env?: CdpEnvironment;
  fetchImpl?: typeof fetch;
  generateJwtImpl?: typeof generateJwt;
} = {}): Promise<TradeQuoteClient> {
  const apiKeyId = env.CDP_API_KEY_ID?.trim();
  const apiKeySecret = env.CDP_API_KEY_SECRET?.trim();
  if (!apiKeyId || !apiKeySecret) throw new TradeProviderUnavailableError();

  return {
    async createSwapQuote(request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const jwt = await generateJwtImpl({
          apiKeyId,
          apiKeySecret,
          requestMethod: "POST",
          requestHost: CDP_API_HOST,
          requestPath: CDP_API_PATH,
          expiresIn: 120,
        });
        const response = await fetchImpl(CDP_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
            "X-Idempotency-Key": request.idempotencyKey ?? crypto.randomUUID(),
          },
          body: JSON.stringify({
            network: request.network,
            fromToken: request.fromToken,
            toToken: request.toToken,
            fromAmount: request.fromAmount.toString(),
            taker: request.taker,
            signerAddress: request.signerAddress,
            slippageBps: request.slippageBps,
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new TradeProviderUnavailableError();
        return parseQuote(await response.json(), request);
      } catch (error) {
        if (error instanceof TradeProviderUnavailableError) throw error;
        throw new TradeProviderUnavailableError(error);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function parseQuote(value: unknown, request: TradeQuoteRequest): TradeQuote {
  if (!isRecord(value) || typeof value.liquidityAvailable !== "boolean") invalid();
  if (!value.liquidityAvailable) return { liquidityAvailable: false };
  const issues = record(value.issues);
  const fees = record(value.fees);
  const transaction = record(value.transaction);
  const permit2 = value.permit2 === null || value.permit2 === undefined
    ? null
    : record(value.permit2);
  return {
    liquidityAvailable: true,
    network: request.network,
    fromToken: address(value.fromToken),
    toToken: address(value.toToken),
    fromAmount: uint(value.fromAmount),
    toAmount: uint(value.toAmount),
    minToAmount: uint(value.minToAmount),
    blockNumber: uint(value.blockNumber),
    fees: {
      ...(fees.gasFee === null || fees.gasFee === undefined
        ? {}
        : { gasFee: parseFee(fees.gasFee) }),
      ...(fees.protocolFee === null || fees.protocolFee === undefined
        ? {}
        : { protocolFee: parseFee(fees.protocolFee) }),
    },
    issues: {
      ...(issues.allowance === null || issues.allowance === undefined
        ? {}
        : { allowance: parseAllowance(issues.allowance) }),
      ...(issues.balance === null || issues.balance === undefined
        ? {}
        : { balance: parseBalanceIssue(issues.balance) }),
      simulationIncomplete: boolean(issues.simulationIncomplete),
    },
    transaction: {
      to: address(transaction.to),
      data: hex(transaction.data),
      value: uint(transaction.value),
      gas: uint(transaction.gas),
      gasPrice: uint(transaction.gasPrice),
    },
    ...(permit2
      ? { permit2: { hash: hash(permit2.hash), eip712: permit2.eip712 } }
      : {}),
  };
}

function parseFee(value: unknown): TradeFee {
  const fee = record(value);
  return { amount: uint(fee.amount), token: address(fee.token) };
}

function parseAllowance(value: unknown) {
  const allowance = record(value);
  return {
    currentAllowance: uint(allowance.currentAllowance),
    spender: address(allowance.spender),
  };
}

function parseBalanceIssue(value: unknown) {
  const balance = record(value);
  return {
    token: address(balance.token),
    currentBalance: uint(balance.currentBalance),
    requiredBalance: uint(balance.requiredBalance),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalid();
  return value;
}

function address(value: unknown): Address {
  if (typeof value !== "string" || !addressPattern.test(value)) invalid();
  return value.toLowerCase() as Address;
}

function hash(value: unknown): Hex {
  if (typeof value !== "string" || !hashPattern.test(value)) invalid();
  return value.toLowerCase() as Hex;
}

function hex(value: unknown): Hex {
  if (typeof value !== "string" || !hexPattern.test(value)) invalid();
  return value.toLowerCase() as Hex;
}

function uint(value: unknown): bigint {
  if (typeof value !== "string" || !uintPattern.test(value)) invalid();
  return BigInt(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function invalid(): never {
  throw new TradeProviderUnavailableError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let clientPromise: Promise<TradeQuoteClient> | undefined;

export function getCdpTradeQuoteClient(): Promise<TradeQuoteClient> {
  if (!clientPromise) {
    clientPromise = createCdpTradeQuoteClient().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}
