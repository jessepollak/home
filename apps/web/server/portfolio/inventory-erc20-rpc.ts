import type { PortfolioAddress } from "@/config/portfolio-assets";
import { resolveBaseRpcUrl } from "./rpc";

export const CONFIGURED_ERC20_RECOVERY_MAX_CONTRACTS = 20;
/** Internal reason used only when inventory's own bounded recovery window expires. */
export const CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT = Symbol(
  "configured-erc20-recovery-stage-timeout",
);

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

export type ConfiguredErc20BalanceRequest = {
  id: string;
  contractAddress: PortfolioAddress;
};

/** `null` means the authoritative `balanceOf` was unavailable — never invent 0. */
export type ConfiguredErc20BalanceMap = ReadonlyMap<string, string | null>;

export function createConfiguredErc20BalanceReader(options: {
  fetchImpl?: FetchLike;
  /** Must be explicitly configured by the caller; the public default is not recovery. */
  rpcUrl: string;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!options.rpcUrl.trim()) {
    throw new Error("Configured ERC-20 recovery requires BASE_RPC_URL.");
  }
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);

  return async function readConfiguredErc20Balances(
    requests: readonly ConfiguredErc20BalanceRequest[],
    owner: PortfolioAddress,
    signal: AbortSignal,
  ): Promise<ConfiguredErc20BalanceMap> {
    const results = new Map<string, string | null>(
      requests.map(({ id }) => [id, null]),
    );
    if (signal.aborted) {
      if (signal.reason === CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT) {
        return results;
      }
      throw abortReason(signal);
    }
    if (requests.length === 0) return results;
    if (!addressPattern.test(owner)) {
      for (const request of requests) results.set(request.id, null);
      return results;
    }

    const uniqueByContract = new Map<
      string,
      { contractAddress: PortfolioAddress; ids: string[] }
    >();
    for (const request of requests) {
      const key = request.contractAddress.toLowerCase();
      if (!addressPattern.test(request.contractAddress)) {
        results.set(request.id, null);
        continue;
      }
      const existing = uniqueByContract.get(key);
      if (existing) existing.ids.push(request.id);
      else {
        uniqueByContract.set(key, {
          contractAddress: key as PortfolioAddress,
          ids: [request.id],
        });
      }
    }
    if (uniqueByContract.size > CONFIGURED_ERC20_RECOVERY_MAX_CONTRACTS) {
      throw new Error("Configured ERC-20 recovery exceeded its fixed contract bound.");
    }

    const ownerAddress = owner.toLowerCase() as PortfolioAddress;
    // Keep calls as bounded singles so one provider/RPC error cannot discard
    // successful sibling balances. The caller owns the shared deadline.
    for (const { contractAddress, ids } of uniqueByContract.values()) {
      if (signal.aborted) {
        if (signal.reason === CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT) break;
        throw abortReason(signal);
      }
      let amount: string | null;
      try {
        amount = await readLatestBalanceOf(
          fetchImpl,
          rpcUrl,
          contractAddress,
          ownerAddress,
          signal,
        );
      } catch (error) {
        if (
          signal.aborted &&
          signal.reason === CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT
        ) {
          break;
        }
        throw error;
      }
      for (const id of ids) results.set(id, amount);
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
    params: [{ to: token, data: encodeBalanceOf(owner) }, "latest"],
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
  if (dataWordPattern.test(value) || quantityPattern.test(value)) {
    const parsed = BigInt(value);
    return parsed > UINT256_MAX ? null : parsed;
  }
  return null;
}

function encodeBalanceOf(address: PortfolioAddress): `0x${string}` {
  return `0x70a08231${address.slice(2).padStart(64, "0")}`;
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
