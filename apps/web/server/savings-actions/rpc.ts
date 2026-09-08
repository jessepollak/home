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

export const SAVINGS_ACTION_RPC_TIMEOUT_MS = 6_000;
export const SAVINGS_ACTION_RPC_BATCH_SIZE = 2;

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

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

export class SavingsActionRpcError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SavingsActionRpcError";
  }
}

export function createSavingsActionStateReader(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  timeoutMs?: number;
} = {}): SavingsActionStateReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);
  const timeoutMs = options.timeoutMs ?? SAVINGS_ACTION_RPC_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new SavingsActionRpcError("The savings RPC timeout must be 1-30000ms.");
  }

  return async function readSavingsActionState(input, externalSignal) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });

    try {
      const chain = await executeRequired(
        fetchImpl,
        rpcUrl,
        request(1, "eth_chainId", []),
        controller.signal,
      );
      if (parseQuantity(chain.result, "chain ID") !== BigInt(BASE_CHAIN_ID)) {
        throw new SavingsActionRpcError("The configured RPC is not Base mainnet.");
      }

      const latest = await executeRequired(
        fetchImpl,
        rpcUrl,
        request(2, "eth_getBlockByNumber", ["latest", false]),
        controller.signal,
      );
      const block = parseBlock(latest.result);
      const reads = createPinnedReads(input.kind, input.accountAddress, input.vaultAddress, input.amount, block.numberHex);
      const responses = (
        await Promise.all(
          chunkReads(reads, SAVINGS_ACTION_RPC_BATCH_SIZE).map((chunk) =>
            executeBatch(
              fetchImpl,
              rpcUrl,
              chunk.map(({ rpcRequest }) => rpcRequest),
              controller.signal,
            ),
          ),
        )
      ).flat();
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

async function executeRequired(
  fetchImpl: FetchLike,
  rpcUrl: string,
  rpcRequest: RpcRequest,
  signal: AbortSignal,
): Promise<RpcSuccess> {
  const value = await transport(fetchImpl, rpcUrl, rpcRequest, signal);
  const response = parseSuccess(value);
  if (!response || response.id !== rpcRequest.id) {
    throw new SavingsActionRpcError("Base RPC returned an invalid response.");
  }
  return response;
}

async function executeBatch(
  fetchImpl: FetchLike,
  rpcUrl: string,
  requests: RpcRequest[],
  signal: AbortSignal,
): Promise<RpcSuccess[]> {
  if (requests.length < 1 || requests.length > SAVINGS_ACTION_RPC_BATCH_SIZE) {
    throw new SavingsActionRpcError("The savings RPC batch size is invalid.");
  }
  const value = await transport(fetchImpl, rpcUrl, requests, signal);
  if (!Array.isArray(value) || value.length !== requests.length) {
    throw new SavingsActionRpcError("Base RPC returned an invalid batch response.");
  }
  const expectedIds = new Set(requests.map(({ id }) => id));
  const seenIds = new Set<number>();
  const responses: RpcSuccess[] = [];
  for (const entry of value) {
    const response = parseSuccess(entry);
    if (!response || !expectedIds.has(response.id) || seenIds.has(response.id)) {
      throw new SavingsActionRpcError("Base RPC returned mismatched batch responses.");
    }
    seenIds.add(response.id);
    responses.push(response);
  }
  return responses;
}

async function transport(
  fetchImpl: FetchLike,
  rpcUrl: string,
  body: RpcRequest | RpcRequest[],
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
  if (!response.ok) {
    throw new SavingsActionRpcError(`Base RPC returned HTTP ${response.status}.`);
  }
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new SavingsActionRpcError("Base RPC returned malformed JSON.", { cause: error });
  }
}

function request(id: number, method: string, params: unknown[]): RpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

function parseSuccess(value: unknown): RpcSuccess | null {
  if (!isRecord(value) || value.jsonrpc !== "2.0") return null;
  if ("error" in value) {
    throw new SavingsActionRpcError(rpcErrorMessage(value.error));
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
