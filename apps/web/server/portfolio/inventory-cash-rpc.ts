import type { PortfolioAddress } from "@/config/portfolio-assets";
import { resolveBaseRpcUrl } from "./rpc";

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const dataWordPattern = /^0x[0-9a-fA-F]{64}$/;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;

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

/** `null` means the `balanceOf` was unavailable — never invent 0. */
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
    signal: AbortSignal,
  ): Promise<OmittedCashBalanceMap> {
    const results = new Map<string, string | null>();
    if (requests.length === 0) return results;
    if (!addressPattern.test(owner)) {
      for (const request of requests) results.set(request.id, null);
      return results;
    }

    const ownerAddress = owner.toLowerCase() as PortfolioAddress;
    // Singles at `latest`: public Base `-32016`s later JSON-RPC batch items
    // after vault pin/confirm, and a pinned height can `-32001` on a lagging
    // replica. Do not invent 0 when the read still misses.
    for (const item of requests) {
      results.set(
        item.id,
        await readLatestBalanceOf(
          fetchImpl,
          rpcUrl,
          item.contractAddress,
          ownerAddress,
          signal,
        ),
      );
    }
    return results;
  };
}

async function readLatestBalanceOf(
  fetchImpl: FetchLike,
  rpcUrl: string,
  token: PortfolioAddress,
  owner: PortfolioAddress,
  signal: AbortSignal,
): Promise<string | null> {
  const request: RpcRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [
      { to: token, data: encodeBalanceOf(owner) },
      "latest",
    ],
  };
  try {
    const parsed = await transport(fetchImpl, rpcUrl, request, signal);
    const response = unwrapSuccess(parsed, request.id);
    if (!response) return null;
    const amount = tryParseDataWord(response.result);
    return amount === null ? null : amount.toString(10);
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    return null;
  }
}

async function transport(
  fetchImpl: FetchLike,
  rpcUrl: string,
  body: RpcRequest,
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

function unwrapSuccess(value: unknown, expectedId: number): RpcSuccess | null {
  const candidates = Array.isArray(value) ? value : [value];
  let found: RpcSuccess | null = null;
  for (const candidate of candidates) {
    const response = parseSuccess(candidate);
    if (!response || response.id !== expectedId) continue;
    if (found) return null;
    found = response;
  }
  return found;
}

function parseSuccess(value: unknown): RpcSuccess | null {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || "error" in value) {
    return null;
  }
  const id = parseRpcId(value.id);
  if (id === null || !("result" in value)) return null;
  return { jsonrpc: "2.0", id, result: value.result };
}

function parseRpcId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^(?:[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function tryParseDataWord(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  if (dataWordPattern.test(value)) {
    const parsed = BigInt(value);
    return parsed > UINT256_MAX ? null : parsed;
  }
  // Quantity hex such as `0x0` is a confirmed numeric result. Empty `0x` is not.
  if (quantityPattern.test(value)) {
    const parsed = BigInt(value);
    return parsed > UINT256_MAX ? null : parsed;
  }
  return null;
}

function encodeBalanceOf(address: PortfolioAddress): `0x${string}` {
  return `0x70a08231${address.slice(2).padStart(64, "0")}`;
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
