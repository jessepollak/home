import "server-only";

import { encodeFunctionData } from "viem";
import type { PortfolioAddress } from "@/config/portfolio-assets";
import {
  BaseRpcError,
  createBaseRpcClient,
  hostedRuntimeExpectsManagedBaseRpcUrl,
  inspectBaseRpcUrl,
  parseRpcDataWord,
  parseRpcQuantity,
  resolveBaseRpcUrl,
  type BaseRpcCall,
} from "@/server/chain/rpc";
import { writeObservabilityEvent } from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";
import type { HoldingBalance } from "@/shared/balances/types";
import {
  decodeAggregate3,
  decodeBalance,
  encodeAggregate3,
  erc20Abi,
  MULTICALL3_ADDRESS,
  vaultAbi,
} from "./abi";
import type {
  BalancesRead,
  BalancesUniverse,
  ReadHolding,
  UniverseEntry,
} from "./types";

export const BALANCES_READ_DEADLINE_MS = 4_000;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const chainAssertions = new Map<string, Promise<void>>();

type Rpc = {
  request(
    method: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<unknown>;
  batch(
    calls: readonly BaseRpcCall[],
    signal?: AbortSignal,
    allowPartial?: boolean,
  ): Promise<Array<unknown | null>>;
  assertBaseChain(signal?: AbortSignal): Promise<void>;
};

type Dependencies = {
  rpc?: Rpc;
  rpcUrl?: string;
  inspectRpc?: () => ReturnType<typeof inspectBaseRpcUrl>;
  resolvedRpcUrl?: () => string;
  hosted?: () => boolean;
  log?: (event: ObservabilityEvent) => unknown;
  deadlineMs?: number;
  now?: () => Date;
};

type ReadOnceResult =
  | { changed: true; reason: "block-changed" | "confirmation-unavailable" }
  | { changed: false; read: BalancesRead };

export function createBalancesReader(dependencies: Dependencies = {}) {
  const rpc = dependencies.rpc ?? createBaseRpcClient({
    rpcUrl: dependencies.rpcUrl,
  });
  const inspectRpc = dependencies.inspectRpc ?? (
    () => inspectBaseRpcUrl(dependencies.rpcUrl)
  );
  const resolvedRpcUrl = dependencies.resolvedRpcUrl ?? (
    () => resolveBaseRpcUrl(dependencies.rpcUrl)
  );
  const hosted = dependencies.hosted ?? (
    () => hostedRuntimeExpectsManagedBaseRpcUrl()
  );
  const log = dependencies.log ?? writeObservabilityEvent;
  const deadlineMs = dependencies.deadlineMs ?? BALANCES_READ_DEADLINE_MS;
  const now = dependencies.now ?? (() => new Date());

  return async function readBalances(
    universe: BalancesUniverse,
    owner: PortfolioAddress,
    signal?: AbortSignal,
  ): Promise<BalancesRead> {
    if (!addressPattern.test(owner)) {
      throw new Error("Balances require a Base account address.");
    }

    return withDeadline(signal, deadlineMs, async (readSignal) => {
      const url = resolvedRpcUrl();
      let assertion = chainAssertions.get(url);
      if (!assertion) {
        assertion = rpc.assertBaseChain(readSignal).catch((error) => {
          chainAssertions.delete(url);
          throw error;
        });
        chainAssertions.set(url, assertion);
      }
      await assertion;

      let hostedGuardEmitted = false;
      let lastChangeReason: Extract<ReadOnceResult, { changed: true }>["reason"] = "block-changed";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const guardRegistry =
          hosted() && inspectRpc().source === "public-default";
        if (guardRegistry && !hostedGuardEmitted) {
          emitHostedGuard(log);
          hostedGuardEmitted = true;
        }

        const result = await readOnce(
          rpc,
          universe,
          owner.toLowerCase() as PortfolioAddress,
          readSignal,
          guardRegistry,
          now,
        );
        if (!result.changed) return result.read;
        lastChangeReason = result.reason;
      }

      throw new Error(
        lastChangeReason === "confirmation-unavailable"
          ? "The Base source block confirmation could not be read."
          : "The Base source block changed twice while balances were fetched.",
      );
    });
  };
}

export const readBalances = createBalancesReader();

async function readOnce(
  rpc: Rpc,
  universe: BalancesUniverse,
  owner: PortfolioAddress,
  signal: AbortSignal,
  guardRegistry: boolean,
  now: () => Date,
): Promise<ReadOnceResult> {
  const block = parseBlock(
    await rpc.request("eth_getBlockByNumber", ["latest", false], signal),
  );
  const observedAt = now().toISOString();
  const blockTag = `0x${BigInt(block.number).toString(16)}`;
  const registry = universe.entries.filter(
    (entry) => entry.source === "registry",
  );
  const native = registry.find((entry) => entry.kind === "native");
  const registryContracts = registry.filter(
    (entry) => entry.contractAddress !== null,
  );

  const [nativeValue, registryResult] = await Promise.all([
    native && !guardRegistry
      ? readNative(rpc, owner, blockTag, signal)
      : Promise.resolve<bigint | null>(null),
    guardRegistry
      ? Promise.resolve(registryContracts.map(() => null))
      : readContractChunk(
          rpc,
          registryContracts,
          owner,
          blockTag,
          signal,
        ),
  ]);
  const balances = new Map<string, HoldingBalance>();

  if (native) {
    balances.set(
      native.id,
      nativeValue === null ? unavailable() : ready(nativeValue),
    );
  }
  registryContracts.forEach((entry, index) => {
    const value = registryResult[index];
    balances.set(
      entry.id,
      value === null ? unavailable() : ready(value),
    );
  });

  const vaults = registry.filter((entry) => entry.kind === "vault-share");
  const positiveVaults = vaults.filter((entry) => {
    const balance = balances.get(entry.id);
    return (
      balance?.status === "ready" &&
      BigInt(balance.baseUnits) > BigInt(0)
    );
  });
  const conversionCalls: BaseRpcCall[] = positiveVaults.map((entry) => {
    const balance = balances.get(entry.id)!;
    return {
      method: "eth_call",
      params: [
        {
          to: entry.contractAddress,
          data: encodeFunctionData({
            abi: vaultAbi,
            functionName: "convertToAssets",
            args: [
              BigInt(balance.status === "ready" ? balance.baseUnits : "0"),
            ],
          }),
        },
        blockTag,
      ],
    };
  });
  const confirmationIndex = conversionCalls.length;
  const confirmationBatch = await readConfirmationBatch(
    rpc,
    [
      ...conversionCalls,
      {
        method: "eth_getBlockByNumber",
        params: [blockTag, false],
      },
    ],
    confirmationIndex,
    signal,
  );
  if (confirmationBatch === null) {
    return { changed: true, reason: "confirmation-unavailable" };
  }

  const confirmedBlock = parseBlock(confirmationBatch[confirmationIndex]);
  if (
    confirmedBlock.number !== block.number ||
    confirmedBlock.hash.toLowerCase() !== block.hash.toLowerCase()
  ) {
    return { changed: true, reason: "block-changed" };
  }

  const underlying = new Map<string, HoldingBalance>();
  vaults.forEach((entry) => {
    const balance = balances.get(entry.id);
    if (balance?.status !== "ready") {
      underlying.set(entry.id, unavailable());
    } else if (balance.baseUnits === "0") {
      underlying.set(entry.id, ready(BigInt(0)));
    }
  });
  positiveVaults.forEach((entry, index) => {
    const value = tryWord(confirmationBatch[index]);
    underlying.set(
      entry.id,
      value === null ? unavailable() : ready(value),
    );
  });

  const registryHoldings = registry.map((entry): ReadHolding => ({
    ...entry,
    balance: balances.get(entry.id) ?? unavailable(),
    ...(entry.kind === "vault-share"
      ? { underlyingBalance: underlying.get(entry.id) ?? unavailable() }
      : {}),
  }));
  const registryUnavailable = registryHoldings.some(
    (holding) => holding.balance.status === "unavailable",
  );

  return {
    changed: false,
    read: {
      block,
      observedAt,
      holdings: registryHoldings,
      coverage: {
        registry: registryUnavailable ? "partial" : "complete",
        catalog: "unavailable",
      },
    },
  };
}

async function readNative(
  rpc: Rpc,
  owner: PortfolioAddress,
  blockTag: string,
  signal: AbortSignal,
): Promise<bigint | null> {
  return retryRead(
    async () => parseRpcQuantity(
      await rpc.request("eth_getBalance", [owner, blockTag], signal),
      "native balance",
    ),
    signal,
  );
}

async function readContractChunk(
  rpc: Rpc,
  entries: readonly UniverseEntry[],
  owner: PortfolioAddress,
  blockTag: string,
  signal: AbortSignal,
): Promise<Array<bigint | null>> {
  if (entries.length === 0) return [];

  const result = await retryRead(async () => {
    const response = await rpc.request(
      "eth_call",
      [
        {
          to: MULTICALL3_ADDRESS,
          data: encodeAggregate3(entries.map((entry) => ({
            target: entry.contractAddress!,
            callData: encodeFunctionData({
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [owner],
            }),
          }))),
        },
        blockTag,
      ],
      signal,
    );
    const decoded = decodeAggregate3(response);
    if (decoded.length !== entries.length) {
      throw new Error("Multicall returned the wrong row count.");
    }
    return decoded.map((row) =>
      row.success ? decodeBalance(row.returnData) : null,
    );
  }, signal);

  return result ?? entries.map(() => null);
}

async function readConfirmationBatch(
  rpc: Rpc,
  calls: readonly BaseRpcCall[],
  confirmationIndex: number,
  signal: AbortSignal,
): Promise<Array<unknown | null> | null> {
  return retryRead(async () => {
    const result = await rpc.batch(calls, signal, true);
    if (result[confirmationIndex] === null) {
      throw new Error("Base RPC could not confirm the balances block.");
    }
    return result;
  }, signal);
}

async function retryRead<T>(
  read: () => Promise<T>,
  signal: AbortSignal,
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof BaseRpcError && error.code === "aborted")
    ) {
      return null;
    }
    try {
      return await read();
    } catch {
      return null;
    }
  }
}

function parseBlock(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.hash !== "string" ||
    !blockHashPattern.test(value.hash)
  ) {
    throw new Error("Base RPC returned invalid block metadata.");
  }
  return {
    number: parseRpcQuantity(value.number, "block number").toString(10),
    hash: value.hash.toLowerCase() as `0x${string}`,
    timestamp: parseRpcQuantity(value.timestamp, "block timestamp").toString(10),
  };
}

function ready(value: bigint): HoldingBalance {
  return { status: "ready", baseUnits: value.toString(10) };
}

function unavailable(): HoldingBalance {
  return { status: "unavailable", baseUnits: null };
}

function tryWord(value: unknown): bigint | null {
  try {
    return parseRpcDataWord(value, "vault conversion");
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emitHostedGuard(
  log: (event: ObservabilityEvent) => unknown,
): void {
  try {
    log({
      kind: "portfolio-balance-source",
      route: "/api/balances",
      source: "configured-base-rpc",
      stage: "inventory",
      outcome: "unavailable",
      reason: "not-configured",
    });
  } catch {
    // Observability never changes reads.
  }
}

async function withDeadline<T>(
  external: AbortSignal | undefined,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(external?.reason);
  if (external?.aborted) {
    abort();
  } else {
    external?.addEventListener("abort", abort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort("balances-read-deadline"),
    timeoutMs,
  );
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", abort);
  }
}

export function clearBalancesChainAssertionsForTests(): void {
  chainAssertions.clear();
}
