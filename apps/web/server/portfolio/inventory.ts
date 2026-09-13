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
  CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT,
  createConfiguredErc20BalanceReader,
  type ConfiguredErc20BalanceMap,
  type ConfiguredErc20BalanceRequest,
} from "./inventory-erc20-rpc";
import {
  InventoryVaultRpcError,
  createVaultInventoryReader,
  type VaultInventorySnapshot,
} from "./inventory-vault-rpc";
import type { VerifiedPortfolioAccount } from "@/shared/portfolio/types";
import { writeObservabilityEvent } from "@/server/observability/log";
import type {
  ObservabilityEvent,
  PortfolioBalanceSourceReason,
} from "@/server/observability/schema";

export const PORTFOLIO_INVENTORY_TIMEOUT_MS = 10_000;
/** Fresh budget for configured ERC-20 `balanceOf` recovery. */
export const PORTFOLIO_ERC20_RECOVERY_TIMEOUT_MS = 4_000;
export const PORTFOLIO_ERC20_RECOVERY_ATTEMPTS = 2;
export const PORTFOLIO_ERC20_RECOVERY_RETRY_DELAY_MS = 400;

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
  options?: { fresh?: boolean },
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
  readConfiguredErc20Balances?: (
    requests: readonly ConfiguredErc20BalanceRequest[],
    owner: PortfolioAddress,
    signal: AbortSignal,
  ) => Promise<ConfiguredErc20BalanceMap>;
  log?: (event: ObservabilityEvent) => unknown;
  now?: () => Date;
  timeoutMs?: number;
  erc20RecoveryTimeoutMs?: number;
  erc20RecoveryAttempts?: number;
  erc20RecoveryRetryDelayMs?: number;
} = {}): PortfolioInventoryReader {
  const env = options.env ?? process.env;
  const configuredRpcUrl = explicitlyConfiguredRpcUrl(
    options.rpcUrl,
    env.BASE_RPC_URL,
  );
  const listTokenBalances =
    options.listTokenBalances ??
    createCdpTokenBalancesClient({
      env,
      fetchImpl: options.fetchImpl,
      generateJwtImpl: options.generateJwtImpl,
    }).listBalances;
  const readVaultInventory =
    options.readVaultInventory ??
    createVaultInventoryReader({
      fetchImpl: options.fetchImpl,
      rpcUrl: configuredRpcUrl ?? undefined,
    });
  const readConfiguredErc20Balances =
    options.readConfiguredErc20Balances ??
    (configuredRpcUrl
      ? createConfiguredErc20BalanceReader({
          fetchImpl: options.fetchImpl,
          rpcUrl: configuredRpcUrl,
        })
      : null);
  const log = options.log ?? writeObservabilityEvent;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? PORTFOLIO_INVENTORY_TIMEOUT_MS;
  const erc20RecoveryTimeoutMs =
    options.erc20RecoveryTimeoutMs ?? PORTFOLIO_ERC20_RECOVERY_TIMEOUT_MS;
  const erc20RecoveryAttempts =
    options.erc20RecoveryAttempts ?? PORTFOLIO_ERC20_RECOVERY_ATTEMPTS;
  const erc20RecoveryRetryDelayMs =
    options.erc20RecoveryRetryDelayMs ?? PORTFOLIO_ERC20_RECOVERY_RETRY_DELAY_MS;

  return async function readInventory(
    account: VerifiedPortfolioAccount,
    _quoteCurrency: FiatCurrencyCode | null,
    externalSignal?: AbortSignal,
    readOptions?: { fresh?: boolean },
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
      // CDP first (Coinbase HTTP, not Base JSON-RPC). A listed quantity is
      // contract-authoritative, but a catalog-seeded ERC-20 omitted by CDP is
      // not proof of zero: recover only through the explicitly configured Base
      // RPC, as bounded latest balanceOf singles, before Morpho vault reads.
      const directs = await withStageTimeout(
        externalSignal,
        timeoutMs,
        (signal) => readDirectHoldings(
          listTokenBalances,
          address,
          signal,
          log,
          readOptions?.fresh === true,
        ),
      );
      const verifiedDirects = await recoverConfiguredErc20Holdings(
        directs.holdings,
        directs.recoveryIds,
        address,
        readConfiguredErc20Balances,
        log,
        {
          externalSignal,
          timeoutMs: erc20RecoveryTimeoutMs,
          attempts: erc20RecoveryAttempts,
          retryDelayMs: erc20RecoveryRetryDelayMs,
          hosted: env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview",
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
  log: (event: ObservabilityEvent) => unknown,
  fresh: boolean,
): Promise<{
  holdings: DirectPortfolioHolding[];
  recoveryIds: ReadonlySet<string>;
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
      fresh,
      signal,
    });
  } catch (error) {
    if (error instanceof CdpTokenBalancesError) {
      emitBalanceSourceEvent(log, "cdp-token-balances", "unavailable", error.code);
      listed = null;
    } else {
      throw error;
    }
  }
  if (listed && !listed.complete) {
    emitBalanceSourceEvent(log, "cdp-token-balances", "incomplete", "partial");
  }

  const byContract = new Map(
    (listed?.balances ?? []).map((balance) => [balance.contractAddress, balance] as const),
  );
  const recoveryIds = new Set<string>();

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
    const ready =
      listed !== null &&
      (authoritativeMatch || (asset.kind === "native" && listed.complete));
    const readStatus: DirectPortfolioHolding["readStatus"] = ready
      ? "ready"
      : listed === null
        ? "unavailable"
        : "incomplete";
    // CDP omission is not authoritative for contracts outside the provider's
    // supported inventory. Every configured ERC-20 without a fresh CDP match
    // must be recovered from the explicitly configured Base RPC.
    if (asset.kind === "erc20" && !authoritativeMatch) {
      recoveryIds.add(asset.id);
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
  return { holdings, recoveryIds };
}

async function recoverConfiguredErc20Holdings(
  holdings: DirectPortfolioHolding[],
  recoveryIds: ReadonlySet<string>,
  address: PortfolioAddress,
  readConfiguredErc20Balances: ((
    requests: readonly ConfiguredErc20BalanceRequest[],
    owner: PortfolioAddress,
    signal: AbortSignal,
  ) => Promise<ConfiguredErc20BalanceMap>) | null,
  log: (event: ObservabilityEvent) => unknown,
  options: {
    externalSignal?: AbortSignal;
    timeoutMs: number;
    attempts: number;
    retryDelayMs: number;
    hosted: boolean;
  },
): Promise<DirectPortfolioHolding[]> {
  const unresolved = holdings.filter(
    (holding): holding is DirectPortfolioHolding & {
      contractAddress: PortfolioAddress;
    } => recoveryIds.has(holding.id) && holding.contractAddress !== null,
  );
  // Cash roles consume the same bounded recovery window as Invest contracts,
  // so partition them first while preserving stable registry order in each set.
  const recovery = [
    ...unresolved.filter((holding) => holding.cashCurrency !== null),
    ...unresolved.filter((holding) => holding.cashCurrency === null),
  ];
  if (recovery.length === 0) return holdings;
  if (!readConfiguredErc20Balances) {
    if (options.hosted) {
      emitBalanceSourceEvent(
        log,
        "configured-base-rpc",
        "unavailable",
        "not-configured",
      );
    }
    return holdings;
  }

  const verified = new Map<string, string | null>(
    recovery.map(({ id }) => [id, null]),
  );
  const deadline = Date.now() + options.timeoutMs;
  const maxAttempts = Math.min(
    PORTFOLIO_ERC20_RECOVERY_ATTEMPTS,
    Number.isSafeInteger(options.attempts) && options.attempts > 0
      ? options.attempts
      : 1,
  );

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options.externalSignal?.aborted) {
      throw new PortfolioInventoryError(
        "The portfolio inventory request timed out or was aborted.",
      );
    }
    const pending = recovery.filter(({ id }) => verified.get(id) == null);
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
    const timeout = setTimeout(
      () => controller.abort(CONFIGURED_ERC20_RECOVERY_STAGE_TIMEOUT),
      remainingMs,
    );
    const abort = () => controller.abort(options.externalSignal?.reason);
    options.externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const batch = await readConfiguredErc20Balances(
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

  if ([...verified.values()].some((amount) => amount === null)) {
    emitBalanceSourceEvent(
      log,
      "configured-base-rpc",
      [...verified.values()].some((amount) => amount !== null)
        ? "incomplete"
        : "unavailable",
      "read-failed",
    );
  }

  return holdings.map((holding) => {
    if (!recoveryIds.has(holding.id)) return holding;
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

function explicitlyConfiguredRpcUrl(
  optionUrl: string | undefined,
  environmentUrl: string | undefined,
): string | null {
  const value = optionUrl?.trim() || environmentUrl?.trim();
  return value || null;
}

function emitBalanceSourceEvent(
  log: (event: ObservabilityEvent) => unknown,
  source: "cdp-token-balances" | "configured-base-rpc",
  outcome: "incomplete" | "unavailable",
  reason: PortfolioBalanceSourceReason,
): void {
  try {
    log({
      kind: "portfolio-balance-source",
      route: "/api/portfolio/valuation",
      source,
      stage: "inventory",
      outcome,
      reason,
    });
  } catch {
    // Observability must not affect balance reads.
  }
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
