import {
  PORTFOLIO_RPC_TIMEOUT_MS,
  resolveBaseRpcUrl,
} from "@/server/portfolio/rpc";
import type { Address, TradeBalanceReader } from "@/shared/trading/server-types";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const wordPattern = /^0x[0-9a-fA-F]{64}$/;

export class TradeBalanceReadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "TradeBalanceReadError";
  }
}

type FetchLike = typeof fetch;

export function createTradeBalanceReader({
  fetchImpl = fetch,
  rpcUrl = resolveBaseRpcUrl(),
  timeoutMs = PORTFOLIO_RPC_TIMEOUT_MS,
}: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  timeoutMs?: number;
} = {}): TradeBalanceReader {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new TradeBalanceReadError("Invalid Base RPC timeout.");
  }

  return async (address, token, signal) => {
    assertAddress(address);
    assertAddress(token);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, timeoutMs);

    try {
      const chainId = parseQuantity(
        await rpc(fetchImpl, rpcUrl, "eth_chainId", [], controller.signal),
      );
      if (chainId !== BigInt(8453)) {
        throw new TradeBalanceReadError("The configured RPC is not Base mainnet.");
      }
      const blockNumber = parseQuantity(
        await rpc(fetchImpl, rpcUrl, "eth_blockNumber", [], controller.signal),
      );
      const result = await rpc(
        fetchImpl,
        rpcUrl,
        "eth_call",
        [
          {
            to: token.toLowerCase(),
            data: encodeBalanceOf(address.toLowerCase() as Address),
          },
          `0x${blockNumber.toString(16)}`,
        ],
        controller.signal,
      );
      if (typeof result !== "string" || !wordPattern.test(result)) {
        throw new TradeBalanceReadError("Base RPC returned malformed token balance data.");
      }
      return {
        address: address.toLowerCase() as Address,
        token: token.toLowerCase() as Address,
        balance: BigInt(result),
        blockNumber,
      };
    } catch (error) {
      if (error instanceof TradeBalanceReadError) throw error;
      throw new TradeBalanceReadError("Current Base balance is unavailable.", error);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

async function rpc(
  fetchImpl: FetchLike,
  rpcUrl: string,
  method: string,
  params: unknown[],
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new TradeBalanceReadError("Base RPC request failed.");
  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !("result" in payload) ||
    "error" in payload
  ) {
    throw new TradeBalanceReadError("Base RPC returned an invalid response.");
  }
  return payload.result;
}

function parseQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !quantityPattern.test(value)) {
    throw new TradeBalanceReadError("Base RPC returned a malformed quantity.");
  }
  return BigInt(value);
}

function assertAddress(value: string): asserts value is Address {
  if (!addressPattern.test(value)) throw new TradeBalanceReadError("Invalid address.");
}

function encodeBalanceOf(address: Address): `0x${string}` {
  return `0x70a08231${address.slice(2).padStart(64, "0")}`;
}

export const getTradeBalance = createTradeBalanceReader();
