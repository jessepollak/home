import "server-only";

import type { MoneyActionCall } from "@/shared/money-actions/types";
import {
  BaseRpcError,
  createBaseRpcClient,
  parseRpcQuantity,
  resolveBaseRpcUrl,
} from "./rpc";

const DEFAULT_SIMULATION_TIMEOUT_MS = 8_000;
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const hexDataPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const dataWordPattern = /^0x[0-9a-fA-F]{64}$/;
const IMPLEMENTATION_SELECTOR = "5c60da1b";
const EXECUTE_BATCH_SELECTOR = "34fcd5be";

type FetchLike = typeof fetch;
export type ChainAddress = `0x${string}`;
export type PinnedBlockSource = {
  blockNumber: string;
  blockHash: `0x${string}`;
};

export type CoinbaseSmartAccountBatchEstimator = {
  estimateBatch(
    calls: readonly MoneyActionCall[],
    account: ChainAddress,
    signal?: AbortSignal,
  ): Promise<bigint>;
};

export type CoinbaseSmartAccountBatchSimulator = {
  simulateBatch(
    calls: readonly MoneyActionCall[],
    account: ChainAddress,
    source: PinnedBlockSource,
    signal?: AbortSignal,
  ): Promise<void>;
};

type SimulationErrorOptions = ErrorOptions & {
  rpcErrorCode?: BaseRpcError["code"] | null;
  rpcCode?: number | null;
  httpStatus?: number | null;
};

export class CoinbaseSmartAccountBatchSimulationError extends Error {
  readonly code: "rpc" | "account-capability";
  readonly rpcErrorCode: BaseRpcError["code"] | null;
  readonly rpcCode: number | null;
  readonly httpStatus: number | null;

  constructor(
    message: string,
    codeOrOptions: "rpc" | "account-capability" | SimulationErrorOptions = "rpc",
    options?: SimulationErrorOptions,
  ) {
    const details = typeof codeOrOptions === "string" ? options : codeOrOptions;
    super(message, details);
    this.name = "CoinbaseSmartAccountBatchSimulationError";
    this.code = typeof codeOrOptions === "string" ? codeOrOptions : "rpc";
    this.rpcErrorCode = details?.rpcErrorCode ?? null;
    this.rpcCode = details?.rpcCode ?? null;
    this.httpStatus = details?.httpStatus ?? null;
  }
}

export function createCoinbaseSmartAccountBatchSimulator(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  timeoutMs?: number;
} = {}): CoinbaseSmartAccountBatchSimulator {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_SIMULATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new CoinbaseSmartAccountBatchSimulationError(
      "The Base RPC timeout must be 1-30000ms.",
    );
  }
  const client = createBaseRpcClient({ fetchImpl, rpcUrl, timeoutMs });

  return {
    async simulateBatch(calls, account, source, externalSignal) {
      assertAddress(account, "account");
      if (calls.length === 0) {
        throw new CoinbaseSmartAccountBatchSimulationError(
          "Simulation requires at least one call.",
        );
      }
      for (const call of calls) assertAddress(call.to, "call.to");
      if (!/^\d+$/.test(source.blockNumber)) {
        throw new CoinbaseSmartAccountBatchSimulationError(
          "Simulation block number is invalid.",
        );
      }
      if (!blockHashPattern.test(source.blockHash)) {
        throw new CoinbaseSmartAccountBatchSimulationError(
          "Simulation block hash is invalid.",
        );
      }

      await withTimeout(timeoutMs, externalSignal, async (signal) => {
        const block = toQuantity(BigInt(source.blockNumber));
        const accountCode = readCode(
          await rpc(client, "eth_getCode", [account, block], signal, 21),
          "smart account",
        );
        if (!hasExecutableCode(accountCode)) {
          throw new CoinbaseSmartAccountBatchSimulationError(
            "This verified account is not deployed, so Home cannot simulate Coinbase executeBatch for it.",
            "account-capability",
          );
        }

        const implementationResult = await rpc(
          client,
          "eth_call",
          [{ to: account, data: encodeImplementation() }, block],
          signal,
          22,
        );

        let implementation: ChainAddress;
        try {
          implementation = decodeAddressWord(implementationResult);
        } catch (error) {
          throw new CoinbaseSmartAccountBatchSimulationError(
            "This deployed account does not expose a valid Coinbase smart-account implementation.",
            "account-capability",
            { cause: error },
          );
        }
        if (/^0x0{40}$/i.test(implementation)) {
          throw new CoinbaseSmartAccountBatchSimulationError(
            "The Coinbase smart-account implementation is unavailable.",
            "account-capability",
          );
        }

        const implementationCode = readCode(
          await rpc(client, "eth_getCode", [implementation, block], signal, 23),
          "smart account implementation",
        );
        if (!hasExecutableCode(implementationCode)) {
          throw new CoinbaseSmartAccountBatchSimulationError(
            "The Coinbase smart-account implementation is not deployed at the pinned block.",
            "account-capability",
          );
        }

        const result = await rpc(
          client,
          "eth_call",
          [{
            // Coinbase MultiOwnable permits the account itself; this preserves the exact ordered
            // state changes without claiming that a future user signature has been validated.
            from: account,
            to: account,
            data: encodeCoinbaseExecuteBatch(calls),
            value: "0x0",
          }, block],
          signal,
          24,
        );
        if (typeof result !== "string" || !hexDataPattern.test(result)) {
          throw new CoinbaseSmartAccountBatchSimulationError(
            "Base RPC returned invalid batch simulation data.",
          );
        }

        const confirmed = readBlock(
          await rpc(client, "eth_getBlockByNumber", [block, false], signal, 25),
        );
        if (
          confirmed.number !== BigInt(source.blockNumber) ||
          confirmed.hash.toLowerCase() !== source.blockHash.toLowerCase()
        ) {
          throw new CoinbaseSmartAccountBatchSimulationError(
            "The Base source block changed during batch simulation.",
          );
        }
      });
    },
  };
}

export const getBaseCoinbaseSmartAccountBatch =
  createCoinbaseSmartAccountBatchSimulator();

export function createCoinbaseSmartAccountBatchEstimator(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  timeoutMs?: number;
} = {}): CoinbaseSmartAccountBatchEstimator {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_SIMULATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new CoinbaseSmartAccountBatchSimulationError(
      "The Base RPC timeout must be 1-30000ms.",
    );
  }
  const client = createBaseRpcClient({ fetchImpl, rpcUrl, timeoutMs });

  return {
    async estimateBatch(calls, account, externalSignal) {
      assertAddress(account, "account");
      validateCalls(calls, "Estimation");
      return withTimeout(timeoutMs, externalSignal, async (signal) => {
        const accountCode = readCode(
          await rpc(client, "eth_getCode", [account, "latest"], signal, 31),
          "smart account",
        );
        if (!hasExecutableCode(accountCode)) {
          throw new CoinbaseSmartAccountBatchSimulationError(
            "This verified account is not deployed, so Home cannot estimate Coinbase executeBatch for it.",
            "account-capability",
          );
        }
        const result = await rpc(client, "eth_estimateGas", [{
          from: account,
          to: account,
          data: encodeCoinbaseExecuteBatch(calls),
          value: "0x0",
        }, "latest"], signal, 32);
        try {
          return parseRpcQuantity(result, "batch gas estimate", UINT256_MAX);
        } catch (error) {
          throw new CoinbaseSmartAccountBatchSimulationError(
            "Base RPC returned an invalid batch gas estimate.",
            { cause: error },
          );
        }
      });
    },
  };
}

export const getBaseCoinbaseSmartAccountBatchEstimator =
  createCoinbaseSmartAccountBatchEstimator();

const BATCH_GAS_LIMIT_CAP = BigInt(2_000_000);
export function applyCoinbaseBatchGasHeadroom(raw: bigint): bigint | null {
  if (raw < BigInt(0)) throw new RangeError("Gas estimate cannot be negative.");
  if (raw > BATCH_GAS_LIMIT_CAP) return null;
  const percentage = (raw * BigInt(120) + BigInt(99)) / BigInt(100);
  const floor = raw + BigInt(50_000);
  const padded = percentage > floor ? percentage : floor;
  return padded > BATCH_GAS_LIMIT_CAP ? BATCH_GAS_LIMIT_CAP : padded;
}

export function encodeCoinbaseExecuteBatch(
  calls: readonly MoneyActionCall[],
): `0x${string}` {
  validateCalls(calls, "Coinbase executeBatch");
  const tupleBodies = calls.map((call) => {
    const callData = call.data.slice(2).toLowerCase();
    const paddedData = callData.padEnd(Math.ceil(callData.length / 64) * 64, "0");
    return [
      addressWord(call.to as ChainAddress),
      uintWord(BigInt(call.value)),
      uintWord(BigInt(96)),
      uintWord(BigInt(callData.length / 2)),
      paddedData,
    ].join("");
  });
  let offset = BigInt(calls.length * 32);
  const offsets = tupleBodies.map((body) => {
    const word = uintWord(offset);
    offset += BigInt(body.length / 2);
    return word;
  });
  return data(
    EXECUTE_BATCH_SELECTOR,
    uintWord(BigInt(32)),
    uintWord(BigInt(calls.length)),
    ...offsets,
    ...tupleBodies,
  );
}

export function encodeImplementation(): `0x${string}` {
  return data(IMPLEMENTATION_SELECTOR);
}

async function withTimeout<T>(
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", abort, { once: true });
  if (externalSignal?.aborted) abort();
  try {
    return await work(controller.signal);
  } catch (error) {
    if (error instanceof CoinbaseSmartAccountBatchSimulationError) throw error;
    throw new CoinbaseSmartAccountBatchSimulationError(
      controller.signal.aborted
        ? "The Base smart-account batch simulation timed out or was aborted."
        : "The Base smart-account batch simulation failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

async function rpc(
  client: ReturnType<typeof createBaseRpcClient>,
  method: string,
  params: readonly unknown[],
  signal: AbortSignal,
  id: number,
): Promise<unknown> {
  try {
    return await client.request(method, params, signal, id);
  } catch (error) {
    throw new CoinbaseSmartAccountBatchSimulationError(
      "Base RPC rejected a smart-account batch simulation call.",
      {
        cause: error,
        rpcErrorCode: error instanceof BaseRpcError ? error.code : null,
        rpcCode: error instanceof BaseRpcError ? error.rpcCode : null,
        httpStatus: error instanceof BaseRpcError ? error.httpStatus : null,
      },
    );
  }
}

function decodeAddressWord(value: unknown): ChainAddress {
  if (typeof value !== "string" || !dataWordPattern.test(value)) {
    throw new TypeError("Base RPC returned invalid smart account implementation data.");
  }
  const word = BigInt(value);
  if (word >= (BigInt(1) << BigInt(160))) {
    throw new TypeError("Address word is out of range.");
  }
  return `0x${word.toString(16).padStart(40, "0")}` as ChainAddress;
}

function readCode(value: unknown, label: string): string {
  if (typeof value !== "string" || !hexDataPattern.test(value)) {
    throw new CoinbaseSmartAccountBatchSimulationError(
      `Base RPC returned invalid ${label} code.`,
    );
  }
  return value;
}

function hasExecutableCode(value: string): boolean {
  return value.length > 2 && /[1-9a-f]/i.test(value.slice(2));
}

function readBlock(value: unknown): { number: bigint; hash: `0x${string}` } {
  if (!isRecord(value)) {
    throw new CoinbaseSmartAccountBatchSimulationError(
      "Base RPC returned invalid block metadata.",
    );
  }
  if (typeof value.hash !== "string" || !blockHashPattern.test(value.hash)) {
    throw new CoinbaseSmartAccountBatchSimulationError(
      "Base RPC returned an invalid block hash.",
    );
  }
  try {
    return {
      number: parseRpcQuantity(value.number, "block number", UINT256_MAX),
      hash: value.hash as `0x${string}`,
    };
  } catch (error) {
    throw new CoinbaseSmartAccountBatchSimulationError(
      "Base RPC returned malformed block number.",
      { cause: error },
    );
  }
}

function validateCalls(calls: readonly MoneyActionCall[], label: string): void {
  if (calls.length === 0) throw new TypeError(`${label} requires at least one call.`);
  for (const call of calls) {
    if (!addressPattern.test(call.to)) throw new TypeError("Invalid call address.");
    if (!hexDataPattern.test(call.data)) throw new TypeError("Invalid call data.");
    if (!/^\d+$/.test(call.value)) throw new TypeError("Invalid call value.");
    const value = BigInt(call.value);
    if (value > UINT256_MAX) throw new RangeError("Call value is out of range.");
  }
}

function assertAddress(value: string, label: string): asserts value is ChainAddress {
  if (!addressPattern.test(value)) {
    throw new CoinbaseSmartAccountBatchSimulationError(
      `${label} must be an EVM address.`,
    );
  }
}

function toQuantity(value: bigint): `0x${string}` {
  if (value < BigInt(0)) {
    throw new CoinbaseSmartAccountBatchSimulationError(
      "RPC quantity cannot be negative.",
    );
  }
  return `0x${value.toString(16)}`;
}

function data(selector: string, ...words: string[]): `0x${string}` {
  return `0x${selector}${words.join("")}`;
}

function addressWord(address: ChainAddress): string {
  if (!addressPattern.test(address)) throw new TypeError("Invalid address.");
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function uintWord(value: bigint): string {
  if (value < BigInt(0) || value > UINT256_MAX) {
    throw new RangeError("uint256 is out of range.");
  }
  return value.toString(16).padStart(64, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
