import { describe, expect, test } from "bun:test";
import { encodeFunctionResult, type Hex } from "viem";
import type { RecognizedTokenCatalogEntry } from "@/server/market-data/codex/recognized-catalog";
import { createRecognizedTokenBalanceReader } from "./recognized-rpc";

const OWNER = "0x9999999999999999999999999999999999999999" as const;
const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "decimals", type: "uint8" }] },
] as const;

function entry(index: number, decimals = 18): RecognizedTokenCatalogEntry {
  return {
    address: `0x${(index + 1).toString(16).padStart(40, "0")}`,
    name: `Token ${index}`,
    symbol: `T${index}`,
    decimals,
    liquidityUsd: { atoms: "1000000", scale: 0 },
    volume24Usd: { atoms: "50000", scale: 0 },
  };
}

function balance(value: bigint): Hex {
  return encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: value });
}

function decimals(value: number): Hex {
  return encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: value });
}

describe("recognized Base token reads", () => {
  test("chunks balanceOf at 128, reads decimals only for positives, and isolates failed siblings", async () => {
    const catalog = Array.from({ length: 300 }, (_, index) => entry(index));
    const chunkSizes: number[] = [];
    const reader = createRecognizedTokenBalanceReader({
      executeMulticall: async (calls) => {
        chunkSizes.push(calls.length);
        const isBalance = calls[0]?.callData.startsWith("0x70a08231") ?? false;
        if (!isBalance) return calls.map(() => ({ success: true, returnData: decimals(18) }));
        return calls.map((call, index) => {
          if (call.target === catalog[1]?.address) return { success: false, returnData: "0x" as Hex };
          const positive = index === 0;
          return { success: true, returnData: balance(positive ? BigInt(42) : BigInt(0)) };
        });
      },
    });

    const result = await reader(catalog, OWNER, new AbortController().signal);

    expect(chunkSizes).toEqual([128, 128, 44, 3]);
    expect(result.status).toBe("incomplete");
    expect(result.holdings.map(({ address }) => address)).toEqual([
      catalog[0]?.address,
      catalog[128]?.address,
      catalog[256]?.address,
    ]);
    expect(result.holdings.every(({ balanceBaseUnits }) => balanceBaseUnits === "42")).toBe(true);
  });

  test("excludes a positive holding when onchain decimals do not match catalog metadata", async () => {
    const catalog = [entry(0, 6), entry(1, 18)];
    let stage = 0;
    const reader = createRecognizedTokenBalanceReader({
      executeMulticall: async (calls) => {
        stage += 1;
        return stage === 1
          ? calls.map(() => ({ success: true, returnData: balance(BigInt(1)) }))
          : [
              { success: true, returnData: decimals(18) },
              { success: true, returnData: decimals(18) },
            ];
      },
    });

    const result = await reader(catalog, OWNER, new AbortController().signal);

    expect(result.status).toBe("incomplete");
    expect(result.holdings.map(({ address }) => address)).toEqual([catalog[1]?.address]);
  });
});
