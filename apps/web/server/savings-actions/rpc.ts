import { BASE_CHAIN_ID, BASE_USDC_ADDRESS } from "@/server/morpho/config";
import type { Address } from "@/server/morpho/types";
import { resolveBaseRpcUrl } from "@/server/portfolio/rpc";
import {
  SELECTOR,
  SavingsActionAbiError,
  encodeAddressCall,
  encodeNoArgs,
  encodeTwoAddressCall,
  encodeUintCall,
  parseAddressWord,
  parseUintWord,
} from "./abi";
import type {
  SavingsActionKind,
  SavingsActionState,
  SavingsActionStateReader,
} from "./types";

/** Covers chain + pin + 8 singles (2 in flight) + confirm, plus one 400ms retry. */
export const SAVINGS_ACTION_RPC_TIMEOUT_MS = 10_000;
/** Public Base `-32016`s later JSON-RPC batch items; savings reads stay singles. */
export const SAVINGS_ACTION_RPC_BATCH_SIZE = 1;
/** Concurrent HTTP singles — not a JSON-RPC batch. */
export const SAVINGS_ACTION_RPC_CONCURRENCY = 2;
export const SAVINGS_ACTION_RPC_RETRY_ATTEMPTS = 2;
/** Pause before the second attempt so public Base `-32016` / 429 can clear. */
export const SAVINGS_ACTION_RPC_RETRY_DELAY_MS = 400;
const RATE_LIMITED_RPC_CODE = -32016;

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const rateLimitMessagePattern = /rate\s*limit/i;

type FetchLike = typeof fetch;
type RpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
};
type RpcSuccess = { jsonrpc: "2.0"; id: number; result: unknown };

type BlockMetadata = {
  number: string;
  numberHex: string;
  hash: `0x${string}`;
  timestamp: string;
};

export type SavingsActionRpcErrorCode = "rate-limited" | "rpc";

export class SavingsActionRpcError extends Error {
  readonly code: SavingsActionRpcErrorCode;

  constructor(
    message: string,
    options?: ErrorOptions & { code?: SavingsActionRpcErrorCode },
  ) {
    super(message, options);
    this.name = "SavingsActionRpcError";
    this.code = options?.code ?? "rpc";
  }
}

export function createSavingsActionStateReader(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
} = {}): SavingsActionStateReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  // Dedicated `BASE_RPC_URL` when set; otherwise public mainnet.base.org.
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);
  const timeoutMs = options.timeoutMs ?? SAVINGS_ACTION_RPC_TIMEOUT_MS;
  const retryAttempts = options.retryAttempts ?? SAVINGS_ACTION_RPC_RETRY_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? SAVINGS_ACTION_RPC_RETRY_DELAY_MS;
  const sleep = options.sleep ?? wait;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new SavingsActionRpcError("The savings RPC timeout must be 1-30000ms.");
  }
  if (!Number.isSafeInteger(retryAttempts) || retryAttempts < 1 || retryAttempts > 4) {
    throw new SavingsActionRpcError("The savings RPC retry attempts must be 1-4.");
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5_000) {
    throw new SavingsActionRpcError("The savings RPC retry delay must be 0-5000ms.");
  }

  return async function readSavingsActionState(input, externalSignal) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });

    try {
      const rpcRetry = { attempts: retryAttempts, retryDelayMs, sleep };
      const chain = await executeRequired(
        fetchImpl,
        rpcUrl,
        request(1, "eth_chainId", []),
        controller.signal,
        rpcRetry,
      );
      if (parseQuantity(chain.result, "chain ID") !== BigInt(BASE_CHAIN_ID)) {
        throw new SavingsActionRpcError("The configured RPC is not Base mainnet.");
      }

      const latest = await executeRequired(
        fetchImpl,
        rpcUrl,
        request(2, "eth_getBlockByNumber", ["latest", false]),
        controller.signal,
        rpcRetry,
      );
      const block = parseBlock(latest.result);
      const reads = createPinnedReads(input.kind, input.accountAddress, input.vaultAddress, input.amount, block.numberHex);
      // HTTP singles with bounded concurrency: public Base `-32016`s later items
      // in a JSON-RPC batch. Do not POST request arrays.
      const responses: RpcSuccess[] = [];
      for (const chunk of chunkReads(reads, SAVINGS_ACTION_RPC_CONCURRENCY)) {
        const chunkResponses = await Promise.all(
          chunk.map(({ rpcRequest }) =>
            executeRequired(
              fetchImpl,
              rpcUrl,
              rpcRequest,
              controller.signal,
              rpcRetry,
            ),
          ),
        );
        responses.push(...chunkResponses);
      }
      const resultById = new Map(responses.map((response) => [response.id, response.result]));
      const read = (label: string) => {
        const entry = reads.find((candidate) => candidate.label === label);
        if (!entry || !resultById.has(entry.rpcRequest.id)) {
          throw new SavingsActionRpcError(`Base RPC omitted the ${label} read.`);
        }
        return resultById.get(entry.rpcRequest.id);
      };

      const assetAddress = parseAddressWord(read("vault asset"), "vault asset");
      const shareDecimalsRaw = parseUintWord(read("vault share decimals"), "vault share decimals");
      if (shareDecimalsRaw > BigInt(255)) {
        throw new SavingsActionRpcError("The vault share decimals are out of range.");
      }
      const shareDecimals = Number(shareDecimalsRaw);
      const usdcBalance = parseUintWord(read("USDC balance"), "USDC balance");
      const sharesBalance = parseUintWord(read("vault share balance"), "vault share balance");
      const fee = parseUintWord(read("vault fee"), "vault fee");
      const limit = parseUintWord(
        read(input.kind === "deposit" ? "max deposit" : "max withdraw"),
        input.kind === "deposit" ? "max deposit" : "max withdraw",
      );
      const previewShares = parseUintWord(
        read(input.kind === "deposit" ? "preview deposit" : "preview withdraw"),
        input.kind === "deposit" ? "preview deposit" : "preview withdraw",
      );
      const allowance = input.kind === "deposit"
        ? parseUintWord(read("USDC allowance"), "USDC allowance")
        : null;

      const confirmation = await executeRequired(
        fetchImpl,
        rpcUrl,
        request(99, "eth_getBlockByNumber", [block.numberHex, false]),
        controller.signal,
        rpcRetry,
      );
      const confirmedBlock = parseBlock(confirmation.result);
      if (
        confirmedBlock.numberHex !== block.numberHex ||
        confirmedBlock.hash.toLowerCase() !== block.hash.toLowerCase()
      ) {
        throw new SavingsActionRpcError(
          "The Base source block changed while savings state was fetched.",
        );
      }

      return {
        block,
        assetAddress,
        shareDecimals,
        usdcBalance,
        sharesBalance,
        allowance,
        limit,
        previewShares,
        fee,
      } satisfies SavingsActionState;
    } catch (error) {
      if (
        error instanceof SavingsActionRpcError ||
        error instanceof SavingsActionAbiError
      ) {
        throw error;
      }
      throw new SavingsActionRpcError(
        controller.signal.aborted
          ? "The Base savings RPC request timed out or was aborted."
          : "The Base savings RPC request failed.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  };
}

export const getSavingsActionState = createSavingsActionStateReader();

function createPinnedReads(
  kind: SavingsActionKind,
  account: Address,
  vault: Address,
  amount: bigint,
  blockNumber: string,
) {
  let id = 10;
  const call = (label: string, to: Address, data: `0x${string}`) => ({
    label,
    rpcRequest: request(id++, "eth_call", [{ to, data }, blockNumber]),
  });

  const common = [
    call("vault asset", vault, encodeNoArgs(SELECTOR.asset)),
    call("vault share decimals", vault, encodeNoArgs(SELECTOR.decimals)),
    call("USDC balance", BASE_USDC_ADDRESS, encodeAddressCall(SELECTOR.balanceOf, account)),
    call("vault share balance", vault, encodeAddressCall(SELECTOR.balanceOf, account)),
    call("vault fee", vault, encodeNoArgs(SELECTOR.fee)),
  ];

  if (kind === "deposit") {
    return [
      ...common,
      call(
        "USDC allowance",
        BASE_USDC_ADDRESS,
        encodeTwoAddressCall(SELECTOR.allowance, account, vault),
      ),
      call("max deposit", vault, encodeAddressCall(SELECTOR.maxDeposit, account)),
      call("preview deposit", vault, encodeUintCall(SELECTOR.previewDeposit, amount)),
    ];
  }

  return [
    ...common,
    call("max withdraw", vault, encodeAddressCall(SELECTOR.maxWithdraw, account)),
    call("preview withdraw", vault, encodeUintCall(SELECTOR.previewWithdraw, amount)),
  ];
}

type RpcRetry = {
  attempts: number;
  retryDelayMs: number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
};

async function executeRequired(
  fetchImpl: FetchLike,
  rpcUrl: string,
  rpcRequest: RpcRequest,
  signal: AbortSignal,
  retry: RpcRetry,
): Promise<RpcSuccess> {
  const value = await transport(fetchImpl, rpcUrl, rpcRequest, signal, retry);
  const response = parseSuccess(value);
  if (!response || response.id !== rpcRequest.id) {
    throw new SavingsActionRpcError("Base RPC returned an invalid response.");
  }
  return response;
}

async function transport(
  fetchImpl: FetchLike,
  rpcUrl: string,
  body: RpcRequest,
  signal: AbortSignal,
  retry: RpcRetry,
): Promise<unknown> {
  let lastError: SavingsActionRpcError | undefined;
  for (let attempt = 0; attempt < retry.attempts; attempt += 1) {
    if (attempt > 0) {
      await retry.sleep(retry.retryDelayMs, signal);
      if (signal.aborted) {
        throw new SavingsActionRpcError("The Base savings RPC request was aborted.");
      }
    }
    try {
      return await transportOnce(fetchImpl, rpcUrl, body, signal);
    } catch (error) {
      if (!(error instanceof SavingsActionRpcError) || error.code !== "rate-limited") {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError ?? new SavingsActionRpcError(
    "Base RPC rejected a savings state read: over rate limit",
    { code: "rate-limited" },
  );
}

async function transportOnce(
  fetchImpl: FetchLike,
  rpcUrl: string,
  body: RpcRequest,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw new SavingsActionRpcError(
      signal.aborted ? "The Base savings RPC request was aborted." : "The Base savings RPC transport failed.",
      { cause: error },
    );
  }
  if (response.status === 429) {
    throw new SavingsActionRpcError(
      "Base RPC rejected a savings state read: over rate limit",
      { code: "rate-limited" },
    );
  }
  if (!response.ok) {
    throw new SavingsActionRpcError(`Base RPC returned HTTP ${response.status}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new SavingsActionRpcError("Base RPC returned malformed JSON.", { cause: error });
  }
  if (isRecord(parsed) && "error" in parsed && isRateLimitedRpcError(parsed.error)) {
    throw new SavingsActionRpcError(rpcErrorMessage(parsed.error), { code: "rate-limited" });
  }
  return parsed;
}

function request(id: number, method: string, params: unknown[]): RpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

function parseSuccess(value: unknown): RpcSuccess | null {
  if (!isRecord(value) || value.jsonrpc !== "2.0") return null;
  if ("error" in value) {
    throw new SavingsActionRpcError(rpcErrorMessage(value.error), {
      code: isRateLimitedRpcError(value.error) ? "rate-limited" : "rpc",
    });
  }
  if (
    typeof value.id !== "number" ||
    !Number.isSafeInteger(value.id) ||
    !("result" in value)
  ) return null;
  return value as RpcSuccess;
}

function rpcErrorMessage(value: unknown): string {
  if (!isRecord(value) || typeof value.message !== "string") {
    return "Base RPC rejected a savings state read.";
  }
  const message = value.message.trim();
  if (!message) return "Base RPC rejected a savings state read.";
  const clipped = message.length > 160 ? `${message.slice(0, 157)}...` : message;
  return `Base RPC rejected a savings state read: ${clipped}`;
}

function chunkReads<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function isRateLimitedRpcError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.code === RATE_LIMITED_RPC_CODE) return true;
  return typeof value.message === "string" && rateLimitMessagePattern.test(value.message);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!Number.isFinite(ms) || ms <= 0 || signal.aborted) {
      if (signal.aborted) {
        reject(new SavingsActionRpcError("The Base savings RPC request was aborted."));
        return;
      }
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new SavingsActionRpcError("The Base savings RPC request was aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseBlock(value: unknown): BlockMetadata {
  if (!isRecord(value)) {
    throw new SavingsActionRpcError("Base RPC returned invalid block metadata.");
  }
  const number = parseQuantity(value.number, "block number");
  const timestamp = parseQuantity(value.timestamp, "block timestamp");
  if (typeof value.hash !== "string" || !blockHashPattern.test(value.hash)) {
    throw new SavingsActionRpcError("Base RPC returned an invalid block hash.");
  }
  return {
    number: number.toString(10),
    numberHex: value.number as string,
    hash: value.hash.toLowerCase() as `0x${string}`,
    timestamp: timestamp.toString(10),
  };
}

function parseQuantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !quantityPattern.test(value)) {
    throw new SavingsActionRpcError(`Base RPC returned malformed ${label}.`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) {
    throw new SavingsActionRpcError(`Base RPC returned out-of-range ${label}.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
