import { describe, expect, jest, test } from "bun:test";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
} from "viem";
import { multicallAbi } from "@/server/balances/abi";
import {
  ACTIVITY_TOKEN_RPC_BATCH_MAX,
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

function metadataResponse(): Hex {
  return aggregate([
    { success: true, returnData: decimals(18) },
    { success: true, returnData: stringSymbol("TOK") },
  ]);
}

describe("Activity token metadata RPC fallback", () => {
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
    expect(first.size).toBe(ACTIVITY_TOKEN_RPC_BATCH_MAX); // oxlint-disable-line home/no-self-referential-expectation -- the constant is the specified bound; the assertion tests bounding, not the value
    expect(second.size).toBe(ACTIVITY_TOKEN_RPC_BATCH_MAX); // oxlint-disable-line home/no-self-referential-expectation -- the constant is the specified bound; the assertion tests bounding, not the value
    expect(encodedCalls).toBe(ACTIVITY_TOKEN_RPC_BATCH_MAX * 2);
    expect(calls).toBe(1);
    expect(assertionSignal).toBeInstanceOf(AbortSignal);
  });

  test("caches and replays an nft-like onchain result without another RPC", async () => {
    let calls = 0;
    const resolver = createActivityTokenRpcResolver({
      rpc: {
        async assertBaseChain() {},
        async request(method) {
          expect(method).toBe("eth_call");
          calls += 1;
          return aggregate([
            { success: false, returnData: "0x" },
            { success: true, returnData: stringSymbol("NFT") },
            { success: true, returnData: decimals(18) },
            { success: false, returnData: "0x" },
          ]);
        },
      },
    });

    expect((await resolver([A, B])).get(A)).toEqual({ kind: "nft-like" });
    expect((await resolver([A, B])).get(B)).toEqual({ kind: "unknown" });
    expect((await resolver([A, B])).get(A)).toEqual({ kind: "nft-like" });
    expect((await resolver([A, B])).get(B)).toEqual({ kind: "unknown" });
    expect(calls).toBe(1);
  });

  test("does not cache transient RPC failures and retries the next call", async () => {
    let calls = 0;
    const resolver = createActivityTokenRpcResolver({
      rpc: {
        async assertBaseChain() {},
        async request() {
          calls += 1;
          if (calls === 1) throw new Error("whole RPC failed");
          return metadataResponse();
        },
      },
    });
    await expect(resolver([A])).rejects.toThrow("whole RPC failed");
    expect((await resolver([A])).get(A)).toEqual({ kind: "metadata", decimals: 18, symbol: "TOK" });
    await resolver([A]);
    expect(calls).toBe(2);
  });

  test("never serves an expired cached entry after a failed refetch", async () => {
    let nowMs = 0;
    let calls = 0;
    const resolver = createActivityTokenRpcResolver({
      cacheTtlMs: 100, now: () => new Date(nowMs),
      rpc: {
        async assertBaseChain() {},
        async request() {
          calls += 1;
          if (calls === 2) throw new Error("refetch failed");
          return metadataResponse();
        },
      },
    });
    expect((await resolver([A])).get(A)).toEqual({ kind: "metadata", decimals: 18, symbol: "TOK" });
    expect(calls).toBe(1);
    nowMs = 101;
    await expect(resolver([A])).rejects.toThrow("refetch failed");
    expect(calls).toBe(2);
    expect((await resolver([A])).get(A)).toEqual({ kind: "metadata", decimals: 18, symbol: "TOK" });
    expect(calls).toBe(3);
  });

  test("propagates a caller abort to the RPC request", async () => {
    const controller = new AbortController();
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    let observedAborted = false;
    const resolver = createActivityTokenRpcResolver({
      rpc: {
        async assertBaseChain() {},
        request(_method, _params, signal) {
          return new Promise<unknown>((_resolve, reject) => {
            const onAbort = () => {
              observedAborted = signal?.aborted ?? false;
              reject(new Error("aborted"));
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            requestStarted();
            if (signal?.aborted) onAbort();
          });
        },
      },
    });
    const pending = resolver([A], controller.signal);
    await started;
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(observedAborted).toBe(true);
  });

  test("abandons a hung read within the bounded default RPC deadline", async () => {
    jest.useFakeTimers();
    try {
      let requestStarted = false;
      let requestSignal: AbortSignal | undefined;
      const resolver = createActivityTokenRpcResolver({
        rpc: {
          async assertBaseChain() {},
          request(_method, _params, signal) {
            requestSignal = signal;
            requestStarted = true;
            return new Promise<never>((_resolve, reject) => {
              signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            });
          },
        },
      });
      const pending = resolver([A]);
      for (let tick = 0; tick < 32 && !requestStarted; tick += 1) await Promise.resolve();
      expect(requestStarted).toBeTrue();
      jest.advanceTimersByTime(1);
      expect(requestSignal?.aborted).toBeFalse();
      jest.advanceTimersByTime(10_000);
      expect(requestSignal?.aborted).toBeTrue();
      let failure: Error | undefined;
      void pending.catch((error: Error) => { failure = error; });
      for (let tick = 0; tick < 32 && failure === undefined; tick += 1) await Promise.resolve();
      expect(failure?.message).toBe("aborted");
    } finally {
      jest.useRealTimers();
    }
  });

  test("hits exactly at TTL and refetches one millisecond later", async () => {
    let nowMs = 0;
    let calls = 0;
    const resolver = createActivityTokenRpcResolver({
      cacheTtlMs: 100, now: () => new Date(nowMs),
      rpc: {
        async assertBaseChain() {},
        async request() { calls += 1; return metadataResponse(); },
      },
    });
    await resolver([A]);
    nowMs = 100;
    await resolver([A]);
    expect(calls).toBe(1);
    nowMs = 101;
    await resolver([A]);
    expect(calls).toBe(2);
  });

  test("evicts the least recently used token after a cache hit", async () => {
    let calls = 0;
    const resolver = createActivityTokenRpcResolver({
      cacheMaxEntries: 2,
      rpc: {
        async assertBaseChain() {},
        async request() { calls += 1; return metadataResponse(); },
      },
    });
    await resolver([A]);
    await resolver([B]);
    await resolver([A]);
    await resolver([C]);
    await resolver([A]);
    expect(calls).toBe(3);
    await resolver([B]);
    expect(calls).toBe(4);
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
