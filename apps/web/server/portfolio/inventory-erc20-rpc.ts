import "server-only";

import type { PortfolioAddress } from "@/config/portfolio-assets";
import {
  BaseRpcError,
  createBaseRpcClient,
  parseRpcDataWord,
  parseRpcQuantity,
} from "@/server/chain/rpc";

export const CONFIGURED_ERC20_RECOVERY_MAX_CONTRACTS = 20;
/** Internal reason used only when inventory's own bounded recovery window expires. */
export const CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT = Symbol(
  "configured-erc20-recovery-stage-timeout",
);

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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
  if (!options.rpcUrl.trim()) {
    throw new Error("Configured ERC-20 recovery requires BASE_RPC_URL.");
  }
  const rpc = createBaseRpcClient({
    fetchImpl: options.fetchImpl ?? fetch,
    rpcUrl: options.rpcUrl,
  });

  return async function readConfiguredErc20Balances(
    requests: readonly ConfiguredErc20BalanceRequest[],
    owner: PortfolioAddress,
    signal: AbortSignal,
  ): Promise<ConfiguredErc20BalanceMap> {
    const results = new Map<string, string | null>(requests.map(({ id }) => [id, null]));
    if (signal.aborted) {
      if (signal.reason === CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT) return results;
      throw abortReason(signal);
    }
    if (requests.length === 0) return results;
    if (!addressPattern.test(owner)) return results;

    const uniqueByContract = new Map<string, { contractAddress: PortfolioAddress; ids: string[] }>();
    for (const request of requests) {
      const key = request.contractAddress.toLowerCase();
      if (!addressPattern.test(request.contractAddress)) continue;
      const existing = uniqueByContract.get(key);
      if (existing) existing.ids.push(request.id);
      else uniqueByContract.set(key, { contractAddress: key as PortfolioAddress, ids: [request.id] });
    }
    if (uniqueByContract.size > CONFIGURED_ERC20_RECOVERY_MAX_CONTRACTS) {
      throw new Error("Configured ERC-20 recovery exceeded its fixed contract bound.");
    }

    const ownerAddress = owner.toLowerCase() as PortfolioAddress;
    // Singles preserve successful sibling balances when one contract fails.
    for (const { contractAddress, ids } of uniqueByContract.values()) {
      if (signal.aborted) {
        if (signal.reason === CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT) break;
        throw abortReason(signal);
      }
      let amount: string | null;
      try {
        amount = await readLatestBalanceOf(rpc, contractAddress, ownerAddress, signal);
      } catch (error) {
        if (signal.aborted && signal.reason === CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT) break;
        throw error;
      }
      for (const id of ids) results.set(id, amount);
    }
    return results;
  };
}

async function readLatestBalanceOf(
  rpc: ReturnType<typeof createBaseRpcClient>,
  token: PortfolioAddress,
  owner: PortfolioAddress,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const result = await rpc.request(
      "eth_call",
      [{ to: token, data: encodeBalanceOf(owner) }, "latest"],
      signal,
      1,
    );
    return parseBalance(result)?.toString(10) ?? null;
  } catch (error) {
    if (signal.aborted) throw abortReason(signal);
    if (error instanceof Error && error.name === "AbortError") throw error;
    return null;
  }
}

function parseBalance(value: unknown): bigint | null {
  try {
    return typeof value === "string" && value.length === 66
      ? parseRpcDataWord(value, "ERC-20 balance")
      : parseRpcQuantity(value, "ERC-20 balance");
  } catch (error) {
    if (error instanceof BaseRpcError) return null;
    throw error;
  }
}

function encodeBalanceOf(address: PortfolioAddress): `0x${string}` {
  return `0x70a08231${address.slice(2).padStart(64, "0")}`;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}
