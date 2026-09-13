import { describe, expect, test } from "bun:test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
} from "viem";
import { erc20Abi, multicallAbi } from "./abi";
import {
  clearBalancesChainAssertionsForTests,
  createBalancesReader,
} from "./read";
import type { UniverseEntry } from "./types";

const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const block = {
  number: "0x10",
  hash: `0x${"1".repeat(64)}`,
  timestamp: "0x20",
};
const changedBlock = {
  ...block,
  hash: `0x${"2".repeat(64)}`,
};
const native: UniverseEntry = {
  key: "eip155:8453/native",
  kind: "native",
  source: "registry",
  id: "eth",
  name: "Ethereum",
  symbol: "ETH",
  decimals: 18,
  contractAddress: null,
  cashCurrency: null,
};

function token(address: string, id: string): UniverseEntry {
  return {
    key: `eip155:8453/erc20:${address}`,
    kind: "erc20",
    source: "registry",
    id,
    name: id,
    symbol: id.toUpperCase(),
    decimals: 18,
    contractAddress: address as `0x${string}`,
    cashCurrency: null,
  };
}

const r1 = token("0x1111111111111111111111111111111111111111", "r1");
const r2 = token("0x2222222222222222222222222222222222222222", "r2");

function aggregate(values: Array<bigint | null>): Hex {
  return encodeFunctionResult({
    abi: multicallAbi,
    functionName: "aggregate3",
    result: values.map((value) => value === null
      ? { success: false, returnData: "0x" as Hex }
      : {
          success: true,
          returnData: encodeFunctionResult({
            abi: erc20Abi,
            functionName: "balanceOf",
            result: value,
          }),
        }),
  });
}

function targets(params: readonly unknown[]): string[] {
  const decoded = decodeFunctionData({
    abi: multicallAbi,
    data: (params[0] as { data: Hex }).data,
  });
  return decoded.args[0].map(({ target }) => target.toLowerCase());
}

function readerFor(
  request: (method: string, params: readonly unknown[]) => Promise<unknown>,
  options: {
    batch?: () => Promise<Array<unknown | null>>;
    log?: (event: unknown) => void;
    hosted?: boolean;
  } = {},
) {
  clearBalancesChainAssertionsForTests();
  return createBalancesReader({
    rpc: {
      request,
      batch: options.batch ?? (async () => [block]),
      assertBaseChain: async () => {},
    },
    inspectRpc: () => ({
      source: options.hosted ? "public-default" : "configured",
      hostClass: "public-base",
      protocol: "https",
    }),
    resolvedRpcUrl: () => `https://rpc.test/${Math.random()}`,
    hosted: () => options.hosted ?? false,
    log: options.log as never,
  });
}

describe("balances chain read", () => {
  test("issues one registry-only chunk, preserves zero, and never reads catalog entries", async () => {
    const seen: string[][] = [];
    const read = readerFor(async (method, params) => {
      if (method === "eth_getBlockByNumber") return block;
      if (method === "eth_getBalance") return "0x5";
      seen.push(targets(params));
      return aggregate([BigInt(0), null]);
    });
    const catalog = {
      ...token("0x3333333333333333333333333333333333333333", "catalog:x"),
      source: "catalog" as const,
    };

    const result = await read({ entries: [native, r1, r2, catalog] }, owner);

    expect(seen).toEqual([[r1.contractAddress!, r2.contractAddress!]]);
    expect(result.holdings.some(({ id }) => id === catalog.id)).toBeFalse();
    expect(result.holdings.find(({ id }) => id === "r1")?.balance).toEqual({
      status: "ready",
      baseUnits: "0",
    });
    expect(result.holdings.find(({ id }) => id === "r2")?.balance).toEqual({
      status: "unavailable",
      baseUnits: null,
    });
    expect(result.coverage.registry).toBe("partial");
  });

  test("retries a failed registry chunk once and never coerces it to zero", async () => {
    let attempts = 0;
    const read = readerFor(async (method) => {
      if (method === "eth_getBlockByNumber") return block;
      if (method === "eth_getBalance") return "0x0";
      attempts += 1;
      throw new Error("rpc down");
    });

    const result = await read({ entries: [native, r1] }, owner);
    expect(attempts).toBe(2);
    expect(result.holdings.find(({ id }) => id === "r1")?.balance).toEqual({
      status: "unavailable",
      baseUnits: null,
    });
  });

  test("re-pins the whole read after a null confirmation slot", async () => {
    let batchAttempts = 0;
    let latestReads = 0;
    const read = readerFor(async (method) => {
      if (method === "eth_getBlockByNumber") {
        latestReads += 1;
        return block;
      }
      return "0x0";
    }, {
      batch: async () => {
        batchAttempts += 1;
        return batchAttempts <= 2 ? [null] : [block];
      },
    });

    await expect(read({ entries: [native] }, owner)).resolves.toMatchObject({
      coverage: { registry: "complete" },
    });
    expect(batchAttempts).toBe(3);
    expect(latestReads).toBe(2);
  });

  test("hosted public-default guard skips registry RPC and emits once", async () => {
    const events: unknown[] = [];
    const calls: string[] = [];
    const read = readerFor(async (method) => {
      calls.push(method);
      if (method === "eth_getBlockByNumber") return block;
      throw new Error("registry RPC must be guarded");
    }, {
      hosted: true,
      log: (event) => events.push(event),
    });

    const result = await read({ entries: [native, r1] }, owner);
    expect(calls).toEqual(["eth_getBlockByNumber"]);
    expect(result.holdings.every(({ balance }) => balance.status === "unavailable"))
      .toBeTrue();
    expect(events).toHaveLength(1);
  });

  test("retries the whole read once on a changed block then fails", async () => {
    let latest = 0;
    clearBalancesChainAssertionsForTests();
    const read = createBalancesReader({
      rpc: {
        assertBaseChain: async () => {},
        request: async (method) => {
          if (method === "eth_getBlockByNumber") {
            latest += 1;
            return block;
          }
          return "0x0";
        },
        batch: async () => [changedBlock],
      },
      inspectRpc: () => ({
        source: "configured",
        hostClass: "other",
        protocol: "https",
      }),
      resolvedRpcUrl: () => "https://reorg.test",
      hosted: () => false,
    });

    await expect(read({ entries: [native] }, owner)).rejects.toThrow(
      "changed twice",
    );
    expect(latest).toBe(2);
  });
});
