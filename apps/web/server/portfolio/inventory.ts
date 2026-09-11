import "server-only";

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
} from "@/shared/portfolio/valuation-types";
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
  type VaultInventorySnapshot,
} from "./inventory-vault-rpc";
import type { VerifiedPortfolioAccount } from "@/shared/portfolio/types";

export const PORTFOLIO_INVENTORY_TIMEOUT_MS = 10_000;
/** Fresh budget for omitted-cash `balanceOf` — not leftover from CDP + vaults. */
export const PORTFOLIO_CASH_VERIFY_TIMEOUT_MS = 4_000;
export const PORTFOLIO_CASH_VERIFY_ATTEMPTS = 2;
/** Pause before the second cash attempt so public Base `-32016` can clear. */
export const PORTFOLIO_CASH_VERIFY_RETRY_DELAY_MS = 400;

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
    signal: AbortSignal,
  ) => Promise<OmittedCashBalanceMap>;
  now?: () => Date;
  timeoutMs?: number;
  cashVerifyTimeoutMs?: number;
  cashVerifyAttempts?: number;
  cashVerifyRetryDelayMs?: number;
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
  const cashVerifyTimeoutMs =
    options.cashVerifyTimeoutMs ?? PORTFOLIO_CASH_VERIFY_TIMEOUT_MS;
  const cashVerifyAttempts =
    options.cashVerifyAttempts ?? PORTFOLIO_CASH_VERIFY_ATTEMPTS;
  const cashVerifyRetryDelayMs =
    options.cashVerifyRetryDelayMs ?? PORTFOLIO_CASH_VERIFY_RETRY_DELAY_MS;

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

    try {
      // CDP first (Coinbase HTTP, not public Base). Then omitted-cash `latest`
      // singles, then Morpho vault RPC. Overlapping cash with vault batches on
      // public Base `-32016`s the cash reads → Unavailable on true zeros
      // (tip-prod #69 after #107). Isolated singles stay ready-0. Incomplete
      // CDP still does not invent zeros.
      const directs = await withStageTimeout(
        externalSignal,
        timeoutMs,
        (signal) => readDirectHoldings(listTokenBalances, address, signal),
      );
      const verifiedDirects = await verifyOmittedCashHoldings(
        directs.holdings,
        directs.omittedCashIds,
        address,
        readOmittedCashBalances,
        {
          externalSignal,
          timeoutMs: cashVerifyTimeoutMs,
          attempts: cashVerifyAttempts,
          retryDelayMs: cashVerifyRetryDelayMs,
        },
      );
      // Vault reads get a fresh deadline even when a large CDP inventory used
      // its entire bounded scan window.
      const vaults = await withStageTimeout(
        externalSignal,
        timeoutMs,
        (signal) => readVaultInventory(account, signal),
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
        externalSignal?.aborted
          ? "The portfolio inventory request timed out or was aborted."
          : "The portfolio inventory request failed.",
        { cause: error },
      );
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
    const authoritativeMatch =
      match !== undefined &&
      (listed?.authoritativeContractAddresses === undefined ||
        listed.authoritativeContractAddresses.has(key));
    const ready = listed !== null && (authoritativeMatch || listed.complete);
    const readStatus: DirectPortfolioHolding["readStatus"] = ready
      ? "ready"
      : listed === null
        ? "unavailable"
        : "incomplete";
    // Cash omit is not a ready 0 by itself — RPC must agree (or return the
    // on-chain amount). Vault underlying is never copied into cash.
    // CDP 429/timeout (listed=null) must still verify cash; do not skip RPC.
    if (
      (listed === null || match === undefined) &&
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
      balanceBaseUnits: ready
        ? (authoritativeMatch ? match.amountBaseUnits : "0")
        : null,
      readStatus,
    };
  });
  return { holdings, omittedCashIds };
}

async function verifyOmittedCashHoldings(
  holdings: DirectPortfolioHolding[],
  omittedCashIds: ReadonlySet<string>,
  address: PortfolioAddress,
  readOmittedCashBalances: (
    requests: readonly OmittedCashBalanceRequest[],
    owner: PortfolioAddress,
    signal: AbortSignal,
  ) => Promise<OmittedCashBalanceMap>,
  options: {
    externalSignal?: AbortSignal;
    timeoutMs: number;
    attempts: number;
    retryDelayMs: number;
  },
): Promise<DirectPortfolioHolding[]> {
  const omitted = holdings.filter(
    (holding): holding is DirectPortfolioHolding & {
      contractAddress: PortfolioAddress;
    } =>
      omittedCashIds.has(holding.id) && holding.contractAddress !== null,
  );
  if (omitted.length === 0) return holdings;

  const verified = new Map<string, string | null>(
    omitted.map(({ id }) => [id, null]),
  );
  const deadline = Date.now() + options.timeoutMs;
  const maxAttempts = Math.max(1, options.attempts);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options.externalSignal?.aborted) {
      throw new PortfolioInventoryError(
        "The portfolio inventory request timed out or was aborted.",
      );
    }
    const pending = omitted.filter(({ id }) => verified.get(id) == null);
    if (pending.length === 0) break;
    if (attempt > 0 && options.retryDelayMs > 0) {
      const delayMs = Math.min(options.retryDelayMs, deadline - Date.now());
      if (delayMs <= 0) break;
      await wait(delayMs, options.externalSignal);
      if (options.externalSignal?.aborted) {
        throw new PortfolioInventoryError(
          "The portfolio inventory request timed out or was aborted.",
        );
      }
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    const abort = () => controller.abort();
    options.externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const batch = await readOmittedCashBalances(
        pending.map(({ id, contractAddress }) => ({ id, contractAddress })),
        address,
        controller.signal,
      );
      for (const { id } of pending) {
        const amount = batch.get(id);
        if (amount !== undefined && amount !== null) {
          verified.set(id, amount);
        }
      }
    } catch (error) {
      if (options.externalSignal?.aborted) throw error;
    } finally {
      clearTimeout(timeout);
      options.externalSignal?.removeEventListener("abort", abort);
    }
  }

  return holdings.map((holding) => {
    if (!omittedCashIds.has(holding.id)) return holding;
    const amount = verified.get(holding.id);
    if (amount === undefined || amount === null) {
      return {
        ...holding,
        balanceBaseUnits: null,
        // Preserve a missing-page distinction. A complete CDP omission still
        // requires RPC confirmation for cash, so an RPC miss is unavailable.
        readStatus:
          holding.readStatus === "incomplete" ? "incomplete" : "unavailable",
      };
    }
    return {
      ...holding,
      balanceBaseUnits: amount,
      readStatus: "ready",
    };
  });
}

async function withStageTimeout<T>(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort("portfolio-stage-timeout"), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!Number.isFinite(ms) || ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
