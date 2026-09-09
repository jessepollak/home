import type { PortfolioAddress } from "@/config/portfolio-assets";
import { resolveBaseRpcUrl } from "./rpc";
import type { InventoryBlock } from "./inventory-vault-rpc";

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const dataWordPattern = /^0x[0-9a-fA-F]{64}$/;
const CASH_RPC_BATCH_MAX = 10;

type RpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
};
type RpcSuccess = { jsonrpc: "2.0"; id: number; result: unknown };
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type OmittedCashBalanceRequest = {
  id: string;
  contractAddress: PortfolioAddress;
};

/** `null` means the pinned-block `balanceOf` was unavailable — never invent 0. */
export type OmittedCashBalanceMap = ReadonlyMap<string, string | null>;

export function createOmittedCashBalanceReader(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
} = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);

  return async function readOmittedCashBalances(
    requests: readonly OmittedCashBalanceRequest[],
    owner: PortfolioAddress,
    block: InventoryBlock,
    signal: AbortSignal,
  ): Promise<OmittedCashBalanceMap> {
    const results = new Map<string, string | null>();
    if (requests.length === 0) return results;
    if (!addressPattern.test(owner)) {
      for (const request of requests) results.set(request.id, null);
      return results;
    }

    const numberHex = toQuantityHex(block.number);
    const rpcRequests = requests.map((item, index) => ({
      item,
      request: {
        jsonrpc: "2.0" as const,
        id: index + 1,
        method: "eth_call",
        params: [
          {
            to: item.contractAddress,
            data: encodeBalanceOf(owner.toLowerCase() as PortfolioAddress),
          },
          numberHex,
        ],
      } satisfies RpcRequest,
    }));

    const responses = new Map<number, RpcSuccess>();
    for (let index = 0; index < rpcRequests.length; index += CASH_RPC_BATCH_MAX) {
      const batch = rpcRequests.slice(index, index + CASH_RPC_BATCH_MAX);
      let parsed: unknown;
      try {
        parsed = await transport(
          fetchImpl,
          rpcUrl,
          batch.map(({ request }) => request),
          signal,
        );
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      const requestedIds = new Set(batch.map(({ request }) => request.id));
      const seen = new Set<number>();
      for (const value of parsed) {
        const response = parseSuccess(value);
        if (!response || !requestedIds.has(response.id) || seen.has(response.id)) {
          if (response) responses.delete(response.id);
          continue;
        }
        seen.add(response.id);
        responses.set(response.id, response);
      }
    }

    for (const { item, request } of rpcRequests) {
      const amount = tryParseDataWord(responses.get(request.id)?.result);
      results.set(item.id, amount === null ? null : amount.toString(10));
    }
    return results;
  };
}

async function transport(
  fetchImpl: FetchLike,
  rpcUrl: string,
  body: readonly RpcRequest[],
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Base RPC returned HTTP ${response.status}.`);
  return JSON.parse(await response.text()) as unknown;
}

function parseSuccess(value: unknown): RpcSuccess | null {
  if (
    !isRecord(value) ||
    value.jsonrpc !== "2.0" ||
    !Number.isSafeInteger(value.id) ||
    typeof value.id !== "number" ||
    !("result" in value) ||
    "error" in value
  ) {
    return null;
  }
  return value as RpcSuccess;
}

function tryParseDataWord(value: unknown): bigint | null {
  if (typeof value !== "string" || !dataWordPattern.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > UINT256_MAX ? null : parsed;
}

function encodeBalanceOf(address: PortfolioAddress): `0x${string}` {
  return `0x70a08231${address.slice(2).padStart(64, "0")}`;
}

function toQuantityHex(decimal: string): string {
  return `0x${BigInt(decimal).toString(16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
