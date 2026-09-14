import { describe, expect, test } from "bun:test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
} from "viem";
import { erc20Abi, multicallAbi, vaultAbi } from "./abi";
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
const vault: UniverseEntry = {
  ...token("0x4444444444444444444444444444444444444444", "vault"),
  kind: "vault-share",
  underlying: {
    key: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    decimals: 6,
  },
};

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
    batch?: (calls: readonly unknown[]) => Promise<Array<unknown | null>>;
    log?: (event: unknown) => void;
    hosted?: boolean;
    now?: () => Date;
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
    now: options.now,
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
    }, { now: () => new Date("2026-09-13T12:00:00.000Z") });
    const catalog = {
      ...token("0x3333333333333333333333333333333333333333", "catalog:x"),
      source: "catalog" as const,
    };

    const result = await read({ entries: [native, r1, r2, catalog] }, owner);

    expect(seen).toEqual([[r1.contractAddress!, r2.contractAddress!]]);
    expect(result.observedAt).toBe("2026-09-13T12:00:00.000Z");
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

  test("converts positive vault shares into a ready underlying balance", async () => {
    const conversionCalls: (readonly unknown[])[] = [];
    const read = readerFor(async (method) => {
      if (method === "eth_getBlockByNumber") return block;
      return aggregate([BigInt(12)]);
    }, {
      batch: async (calls) => {
        conversionCalls.push(calls);
        return [
          encodeFunctionResult({
            abi: vaultAbi,
            functionName: "convertToAssets",
            result: BigInt(34),
          }),
          block,
        ];
      },
    });

    const result = await read({ entries: [vault] }, owner);
    expect(conversionCalls).toHaveLength(1);
    const conversion = decodeFunctionData({
      abi: vaultAbi,
      data: ((conversionCalls[0]?.[0] as { params: [{ data: Hex }] }).params[0].data),
    });
    expect(conversion).toMatchObject({
      functionName: "convertToAssets",
      args: [BigInt(12)],
    });
    expect(result.holdings[0]?.balance).toEqual({ status: "ready", baseUnits: "12" });
    expect(result.holdings[0]?.underlyingBalance).toEqual({
      status: "ready",
      baseUnits: "34",
    });
  });

  test("keeps vault shares ready when conversion reverts and marks underlying unavailable", async () => {
    const read = readerFor(async (method) => {
      if (method === "eth_getBlockByNumber") return block;
      return aggregate([BigInt(12)]);
    }, {
      batch: async () => [null, block],
    });

    const result = await read({ entries: [vault] }, owner);
    expect(result.holdings[0]?.balance).toEqual({ status: "ready", baseUnits: "12" });
    expect(result.holdings[0]?.underlyingBalance).toEqual({
      status: "unavailable",
      baseUnits: null,
    });
  });

  test("returns zero underlying for zero vault shares without a conversion call", async () => {
    const batches: (readonly unknown[])[] = [];
    const read = readerFor(async (method) => {
      if (method === "eth_getBlockByNumber") return block;
      return aggregate([BigInt(0)]);
    }, {
      batch: async (calls) => {
        batches.push(calls);
        return [block];
      },
    });

    const result = await read({ entries: [vault] }, owner);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(result.holdings[0]?.underlyingBalance).toEqual({
      status: "ready",
      baseUnits: "0",
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

  test("hosted guard emits exactly once across a whole-read re-pin", async () => {
    const events: unknown[] = [];
    const calls: string[] = [];
    let batches = 0;
    const read = readerFor(async (method) => {
      calls.push(method);
      if (method === "eth_getBlockByNumber") return block;
      throw new Error("registry RPC must be guarded");
    }, {
      hosted: true,
      log: (event) => events.push(event),
      batch: async () => {
        batches += 1;
        return [batches === 1 ? changedBlock : block];
      },
    });

    const result = await read({ entries: [native, r1] }, owner);
    expect(calls).toEqual(["eth_getBlockByNumber", "eth_getBlockByNumber"]);
    expect(result.holdings.every(({ balance }) => balance.status === "unavailable"))
      .toBeTrue();
    expect(events).toHaveLength(1);
  });

  test("reports an unreadable confirmation after the re-pin also cannot confirm", async () => {
    const read = readerFor(async (method) => {
      if (method === "eth_getBlockByNumber") return block;
      return "0x0";
    }, {
      batch: async () => [null],
    });

    await expect(read({ entries: [native] }, owner)).rejects.toThrow(
      "confirmation could not be read",
    );
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
