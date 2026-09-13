import "server-only";

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
import { decodeAggregate3, decodeBalance, encodeAggregate3, erc20Abi, MULTICALL3_ADDRESS, vaultAbi } from "./abi";
import type { BalancesRead, BalancesUniverse, ReadHolding, UniverseEntry } from "./types";
import { encodeFunctionData } from "viem";

export const BALANCES_READ_DEADLINE_MS = 4_000;
export const BALANCES_CHUNK_SIZE = 128;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const chainAssertions = new Map<string, Promise<void>>();

type Rpc = {
  request(method: string, params: readonly unknown[], signal?: AbortSignal): Promise<unknown>;
  batch(calls: readonly BaseRpcCall[], signal?: AbortSignal, allowPartial?: boolean): Promise<Array<unknown | null>>;
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
};

export function createBalancesReader(dependencies: Dependencies = {}) {
  const rpc = dependencies.rpc ?? createBaseRpcClient({ rpcUrl: dependencies.rpcUrl });
  const inspectRpc = dependencies.inspectRpc ?? (() => inspectBaseRpcUrl(dependencies.rpcUrl));
  const resolvedRpcUrl = dependencies.resolvedRpcUrl ?? (() => resolveBaseRpcUrl(dependencies.rpcUrl));
  const hosted = dependencies.hosted ?? (() => hostedRuntimeExpectsManagedBaseRpcUrl());
  const log = dependencies.log ?? writeObservabilityEvent;
  const deadlineMs = dependencies.deadlineMs ?? BALANCES_READ_DEADLINE_MS;

  return async function readBalances(universe: BalancesUniverse, owner: PortfolioAddress, signal?: AbortSignal): Promise<BalancesRead> {
    if (!addressPattern.test(owner)) throw new Error("Balances require a Base account address.");
    return withDeadline(signal, deadlineMs, async (readSignal) => {
      const url = resolvedRpcUrl();
      let assertion = chainAssertions.get(url);
      if (!assertion) {
        assertion = rpc.assertBaseChain(readSignal).catch((error) => { chainAssertions.delete(url); throw error; });
        chainAssertions.set(url, assertion);
      }
      await assertion;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await readOnce(rpc, universe, owner.toLowerCase() as PortfolioAddress, readSignal, {
          guardRegistry: hosted() && inspectRpc().source === "public-default",
          sequentialCatalog: inspectRpc().hostClass === "public-base",
          log,
        });
        if (!result.changed) return result.read;
      }
      throw new Error("The Base source block changed twice while balances were fetched.");
    });
  };
}

export const readBalances = createBalancesReader();

async function readOnce(
  rpc: Rpc,
  universe: BalancesUniverse,
  owner: PortfolioAddress,
  signal: AbortSignal,
  options: { guardRegistry: boolean; sequentialCatalog: boolean; log: (event: ObservabilityEvent) => unknown },
): Promise<{ changed: boolean; read: BalancesRead }> {
  const block = parseBlock(await rpc.request("eth_getBlockByNumber", ["latest", false], signal));
  const blockTag = `0x${BigInt(block.number).toString(16)}`;
  const registry = universe.entries.filter((entry) => entry.source === "registry");
  const catalog = universe.entries.filter((entry) => entry.source === "catalog");
  const native = registry.find((entry) => entry.kind === "native");
  const registryContracts = registry.filter((entry) => entry.contractAddress !== null);
  const catalogChunks = chunk(catalog, BALANCES_CHUNK_SIZE);

  if (options.guardRegistry) emitHostedGuard(options.log);
  const nativePromise = native && !options.guardRegistry
    ? readNative(rpc, owner, blockTag, signal)
    : Promise.resolve<bigint | null>(null);
  const registryPromise = options.guardRegistry
    ? Promise.resolve({ values: registryContracts.map(() => null), failed: true })
    : readContractChunk(rpc, registryContracts, owner, blockTag, signal);
  const catalogResults: Array<{ values: Array<bigint | null>; failed: boolean }> = [];
  if (options.sequentialCatalog) {
    for (const entries of catalogChunks) catalogResults.push(await readContractChunk(rpc, entries, owner, blockTag, signal));
  } else {
    catalogResults.push(...await Promise.all(catalogChunks.map((entries) => readContractChunk(rpc, entries, owner, blockTag, signal))));
  }
  const [nativeValue, registryResult] = await Promise.all([nativePromise, registryPromise]);

  const balances = new Map<string, HoldingBalance>();
  if (native) balances.set(native.id, nativeValue === null ? unavailable() : ready(nativeValue));
  registryContracts.forEach((entry, index) => {
    const value = registryResult.values[index];
    balances.set(entry.id, value === null ? unavailable() : ready(value));
  });
  const catalogPositive: ReadHolding[] = [];
  let catalogReadIncomplete = false;
  catalogChunks.forEach((entries, chunkIndex) => {
    const result = catalogResults[chunkIndex]!;
    if (result.failed || result.values.some((value) => value === null)) catalogReadIncomplete = true;
    entries.forEach((entry, index) => {
      const value = result.values[index];
      if (value !== null && value > BigInt(0)) catalogPositive.push({ ...entry, balance: ready(value) });
    });
  });

  const vaults = registry.filter((entry) => entry.kind === "vault-share");
  const positiveVaults = vaults.filter((entry) => {
    const balance = balances.get(entry.id);
    return balance?.status === "ready" && BigInt(balance.baseUnits) > BigInt(0);
  });
  const conversionCalls: BaseRpcCall[] = positiveVaults.map((entry) => {
    const balance = balances.get(entry.id)!;
    return {
      method: "eth_call",
      params: [{ to: entry.contractAddress, data: encodeFunctionData({ abi: vaultAbi, functionName: "convertToAssets", args: [BigInt(balance.status === "ready" ? balance.baseUnits : "0")] }) }, blockTag],
    };
  });
  const confirmationIndex = conversionCalls.length;
  const confirmationBatch = await rpc.batch([
    ...conversionCalls,
    { method: "eth_getBlockByNumber", params: [blockTag, false] },
  ], signal, true);
  const confirmed = confirmationBatch[confirmationIndex];
  if (confirmed === null) throw new Error("Base RPC could not confirm the balances block.");
  const confirmedBlock = parseBlock(confirmed);
  const changed = confirmedBlock.number !== block.number || confirmedBlock.hash.toLowerCase() !== block.hash.toLowerCase();

  const underlying = new Map<string, HoldingBalance>();
  vaults.forEach((entry) => {
    const balance = balances.get(entry.id);
    if (balance?.status !== "ready") underlying.set(entry.id, unavailable());
    else if (balance.baseUnits === "0") underlying.set(entry.id, ready(BigInt(0)));
  });
  positiveVaults.forEach((entry, index) => {
    const value = tryWord(confirmationBatch[index]);
    underlying.set(entry.id, value === null ? unavailable() : ready(value));
  });

  const registryHoldings = registry.map((entry): ReadHolding => ({
    ...entry,
    balance: balances.get(entry.id) ?? unavailable(),
    ...(entry.kind === "vault-share" ? { underlyingBalance: underlying.get(entry.id) ?? unavailable() } : {}),
  }));
  const registryUnavailable = registryHoldings.some((holding) => holding.balance.status === "unavailable");
  const catalogStatus = universe.catalogStatus === "unavailable"
    ? "unavailable"
    : universe.catalogStatus === "incomplete" || catalogReadIncomplete
      ? "incomplete"
      : "complete";
  return {
    changed,
    read: {
      block,
      holdings: [...registryHoldings, ...catalogPositive],
      coverage: { registry: registryUnavailable ? "partial" : "complete", catalog: catalogStatus },
    },
  };
}

async function readNative(rpc: Rpc, owner: PortfolioAddress, blockTag: string, signal: AbortSignal): Promise<bigint | null> {
  return retryRead(async () => parseRpcQuantity(await rpc.request("eth_getBalance", [owner, blockTag], signal), "native balance"), signal);
}

async function readContractChunk(rpc: Rpc, entries: readonly UniverseEntry[], owner: PortfolioAddress, blockTag: string, signal: AbortSignal) {
  if (entries.length === 0) return { values: [] as Array<bigint | null>, failed: false };
  const result = await retryRead(async () => {
    const response = await rpc.request("eth_call", [{ to: MULTICALL3_ADDRESS, data: encodeAggregate3(entries.map((entry) => ({
      target: entry.contractAddress!,
      callData: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    }))) }, blockTag], signal);
    const decoded = decodeAggregate3(response);
    if (decoded.length !== entries.length) throw new Error("Multicall returned the wrong row count.");
    return decoded.map((row) => row.success ? decodeBalance(row.returnData) : null);
  }, signal);
  return result === null ? { values: entries.map(() => null), failed: true } : { values: result, failed: false };
}

async function retryRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T | null> {
  try { return await read(); }
  catch (error) {
    if (signal.aborted || (error instanceof BaseRpcError && error.code === "aborted")) return null;
    try { return await read(); }
    catch { return null; }
  }
}

function parseBlock(value: unknown) {
  if (!isRecord(value) || typeof value.hash !== "string" || !blockHashPattern.test(value.hash)) throw new Error("Base RPC returned invalid block metadata.");
  return {
    number: parseRpcQuantity(value.number, "block number").toString(10),
    hash: value.hash.toLowerCase() as `0x${string}`,
    timestamp: parseRpcQuantity(value.timestamp, "block timestamp").toString(10),
  };
}

function ready(value: bigint): HoldingBalance { return { status: "ready", baseUnits: value.toString(10) }; }
function unavailable(): HoldingBalance { return { status: "unavailable", baseUnits: null }; }
function tryWord(value: unknown): bigint | null { try { return parseRpcDataWord(value, "vault conversion"); } catch { return null; } }
function chunk<T>(values: readonly T[], size: number): T[][] { const out: T[][] = []; for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size)); return out; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function emitHostedGuard(log: (event: ObservabilityEvent) => unknown): void {
  try { log({ kind: "portfolio-balance-source", route: "/api/balances", source: "configured-base-rpc", stage: "inventory", outcome: "unavailable", reason: "not-configured" }); } catch { /* observability never changes reads */ }
}

async function withDeadline<T>(external: AbortSignal | undefined, timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(external?.reason);
  if (external?.aborted) abort(); else external?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort("balances-read-deadline"), timeoutMs);
  try { return await run(controller.signal); }
  finally { clearTimeout(timer); external?.removeEventListener("abort", abort); }
}

export function clearBalancesChainAssertionsForTests(): void { chainAssertions.clear(); }
