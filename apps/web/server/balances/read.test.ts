import { describe, expect, test } from "bun:test";
import { decodeFunctionData, encodeFunctionResult, type Hex } from "viem";
import { erc20Abi, multicallAbi } from "./abi";
import { clearBalancesChainAssertionsForTests, createBalancesReader } from "./read";
import type { UniverseEntry } from "./types";

const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const block = { number: "0x10", hash: `0x${"1".repeat(64)}`, timestamp: "0x20" };
const changedBlock = { ...block, hash: `0x${"2".repeat(64)}` };
const native: UniverseEntry = { key: "eip155:8453/native", kind: "native", source: "registry", id: "eth", name: "Ethereum", symbol: "ETH", decimals: 18, contractAddress: null, cashCurrency: null };
function token(address: string, id: string, source: "registry" | "catalog"): UniverseEntry {
  return { key: `eip155:8453/erc20:${address}`, kind: "erc20", source, id, name: id, symbol: id.toUpperCase(), decimals: 18, contractAddress: address as `0x${string}`, cashCurrency: null,
    ...(source === "catalog" ? { liquidityUsd: { atoms: "100000", scale: 0 }, volume24Usd: { atoms: "10000", scale: 0 } } : {}) };
}
const r1 = token("0x1111111111111111111111111111111111111111", "r1", "registry");
const r2 = token("0x2222222222222222222222222222222222222222", "r2", "registry");
const c1 = token("0x3333333333333333333333333333333333333333", "catalog:c1", "catalog");

function aggregate(values: Array<bigint | null>): Hex {
  return encodeFunctionResult({ abi: multicallAbi, functionName: "aggregate3", result: values.map((value) => value === null
    ? { success: false, returnData: "0x" as Hex }
    : { success: true, returnData: encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: value }) }) });
}
function targets(params: readonly unknown[]): string[] {
  const call = (params[0] as { data: Hex }).data;
  const decoded = decodeFunctionData({ abi: multicallAbi, data: call });
  return decoded.args[0].map(({ target }) => target.toLowerCase());
}

function readerFor(request: (method: string, params: readonly unknown[]) => Promise<unknown>, batchBlock: unknown = block, log?: (event: unknown) => void, hosted = false) {
  clearBalancesChainAssertionsForTests();
  return createBalancesReader({
    rpc: { request, batch: async () => [batchBlock], assertBaseChain: async () => {} },
    inspectRpc: () => ({ source: hosted ? "public-default" : "configured", hostClass: "public-base", protocol: "https" }),
    resolvedRpcUrl: () => `https://rpc.test/${Math.random()}`,
    hosted: () => hosted,
    log: log as never,
  });
}

describe("balances chain read", () => {
  test("isolates registry, preserves zero, and omits unavailable catalog rows", async () => {
    const seen: string[][] = [];
    const read = readerFor(async (method, params) => {
      if (method === "eth_getBlockByNumber") return block;
      if (method === "eth_getBalance") return "0x5";
      const chunkTargets = targets(params);
      seen.push(chunkTargets);
      return chunkTargets[0] === r1.contractAddress ? aggregate([BigInt(0), null]) : aggregate([BigInt(7)]);
    });
    const result = await read({ entries: [native, r1, r2, c1], catalogStatus: "complete" }, owner);
    expect(seen).toEqual([[r1.contractAddress!, r2.contractAddress!], [c1.contractAddress!]]);
    expect(result.holdings.find(({ id }) => id === "r1")?.balance).toEqual({ status: "ready", baseUnits: "0" });
    expect(result.holdings.find(({ id }) => id === "r2")?.balance).toEqual({ status: "unavailable", baseUnits: null });
    expect(result.holdings.find(({ id }) => id === c1.id)?.balance).toEqual({ status: "ready", baseUnits: "7" });
    expect(result.coverage).toEqual({ registry: "partial", catalog: "complete" });
  });

  test("retries a failed chunk once and never coerces it to zero", async () => {
    let attempts = 0;
    const read = readerFor(async (method) => {
      if (method === "eth_getBlockByNumber") return block;
      if (method === "eth_getBalance") return "0x0";
      attempts += 1;
      throw new Error("rpc down");
    });
    const result = await read({ entries: [native, r1], catalogStatus: "unavailable" }, owner);
    expect(attempts).toBe(2);
    expect(result.holdings.find(({ id }) => id === "r1")?.balance).toEqual({ status: "unavailable", baseUnits: null });
  });

  test("hosted public-default guard skips registry calls and emits once", async () => {
    const events: unknown[] = [];
    const calledTargets: string[][] = [];
    const read = readerFor(async (method, params) => {
      if (method === "eth_getBlockByNumber") return block;
      if (method === "eth_getBalance") throw new Error("must not call native");
      calledTargets.push(targets(params));
      return aggregate([BigInt(3)]);
    }, block, (event) => events.push(event), true);
    const result = await read({ entries: [native, r1, c1], catalogStatus: "complete" }, owner);
    expect(calledTargets).toEqual([[c1.contractAddress!]]);
    expect(result.holdings.find(({ id }) => id === "r1")?.balance.status).toBe("unavailable");
    expect(events).toHaveLength(1);
  });

  test("retries the whole read once on a changed block then fails", async () => {
    let latest = 0;
    clearBalancesChainAssertionsForTests();
    const read = createBalancesReader({
      rpc: {
        assertBaseChain: async () => {},
        request: async (method) => method === "eth_getBlockByNumber" ? (latest += 1, block) : "0x0",
        batch: async () => [changedBlock],
      },
      inspectRpc: () => ({ source: "configured", hostClass: "other", protocol: "https" }),
      resolvedRpcUrl: () => "https://reorg.test",
      hosted: () => false,
    });
    await expect(read({ entries: [native], catalogStatus: "unavailable" }, owner)).rejects.toThrow("changed twice");
    expect(latest).toBe(2);
  });
});
