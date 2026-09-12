import {
  PORTFOLIO_BASE_CHAIN_ID,
  PORTFOLIO_USDC_ADDRESS,
  PORTFOLIO_USDC_ASSET_KEY,
  assetKeyForErc20,
  portfolioVaults,
  type PortfolioAddress,
} from "@/config/portfolio-assets";
import { createBaseRpcClient, parseRpcDataWord, parseRpcQuantity } from "@/server/chain/rpc";
import type { VaultPortfolioHolding } from "@/shared/portfolio/valuation-types";
import type { VerifiedPortfolioAccount } from "@/shared/portfolio/types";
import type { Address, MorphoVaultPosition } from "@/shared/savings/types";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const dataWordPattern = /^0x[0-9a-fA-F]{64}$/;
const VAULT_RPC_BATCH_MAX = 10;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type InventoryBlock = { number: string; hash: `0x${string}`; timestamp: string };
export type VaultInventorySnapshot = { block: InventoryBlock; holdings: VaultPortfolioHolding[] };

export class InventoryVaultRpcError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InventoryVaultRpcError";
  }
}

export function createVaultInventoryReader(options: { fetchImpl?: FetchLike; rpcUrl?: string } = {}) {
  const rpc = createBaseRpcClient({ fetchImpl: options.fetchImpl ?? fetch, rpcUrl: options.rpcUrl });

  return async function readVaultInventory(
    account: VerifiedPortfolioAccount,
    signal: AbortSignal,
  ): Promise<VaultInventorySnapshot> {
    assertAccount(account);
    try {
      await rpc.assertBaseChain(signal);
      const block = parseBlock(await rpc.request("eth_getBlockByNumber", ["latest", false], signal));
      const numberHex = `0x${BigInt(block.number).toString(16)}`;
      const address = account.address.toLowerCase() as PortfolioAddress;
      const initialCalls = portfolioVaults.flatMap((vault) => [
        { method: "eth_call", params: [{ to: vault.address, data: encodeBalanceOf(address) }, numberHex] },
        { method: "eth_call", params: [{ to: vault.address, data: "0x38d52e0f" }, numberHex] },
      ]);
      const initial = await optionalBatches(rpc, initialCalls, signal);
      const reads = portfolioVaults.map((vault, index) => ({
        vault,
        shares: tryWord(initial[index * 2]),
        asset: tryAddress(initial[index * 2 + 1]),
      }));
      const conversionEntries = reads.filter(({ shares, asset }) =>
        shares !== null && shares > BigInt(0) && asset?.toLowerCase() === PORTFOLIO_USDC_ADDRESS.toLowerCase(),
      );
      const conversions = await optionalBatches(
        rpc,
        conversionEntries.map(({ vault, shares }) => ({
          method: "eth_call",
          params: [{ to: vault.address, data: encodeConvertToAssets(shares!) }, numberHex],
        })),
        signal,
      );
      const convertedById = new Map(conversionEntries.map(({ vault }, index) => [vault.id, tryWord(conversions[index])]));
      const holdings = reads.map(({ vault, shares, asset }): VaultPortfolioHolding => {
        const assetVerified = asset?.toLowerCase() === PORTFOLIO_USDC_ADDRESS.toLowerCase();
        const converted = shares === BigInt(0) && assetVerified ? BigInt(0) : convertedById.get(vault.id) ?? null;
        const ready = shares !== null && assetVerified && converted !== null;
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
          sharesBaseUnits: shares?.toString(10) ?? null,
          underlyingBaseUnits: ready ? converted.toString(10) : null,
          readStatus: ready ? "ready" : "vault-failure",
          conversionMethod: "erc4626-convertToAssets",
        };
      });
      const confirmed = parseBlock(await rpc.request("eth_getBlockByNumber", [numberHex, false], signal));
      if (confirmed.number !== block.number || confirmed.hash.toLowerCase() !== block.hash.toLowerCase()) {
        throw new InventoryVaultRpcError("The Base source block changed while holdings were fetched.");
      }
      return { block, holdings };
    } catch (error) {
      if (error instanceof InventoryVaultRpcError) throw error;
      throw new InventoryVaultRpcError("Base RPC returned an invalid response.", { cause: error });
    }
  };
}

export function createVaultPositionsReader(options: { fetchImpl?: FetchLike; rpcUrl?: string; now?: () => Date } = {}) {
  const readInventory = createVaultInventoryReader(options);
  const now = options.now ?? (() => new Date());
  return async function readVaultPositions(account: Address, signal?: AbortSignal) {
    const snapshot = await readInventory(
      { address: account, chainId: PORTFOLIO_BASE_CHAIN_ID, verification: "session-smart-account" },
      signal ?? new AbortController().signal,
    );
    const fetchedAt = now().toISOString();
    // With RPC there is no "no position": zero shares is a `ready` read of "0". Any
    // failed vault read must surface as unavailable, never as a zero balance.
    const failed = snapshot.holdings.filter((holding) =>
      holding.readStatus !== "ready" || holding.sharesBaseUnits === null || holding.underlyingBaseUnits === null,
    );
    if (failed.length > 0) {
      throw new InventoryVaultRpcError(
        `Base RPC could not read ${failed.length} vault position(s) at the pinned block.`,
      );
    }
    return {
      accountAddress: account,
      fetchedAt,
      vaults: snapshot.holdings.map((holding) => ({
        vaultAddress: holding.vaultAddress as Address,
        position: holding.sharesBaseUnits === null || holding.underlyingBaseUnits === null
          ? null
          : {
              version: "v1",
              accountAddress: account,
              vaultAddress: holding.vaultAddress as Address,
              assetsRaw: holding.underlyingBaseUnits,
              sharesRaw: holding.sharesBaseUnits,
              indexedAt: new Date(Number(BigInt(snapshot.block.timestamp)) * 1_000).toISOString(),
              source: { provider: "Base JSON-RPC", blockNumber: snapshot.block.number, fetchedAt },
              withdrawableRaw: null,
              withdrawableNote: "Current assets are derived from ERC-4626 convertToAssets at the pinned Base block.",
            } satisfies MorphoVaultPosition,
      })),
    };
  };
}

async function optionalBatches(
  rpc: ReturnType<typeof createBaseRpcClient>,
  calls: Array<{ method: string; params: readonly unknown[] }>,
  signal: AbortSignal,
): Promise<Array<unknown | null>> {
  const output: Array<unknown | null> = [];
  for (let index = 0; index < calls.length; index += VAULT_RPC_BATCH_MAX) {
    try { output.push(...await rpc.batch(calls.slice(index, index + VAULT_RPC_BATCH_MAX), signal, true)); }
    catch { if (signal.aborted) throw new InventoryVaultRpcError("Base RPC aborted."); output.push(...calls.slice(index, index + VAULT_RPC_BATCH_MAX).map(() => null)); }
  }
  return output;
}

function assertAccount(account: VerifiedPortfolioAccount): void {
  if (account.verification !== "session-smart-account" || account.chainId !== PORTFOLIO_BASE_CHAIN_ID || !addressPattern.test(account.address)) {
    throw new InventoryVaultRpcError("Portfolio valuation requires a verified Base smart account.");
  }
}

function parseBlock(value: unknown): InventoryBlock {
  if (!isRecord(value) || typeof value.hash !== "string" || !blockHashPattern.test(value.hash)) {
    throw new InventoryVaultRpcError("Base RPC returned invalid block metadata.");
  }
  return {
    number: parseRpcQuantity(value.number, "block number").toString(10),
    hash: value.hash.toLowerCase() as `0x${string}`,
    timestamp: parseRpcQuantity(value.timestamp, "block timestamp").toString(10),
  };
}
function tryWord(value: unknown): bigint | null { try { return parseRpcDataWord(value, "vault result"); } catch { return null; } }
function tryAddress(value: unknown): string | null {
  if (typeof value !== "string" || !dataWordPattern.test(value)) return null;
  const address = `0x${value.slice(-40)}`;
  return addressPattern.test(address) ? address : null;
}
function encodeBalanceOf(address: PortfolioAddress): `0x${string}` { return `0x70a08231${address.slice(2).padStart(64, "0")}`; }
function encodeConvertToAssets(shares: bigint): `0x${string}` { return `0x07a2d13a${shares.toString(16).padStart(64, "0")}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
