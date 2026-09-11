import {
  PORTFOLIO_BASE_CHAIN_ID,
  PORTFOLIO_USDC_ADDRESS,
  PORTFOLIO_USDC_ASSET_KEY,
  assetKeyForErc20,
  portfolioVaults,
  type PortfolioAddress,
} from "@/config/portfolio-assets";
import type { VaultPortfolioHolding } from "@/shared/portfolio/valuation-types";
import { resolveBaseRpcUrl } from "./rpc";
import type { VerifiedPortfolioAccount } from "@/shared/portfolio/types";

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const dataWordPattern = /^0x[0-9a-fA-F]{64}$/;
const VAULT_RPC_BATCH_MAX = 10;

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

export type InventoryBlock = {
  number: string;
  hash: `0x${string}`;
  timestamp: string;
};

export type VaultInventorySnapshot = {
  block: InventoryBlock;
  holdings: VaultPortfolioHolding[];
};

export class InventoryVaultRpcError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InventoryVaultRpcError";
  }
}

export function createVaultInventoryReader(options: {
  fetchImpl?: FetchLike;
  rpcUrl?: string;
} = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = resolveBaseRpcUrl(options.rpcUrl);

  return async function readVaultInventory(
    account: VerifiedPortfolioAccount,
    signal: AbortSignal,
  ): Promise<VaultInventorySnapshot> {
    if (
      account.verification !== "session-smart-account" ||
      account.chainId !== PORTFOLIO_BASE_CHAIN_ID ||
      !addressPattern.test(account.address)
    ) {
      throw new InventoryVaultRpcError(
        "Portfolio valuation requires a verified Base smart account.",
      );
    }
    const address = account.address.toLowerCase() as PortfolioAddress;

    const chain = await executeRequired(
      fetchImpl,
      rpcUrl,
      request(1, "eth_chainId", []),
      signal,
    );
    if (parseQuantity(chain.result, "chain ID") !== BigInt(PORTFOLIO_BASE_CHAIN_ID)) {
      throw new InventoryVaultRpcError("The configured RPC is not Base mainnet.");
    }
    const latest = await executeRequired(
      fetchImpl,
      rpcUrl,
      request(2, "eth_getBlockByNumber", ["latest", false]),
      signal,
    );
    const block = parseBlock(latest.result);
    const numberHex = toQuantityHex(block.number);

    let nextId = 10;
    const vaultRequests = portfolioVaults.flatMap((vault) => [
      {
        vault,
        read: "shares" as const,
        request: request(nextId++, "eth_call", [
          { to: vault.address, data: encodeBalanceOf(address) },
          numberHex,
        ]),
      },
      {
        vault,
        read: "asset" as const,
        request: request(nextId++, "eth_call", [
          { to: vault.address, data: "0x38d52e0f" },
          numberHex,
        ]),
      },
    ]);
    const firstStage = await executeOptionalBatches(
      fetchImpl,
      rpcUrl,
      vaultRequests.map(({ request: rpcRequest }) => rpcRequest),
      signal,
    );

    const vaultReadMap = new Map<string, { shares: bigint | null; asset: string | null }>();
    for (const { vault, read, request: rpcRequest } of vaultRequests) {
      const current = vaultReadMap.get(vault.id) ?? { shares: null, asset: null };
      const response = firstStage.get(rpcRequest.id);
      if (read === "shares") current.shares = response ? tryParseDataWord(response.result) : null;
      else current.asset = response ? tryParseAbiAddress(response.result) : null;
      vaultReadMap.set(vault.id, current);
    }

    const conversionRequests = portfolioVaults.flatMap((vault) => {
      const reads = vaultReadMap.get(vault.id);
      if (
        !reads ||
        reads.shares === null ||
        reads.shares === BigInt(0) ||
        reads.asset?.toLowerCase() !== PORTFOLIO_USDC_ADDRESS.toLowerCase()
      ) {
        return [];
      }
      return [
        {
          vault,
          request: request(nextId++, "eth_call", [
            { to: vault.address, data: encodeConvertToAssets(reads.shares) },
            numberHex,
          ]),
        },
      ];
    });
    const conversions = await executeOptionalBatches(
      fetchImpl,
      rpcUrl,
      conversionRequests.map(({ request: rpcRequest }) => rpcRequest),
      signal,
    );

    const holdings: VaultPortfolioHolding[] = portfolioVaults.map((vault) => {
      const reads = vaultReadMap.get(vault.id) ?? { shares: null, asset: null };
      const assetVerified = reads.asset?.toLowerCase() === PORTFOLIO_USDC_ADDRESS.toLowerCase();
      const conversionRequest = conversionRequests.find(
        (candidate) => candidate.vault.id === vault.id,
      );
      const converted =
        reads.shares === BigInt(0) && assetVerified
          ? BigInt(0)
          : conversionRequest
            ? tryParseDataWord(conversions.get(conversionRequest.request.id)?.result)
            : null;
      const ready = reads.shares !== null && assetVerified && converted !== null;
      return {
        kind: "vault-position",
        id: vault.id,
        assetKey: assetKeyForErc20(vault.address),
        name: vault.name,
        symbol: vault.symbol,
        vaultAddress: vault.address,
        decimals: vault.decimals,
        underlyingAssetKey: PORTFOLIO_USDC_ASSET_KEY,
        underlyingSymbol: "USDC",
        underlyingDecimals: 6,
        sharesBaseUnits: reads.shares?.toString(10) ?? null,
        underlyingBaseUnits: ready ? converted.toString(10) : null,
        readStatus: ready ? "ready" : "unavailable",
        conversionMethod: "erc4626-convertToAssets",
      };
    });

    const confirmation = await executeRequired(
      fetchImpl,
      rpcUrl,
      request(nextId, "eth_getBlockByNumber", [numberHex, false]),
      signal,
    );
    const confirmed = parseBlock(confirmation.result);
    if (
      confirmed.number !== block.number ||
      confirmed.hash.toLowerCase() !== block.hash.toLowerCase()
    ) {
      throw new InventoryVaultRpcError(
        "The Base source block changed while holdings were fetched.",
      );
    }

    return {
      block: {
        number: block.number,
        hash: block.hash.toLowerCase() as `0x${string}`,
        timestamp: block.timestamp,
      },
      holdings,
    };
  };
}

async function executeRequired(
  fetchImpl: FetchLike,
  rpcUrl: string,
  rpcRequest: RpcRequest,
  signal: AbortSignal,
): Promise<RpcSuccess> {
  const parsed = await transport(fetchImpl, rpcUrl, rpcRequest, signal);
  const response = parseSuccess(parsed);
  if (!response || response.id !== rpcRequest.id) {
    throw new InventoryVaultRpcError("Base RPC returned an invalid response.");
  }
  return response;
}

async function executeOptionalBatches(
  fetchImpl: FetchLike,
  rpcUrl: string,
  requests: readonly RpcRequest[],
  signal: AbortSignal,
): Promise<Map<number, RpcSuccess>> {
  const responses = new Map<number, RpcSuccess>();
  for (let index = 0; index < requests.length; index += VAULT_RPC_BATCH_MAX) {
    const batch = requests.slice(index, index + VAULT_RPC_BATCH_MAX);
    let parsed: unknown;
    try {
      parsed = await transport(fetchImpl, rpcUrl, batch, signal);
    } catch {
      if (signal.aborted) throw new InventoryVaultRpcError("Base RPC aborted.");
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const requestedIds = new Set(batch.map(({ id }) => id));
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
  return responses;
}

async function transport(
  fetchImpl: FetchLike,
  rpcUrl: string,
  body: RpcRequest | readonly RpcRequest[],
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new InventoryVaultRpcError(`Base RPC returned HTTP ${response.status}.`);
  }
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new InventoryVaultRpcError("Base RPC returned malformed JSON.", {
      cause: error,
    });
  }
}

function request(id: number, method: string, params: unknown[]): RpcRequest {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InventoryVaultRpcError("The Base RPC request ID is invalid.");
  }
  return { jsonrpc: "2.0", id, method, params };
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

function parseBlock(value: unknown): InventoryBlock {
  if (!isRecord(value)) {
    throw new InventoryVaultRpcError("Base RPC returned invalid block metadata.");
  }
  const number = parseQuantity(value.number, "block number");
  const timestamp = parseQuantity(value.timestamp, "block timestamp");
  if (typeof value.hash !== "string" || !blockHashPattern.test(value.hash)) {
    throw new InventoryVaultRpcError("Base RPC returned an invalid block hash.");
  }
  return {
    number: number.toString(10),
    hash: value.hash as `0x${string}`,
    timestamp: timestamp.toString(10),
  };
}

function parseQuantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !quantityPattern.test(value)) {
    throw new InventoryVaultRpcError(`Base RPC returned malformed ${label}.`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) {
    throw new InventoryVaultRpcError(`Base RPC returned out-of-range ${label}.`);
  }
  return parsed;
}

function tryParseDataWord(value: unknown): bigint | null {
  if (typeof value !== "string" || !dataWordPattern.test(value)) return null;
  return BigInt(value);
}

function tryParseAbiAddress(value: unknown): string | null {
  if (typeof value !== "string" || !dataWordPattern.test(value)) return null;
  const address = `0x${value.slice(-40)}`;
  return addressPattern.test(address) ? address : null;
}

function encodeBalanceOf(address: PortfolioAddress): `0x${string}` {
  return `0x70a08231${address.slice(2).padStart(64, "0")}`;
}

function encodeConvertToAssets(shares: bigint): `0x${string}` {
  return `0x07a2d13a${shares.toString(16).padStart(64, "0")}`;
}

function toQuantityHex(decimal: string): string {
  return `0x${BigInt(decimal).toString(16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
