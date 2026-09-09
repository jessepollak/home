import {
  PORTFOLIO_BASE_CHAIN_ID,
  assertPortfolioRegistry,
  getDirectPortfolioAssets,
  type PortfolioAddress,
} from "@/config/portfolio-assets";
import type { FiatCurrencyCode } from "@/config/regions";
import type {
  DirectPortfolioHolding,
  PortfolioInventorySnapshot,
} from "@/server/valuation/types";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import {
  CDP_NATIVE_TOKEN_ADDRESS,
  CdpTokenBalancesError,
  createCdpTokenBalancesClient,
  type CdpTokenBalancesClient,
} from "./cdp-token-balances";
import {
  createOmittedCashBalanceReader,
  type OmittedCashBalanceMap,
  type OmittedCashBalanceRequest,
} from "./inventory-cash-rpc";
import {
  InventoryVaultRpcError,
  createVaultInventoryReader,
  type InventoryBlock,
  type VaultInventorySnapshot,
} from "./inventory-vault-rpc";
import type { VerifiedPortfolioAccount } from "./types";

export const PORTFOLIO_INVENTORY_TIMEOUT_MS = 10_000;

const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export class PortfolioInventoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PortfolioInventoryError";
  }
}

export type PortfolioInventoryReader = (
  account: VerifiedPortfolioAccount,
  quoteCurrency: FiatCurrencyCode | null,
  signal?: AbortSignal,
) => Promise<PortfolioInventorySnapshot>;

export function createPortfolioInventoryReader(options: {
  fetchImpl?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  rpcUrl?: string;
  env?: Readonly<Record<string, string | undefined>>;
  generateJwtImpl?: typeof generateJwt;
  listTokenBalances?: CdpTokenBalancesClient["listBalances"];
  readVaultInventory?: (
    account: VerifiedPortfolioAccount,
    signal: AbortSignal,
  ) => Promise<VaultInventorySnapshot>;
  readOmittedCashBalances?: (
    requests: readonly OmittedCashBalanceRequest[],
    owner: PortfolioAddress,
    block: InventoryBlock,
    signal: AbortSignal,
  ) => Promise<OmittedCashBalanceMap>;
  now?: () => Date;
  timeoutMs?: number;
} = {}): PortfolioInventoryReader {
  const listTokenBalances =
    options.listTokenBalances ??
    createCdpTokenBalancesClient({
      env: options.env,
      fetchImpl: options.fetchImpl,
      generateJwtImpl: options.generateJwtImpl,
    }).listBalances;
  const readVaultInventory =
    options.readVaultInventory ??
    createVaultInventoryReader({
      fetchImpl: options.fetchImpl,
      rpcUrl: options.rpcUrl,
    });
  const readOmittedCashBalances =
    options.readOmittedCashBalances ??
    createOmittedCashBalanceReader({
      fetchImpl: options.fetchImpl,
      rpcUrl: options.rpcUrl,
    });
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? PORTFOLIO_INVENTORY_TIMEOUT_MS;

  return async function readInventory(
    account: VerifiedPortfolioAccount,
    _quoteCurrency: FiatCurrencyCode | null,
    externalSignal?: AbortSignal,
  ): Promise<PortfolioInventorySnapshot> {
    if (
      account.verification !== "session-smart-account" ||
      account.chainId !== PORTFOLIO_BASE_CHAIN_ID ||
      !addressPattern.test(account.address)
    ) {
      throw new PortfolioInventoryError(
        "Portfolio valuation requires a verified Base smart account.",
      );
    }
    assertPortfolioRegistry();
    const address = account.address.toLowerCase() as PortfolioAddress;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });

    try {
      const [directs, vaults] = await Promise.all([
        readDirectHoldings(listTokenBalances, address, controller.signal),
        readVaultInventory(account, controller.signal),
      ]);
      const verifiedDirects = await verifyOmittedCashHoldings(
        directs.holdings,
        directs.omittedCashIds,
        address,
        vaults.block,
        controller.signal,
        readOmittedCashBalances,
      );
      const fetchedAt = now();
      if (Number.isNaN(fetchedAt.getTime())) {
        throw new PortfolioInventoryError("The portfolio fetch time is invalid.");
      }
      return {
        walletAddress: address,
        chainId: PORTFOLIO_BASE_CHAIN_ID,
        block: vaults.block,
        fetchedAt: fetchedAt.toISOString(),
        holdings: [...verifiedDirects, ...vaults.holdings],
      };
    } catch (error) {
      if (
        error instanceof PortfolioInventoryError ||
        error instanceof InventoryVaultRpcError
      ) {
        throw error;
      }
      throw new PortfolioInventoryError(
        controller.signal.aborted
          ? "The portfolio inventory request timed out or was aborted."
          : "The portfolio inventory request failed.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  };
}

export const getPortfolioInventory = createPortfolioInventoryReader();

async function readDirectHoldings(
  listTokenBalances: CdpTokenBalancesClient["listBalances"],
  address: PortfolioAddress,
  signal: AbortSignal,
): Promise<{
  holdings: DirectPortfolioHolding[];
  omittedCashIds: ReadonlySet<string>;
}> {
  const assets = getDirectPortfolioAssets();
  const needed = new Set(
    assets.map((asset) =>
      asset.kind === "native"
        ? CDP_NATIVE_TOKEN_ADDRESS
        : asset.contractAddress!.toLowerCase(),
    ),
  );

  let listed: Awaited<ReturnType<typeof listTokenBalances>> | null = null;
  try {
    listed = await listTokenBalances({
      address,
      neededContractAddresses: needed,
      signal,
    });
  } catch (error) {
    if (error instanceof CdpTokenBalancesError) {
      listed = null;
    } else {
      throw error;
    }
  }

  const byContract = new Map(
    (listed?.balances ?? []).map((balance) => [balance.contractAddress, balance] as const),
  );
  const omittedCashIds = new Set<string>();

  const holdings = assets.map((asset) => {
    const key =
      asset.kind === "native"
        ? CDP_NATIVE_TOKEN_ADDRESS
        : (asset.contractAddress!.toLowerCase() as `0x${string}`);
    const match = listed ? byContract.get(key) : undefined;
    const ready =
      listed !== null && (match !== undefined || listed.complete);
    // Cash omit is not a ready 0 by itself — RPC must agree (or return the
    // on-chain amount). Vault underlying is never copied into cash.
    if (
      listed !== null &&
      match === undefined &&
      asset.cashCurrency &&
      asset.contractAddress
    ) {
      omittedCashIds.add(asset.id);
    }
    return {
      kind: "direct" as const,
      id: asset.id,
      assetKey: asset.assetKey,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      assetKind: asset.kind,
      contractAddress: asset.contractAddress,
      cashCurrency: asset.cashCurrency,
      balanceBaseUnits: ready ? (match?.amountBaseUnits ?? "0") : null,
      readStatus: (ready ? "ready" : "unavailable") as DirectPortfolioHolding["readStatus"],
    };
  });
  return { holdings, omittedCashIds };
}

async function verifyOmittedCashHoldings(
  holdings: DirectPortfolioHolding[],
  omittedCashIds: ReadonlySet<string>,
  address: PortfolioAddress,
  block: InventoryBlock,
  signal: AbortSignal,
  readOmittedCashBalances: (
    requests: readonly OmittedCashBalanceRequest[],
    owner: PortfolioAddress,
    block: InventoryBlock,
    signal: AbortSignal,
  ) => Promise<OmittedCashBalanceMap>,
): Promise<DirectPortfolioHolding[]> {
  const omitted = holdings.filter(
    (holding): holding is DirectPortfolioHolding & {
      contractAddress: PortfolioAddress;
    } =>
      omittedCashIds.has(holding.id) && holding.contractAddress !== null,
  );
  if (omitted.length === 0) return holdings;

  let verified: OmittedCashBalanceMap;
  try {
    verified = await readOmittedCashBalances(
      omitted.map(({ id, contractAddress }) => ({ id, contractAddress })),
      address,
      block,
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw error;
    verified = new Map(omitted.map(({ id }) => [id, null]));
  }

  return holdings.map((holding) => {
    if (!omittedCashIds.has(holding.id)) return holding;
    const amount = verified.get(holding.id);
    if (amount === undefined || amount === null) {
      return {
        ...holding,
        balanceBaseUnits: null,
        readStatus: "unavailable",
      };
    }
    return {
      ...holding,
      balanceBaseUnits: amount,
      readStatus: "ready",
    };
  });
}
