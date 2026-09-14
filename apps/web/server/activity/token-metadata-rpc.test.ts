import { describe, expect, test } from "bun:test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
} from "viem";
import { multicallAbi } from "@/server/balances/abi";
import {
  ACTIVITY_TOKEN_RPC_BATCH_MAX,
  ACTIVITY_TOKEN_RPC_TIMEOUT_MS,
  createActivityTokenRpcResolver,
  decodeActivityTokenMetadataMulticall,
} from "./token-metadata-rpc";

const decimalsAbi = [{
  type: "function",
  name: "decimals",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint256" }],
}] as const;
const symbolStringAbi = [{
  type: "function",
  name: "symbol",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "string" }],
}] as const;
const symbolBytes32Abi = [{
  type: "function",
  name: "symbol",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "bytes32" }],
}] as const;
const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;
const C = "0x3333333333333333333333333333333333333333" as const;

function aggregate(results: Array<{ success: boolean; returnData: Hex }>): Hex {
  return encodeFunctionResult({
    abi: multicallAbi,
    functionName: "aggregate3",
    result: results,
  });
}

function decimals(value: number): Hex {
  return encodeFunctionResult({
    abi: decimalsAbi,
    functionName: "decimals",
    result: BigInt(value),
  });
}

function stringSymbol(value: string): Hex {
  return encodeFunctionResult({
    abi: symbolStringAbi,
    functionName: "symbol",
    result: value,
  });
}

function bytes32Symbol(value: string): Hex {
  const hex = Buffer.from(value, "utf8").toString("hex").padEnd(64, "0");
  return encodeFunctionResult({
    abi: symbolBytes32Abi,
    functionName: "symbol",
    result: `0x${hex}` as Hex,
  });
}

describe("Activity token metadata RPC fallback", () => {
  test("uses the bounded Activity RPC timeout contract", () => {
    expect(ACTIVITY_TOKEN_RPC_TIMEOUT_MS).toBe(3_000);
  });

  test("decodes ABI string and bytes32 symbols and classifies decimals reverts", () => {
    const result = decodeActivityTokenMetadataMulticall(
      aggregate([
        { success: true, returnData: decimals(18) },
        { success: true, returnData: stringSymbol("ZORA") },
        { success: true, returnData: decimals(6) },
        { success: true, returnData: bytes32Symbol("BYTES") },
        { success: false, returnData: "0x" },
        { success: true, returnData: stringSymbol("NFT") },
      ]),
      [A, B, C],
    );
    expect(result.get(A)).toEqual({ kind: "metadata", symbol: "ZORA", decimals: 18 });
    expect(result.get(B)).toEqual({ kind: "metadata", symbol: "BYTES", decimals: 6 });
    expect(result.get(C)).toEqual({ kind: "nft-like" });
  });

  test("rejects a metadata multicall result-count mismatch", () => {
    expect(() => decodeActivityTokenMetadataMulticall(
      aggregate([
        { success: true, returnData: decimals(18) },
        { success: true, returnData: stringSymbol("ONLY-ONE") },
      ]),
      [A, B],
    )).toThrow("wrong result count");
  });

  test("bounds a single allow-failure multicall to 25 unique contracts and caches hits", async () => {
    let calls = 0;
    let encodedCalls = 0;
    let assertionSignal: AbortSignal | undefined;
    const resolver = createActivityTokenRpcResolver({
      rpc: {
        async assertBaseChain(signal) { assertionSignal = signal; },
        async request(method, params, signal) {
          expect(signal).toBe(assertionSignal);
          calls += 1;
          expect(method).toBe("eth_call");
          const request = params[0] as { data: Hex };
          const decoded = decodeFunctionData({ abi: multicallAbi, data: request.data });
          encodedCalls = decoded.args[0].length;
          expect(decoded.args[0].every((call) => call.allowFailure)).toBe(true);
          return aggregate(decoded.args[0].map((_, index) => ({
            success: true,
            returnData: index % 2 === 0 ? decimals(18) : stringSymbol("TOK"),
          })));
        },
      },
    });
    const addresses = Array.from({ length: 30 }, (_, index) =>
      `0x${(index + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
    );
    const first = await resolver(addresses);
    const second = await resolver(addresses);
    expect(first.size).toBe(ACTIVITY_TOKEN_RPC_BATCH_MAX);
    expect(second.size).toBe(ACTIVITY_TOKEN_RPC_BATCH_MAX);
    expect(encodedCalls).toBe(ACTIVITY_TOKEN_RPC_BATCH_MAX * 2);
    expect(calls).toBe(1);
    expect(assertionSignal).toBeInstanceOf(AbortSignal);
  });

  test("keeps infrastructure failure distinguishable and uses a bounded LRU cache", async () => {
    const failing = createActivityTokenRpcResolver({
      rpc: {
        async assertBaseChain() {},
        async request() { throw new Error("whole RPC failed"); },
      },
    });
    await expect(failing([A])).rejects.toThrow("whole RPC failed");

    let calls = 0;
    const bounded = createActivityTokenRpcResolver({
      cacheMaxEntries: 1,
      rpc: {
        async assertBaseChain() {},
        async request(_method, params) {
          calls += 1;
          const decoded = decodeFunctionData({
            abi: multicallAbi,
            data: (params[0] as { data: Hex }).data,
          });
          return aggregate(decoded.args[0].map((_, index) => ({
            success: true,
            returnData: index % 2 === 0 ? decimals(18) : stringSymbol("TOK"),
          })));
        },
      },
    });
    await bounded([A]);
    await bounded([B]);
    await bounded([A]);
    expect(calls).toBe(3);
  });

  test("asserts Base before eth_call and resets a failed assertion", async () => {
    let assertionCalls = 0;
    let metadataCalls = 0;
    const resolver = createActivityTokenRpcResolver({
      rpc: {
        async assertBaseChain() {
          assertionCalls += 1;
          if (assertionCalls === 1) throw new Error("wrong chain");
        },
        async request() {
          metadataCalls += 1;
          return aggregate([
            { success: true, returnData: decimals(18) },
            { success: true, returnData: stringSymbol("TOKEN") },
          ]);
        },
      },
    });

    await expect(resolver([A])).rejects.toThrow("wrong chain");
    expect(metadataCalls).toBe(0);
    await expect(resolver([A])).resolves.toEqual(new Map([
      [A, { kind: "metadata", symbol: "TOKEN", decimals: 18 }],
    ]));
    expect(assertionCalls).toBe(2);
    expect(metadataCalls).toBe(1);
    await resolver([B]);
    expect(assertionCalls).toBe(2);
    expect(metadataCalls).toBe(2);
  });
});
