import { describe, expect, test } from "bun:test";
import { decodeFunctionData, encodeFunctionResult, toFunctionSelector, type Hex } from "viem";
import { multicallAbi, MULTICALL3_ADDRESS, vaultAbi } from "@/server/balances/abi";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { MORPHO_BLUE_ADDRESS } from "@/shared/morpho-markets/config";
import { contractHistoryAsset, morphoHistoryAssets, nativeHistoryAsset } from "./assets";
import { createHistoryChainReader } from "./chain";
import { isRecord } from "@/shared/guards";
import { readJson } from "@/tests/helpers/read-json";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"a".repeat(64)}` as const;
const WORD = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
const WORDS = (...values: bigint[]) => `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}` as Hex;
const block = (number: bigint, timestamp: number) => ({ number: `0x${number.toString(16)}`, timestamp: `0x${timestamp.toString(16)}`, hash: HASH });
const hour = new Date("2025-01-01T01:00:00Z");
const hourTime = hour.getTime() / 1000;

type Call = { target: Hex; callData: Hex; allowFailure: boolean };
type Mock = (method: string, params: unknown[], calls: readonly Call[]) => unknown;
function fakeFetch(mock: Mock) {
  const requests: Array<{ method: string; params: unknown[] }> = [];
  const batchLengths: number[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body));
    const answer = (item: { method: string; params: unknown[]; id: number }) => {
      requests.push(item);
      let calls: readonly Call[] = [];
      if (item.method === "eth_call") {
        const data = (item.params[0] as { data: Hex }).data;
        calls = decodeFunctionData({ abi: multicallAbi, data }).args[0] as readonly Call[];
      }
      const result = mock(item.method, item.params, calls);
      return { jsonrpc: "2.0", id: item.id, result };
    };
    if (Array.isArray(payload)) batchLengths.push(payload.length);
    return new Response(JSON.stringify(Array.isArray(payload) ? payload.map(answer).reverse() : answer(payload)), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, requests, batchLengths };
}

function multicallResponse(calls: readonly Call[], reply: (call: Call, index: number) => { success: boolean; returnData: Hex }) {
  return encodeFunctionResult({ abi: multicallAbi, functionName: "aggregate3", result: calls.map(reply) });
}

function reader(mock: Mock) {
  const transport = fakeFetch(mock);
  return { ...transport, chain: createHistoryChainReader({ rpcUrl: "https://example.com", fetchImpl: transport.fetchImpl }) };
}

describe("history chain reader", () => {
  test("asserts Base chain once per reader and rejects another chain", async () => {
    const valid = reader((method) => method === "eth_chainId" ? "0x2105" : block(BigInt(100), hourTime));
    await valid.chain.finalizedHead();
    await valid.chain.finalizedHead();
    expect(valid.requests.filter(({ method }) => method === "eth_chainId")).toHaveLength(1);
    const invalid = reader(() => "0x1");
    await expect(invalid.chain.finalizedHead()).rejects.toThrow("not Base mainnet");
  });

  test("omits future and non-hour buckets, verifies the estimate and corrects one offset", async () => {
    const { chain, requests } = reader((method, params) => {
      if (method === "eth_chainId") return "0x2105";
      const n = BigInt(params[0] as string);
      return block(n, hourTime + Number(n - BigInt(100)) * 2 + 4);
    });
    const buckets = await chain.resolveBuckets([hour, new Date(hour.getTime() + 3_600_000), new Date(hour.getTime() + 1)], blockRef(BigInt(110), hourTime + 20));
    expect(buckets).toEqual([{ bucketAt: hour, blockNumber: BigInt(98), blockHash: HASH, blockTime: new Date(hour.getTime()) }]);
    expect(requests.filter(({ method }) => method === "eth_getBlockByNumber")).toHaveLength(4);
  });

  test("chunks header JSON-RPC batches at 50 calls", async () => {
    const times = Array.from({ length: 27 }, (_, i) => new Date(hour.getTime() + i * 3_600_000));
    const { chain, batchLengths } = reader((method, params) => method === "eth_chainId"
      ? "0x2105" : block(BigInt(params[0] as string), hourTime + Number(BigInt(params[0] as string) - BigInt(3200)) * 2));
    const buckets = await chain.resolveBuckets(times, blockRef(BigInt(50010), hourTime + 26 * 3600 + 20));
    expect(buckets).toHaveLength(27);
    expect(batchLengths).toEqual([50, 4]);
  });

  test("omits a bucket that cannot be verified after the correction", async () => {
    const { chain } = reader((method, params) => method === "eth_chainId" ? "0x2105" : block(BigInt(params[0] as string), hourTime + 20));
    expect(await chain.resolveBuckets([hour], blockRef(BigInt(100), hourTime + 20))).toEqual([]);
  });

  test("decodes native, ERC20, vault shares and one shared Morpho position, degrading failed subcalls", async () => {
    const [collateral, borrow] = morphoHistoryAssets(BORROW_MARKETS[0].marketId);
    const assets = [nativeHistoryAsset(), contractHistoryAsset(TOKEN), collateral, borrow];
    const { chain, requests } = reader((method, _params, calls) => {
      if (method === "eth_chainId") return "0x2105";
      expect(calls[0].callData.slice(0, 10)).toBe(toFunctionSelector("getEthBalance(address)"));
      expect(calls[1].callData.slice(0, 10)).toBe(toFunctionSelector("balanceOf(address)"));
      expect(calls[2].callData.slice(0, 10)).toBe("0x93c52062");
      expect(calls).toHaveLength(3);
      return multicallResponse(calls, (call) => {
        if (call.target.toLowerCase() === MORPHO_BLUE_ADDRESS.toLowerCase()) return { success: true, returnData: WORDS(BigInt(1), BigInt(42), BigInt(99)) };
        if (call.target.toLowerCase() === MULTICALL3_ADDRESS) return { success: true, returnData: WORD(BigInt(7)) };
        return { success: true, returnData: WORD(BigInt(12)) };
      });
    });
    const quantities = await chain.readQuantities({ address: ACCOUNT, assets, block: BigInt(17) });
    expect([...quantities.values()]).toEqual([
      { status: "ready", baseUnits: BigInt(7) }, { status: "ready", baseUnits: BigInt(12) },
      { status: "ready", baseUnits: BigInt(99) }, { status: "ready", baseUnits: BigInt(42) },
    ]);
    expect(requests.filter(({ method }) => method === "eth_call")).toHaveLength(1);
    const pinned = requests.find(({ method }) => method === "eth_call");
    expect(pinned?.params[1]).toBe("0x11");
    const degraded = reader((method, _params, calls) => method === "eth_chainId" ? "0x2105" : multicallResponse(calls, () => ({ success: false, returnData: "0x" })));
    expect([...((await degraded.chain.readQuantities({ address: ACCOUNT, assets, block: BigInt(17) })).values())])
      .toEqual(assets.map(() => ({ status: "unavailable" })));
  });

  test("verifies missing contract code before treating a failed historical balance call as zero", async () => {
    const [collateral, borrow] = morphoHistoryAssets(BORROW_MARKETS[0].marketId);
    const assets = [nativeHistoryAsset(), contractHistoryAsset(TOKEN), collateral, borrow];
    const { chain, requests } = reader((method, params, calls) => {
      if (method === "eth_chainId") return "0x2105";
      if (method === "eth_getCode") return params[0] === TOKEN ? "0x" : "0x1234";
      return multicallResponse(calls, () => ({ success: false, returnData: "0x" }));
    });
    const result = await chain.readQuantities({ address: ACCOUNT, assets, block: BigInt(17) });
    expect([...result.values()]).toEqual([
      { status: "unavailable" }, { status: "ready", baseUnits: BigInt(0) },
      { status: "unavailable" }, { status: "unavailable" },
    ]);
    expect(requests.filter((entry) => entry.method === "eth_getCode").map((entry) => entry.params[1])).toEqual(["0x11", "0x11"]);
  });

  test("missing or invalid code responses do not turn RPC failures into zero", async () => {
    const assets = [contractHistoryAsset(TOKEN)];
    for (const code of [null, "garbage", "0x1234", "throw"]) {
      const { chain } = reader((method, _params, calls) => {
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_getCode") {
          if (code === "throw") throw new Error("Code RPC failed");
          return code;
        }
        return multicallResponse(calls, () => ({ success: false, returnData: "0x" }));
      });
      const result = await chain.readQuantities({ address: ACCOUNT, assets, block: BigInt(17) });
      expect(result.get(assets[0].key)).toEqual({ status: "unavailable" });
    }
  });

  test("chunks a hundred subcalls and pins each eth_call to the block", async () => {
    const { chain, requests } = reader((method, _params, calls) => method === "eth_chainId" ? "0x2105" : multicallResponse(calls, () => ({ success: true, returnData: WORD(BigInt(2)) })));
    const vaults = Array.from({ length: 101 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}` as const);
    expect(await chain.readVaultRates({ vaults, block: BigInt(5) })).toHaveLength(101);
    const calls = requests.filter(({ method }) => method === "eth_call");
    expect(calls).toHaveLength(2);
    expect(calls.map(({ params }) => params[1])).toEqual(["0x5", "0x5"]);
  });

  test("reads vault conversion rate and degrades malformed subcall return", async () => {
    const { chain } = reader((method, _params, calls) => {
      if (method === "eth_chainId") return "0x2105";
      expect(decodeFunctionData({ abi: vaultAbi, data: calls[0].callData }).args[0]).toBe(BigInt(10) ** BigInt(36));
      return multicallResponse(calls, (_, index) => ({ success: true, returnData: index === 0 ? WORD(BigInt(123)) : "0x12" }));
    });
    expect(await chain.readVaultRates({ vaults: [TOKEN, ACCOUNT], block: BigInt(17) })).toEqual([
      { vault: TOKEN, value: { atoms: BigInt(123), scale: 36 } }, { vault: ACCOUNT, value: null },
    ]);
  });

  test("computes an accrued Morpho index from two pinned rounds", async () => {
    const market = BORROW_MARKETS[0];
    const addressWord = (address: string) => BigInt(address);
    let rounds = 0;
    const { chain, requests } = reader((method, _params, calls) => {
      if (method === "eth_chainId") return "0x2105";
      rounds++;
      return multicallResponse(calls, (call) => {
        if (call.callData.startsWith("0x5c60e39a")) return { success: true, returnData: WORDS(BigInt(0), BigInt(0), BigInt(1_000_000), BigInt(2_000_000), BigInt(100), BigInt(0)) };
        if (call.callData.startsWith("0x2c3c9157")) return { success: true, returnData: WORDS(addressWord(market.loanToken.address), addressWord(market.collateralToken.address), addressWord(market.oracle), addressWord(market.irm), market.lltvWad) };
        return { success: true, returnData: WORD(BigInt("10000000000000000")) };
      });
    });
    expect(await chain.readMorphoBorrowIndexes({ marketIds: [market.marketId], block: BigInt(42), blockTimestamp: 110 })).toEqual([
      { marketId: market.marketId, value: { atoms: BigInt("368389000000000000000000000000000000"), scale: 36 } },
    ]);
    expect(rounds).toBe(2);
    expect(requests.filter(({ method }) => method === "eth_call").every(({ params }) => params[1] === "0x2a")).toBe(true);
  });

  test("omits malformed headers and returns null for failed Morpho rate calls", async () => {
    const missing = reader((method) => method === "eth_chainId" ? "0x2105" : { number: "0x1", timestamp: "0x1" });
    expect(await missing.chain.resolveBuckets([hour], blockRef(BigInt(100), hourTime + 20))).toEqual([]);
    const market = BORROW_MARKETS[0];
    const degraded = reader((method, _params, calls) => {
      if (method === "eth_chainId") return "0x2105";
      return multicallResponse(calls, (call) => {
        if (call.callData.startsWith("0x5c60e39a")) return { success: true, returnData: WORDS(BigInt(0), BigInt(0), BigInt(1_000_000), BigInt(2_000_000), BigInt(100), BigInt(0)) };
        if (call.callData.startsWith("0x2c3c9157")) return { success: true, returnData: WORDS(BigInt(market.loanToken.address), BigInt(market.collateralToken.address), BigInt(market.oracle), BigInt(market.irm), market.lltvWad) };
        return { success: false, returnData: "0x" };
      });
    });
    expect(await degraded.chain.readMorphoBorrowIndexes({ marketIds: [market.marketId], block: BigInt(42), blockTimestamp: 110 }))
      .toEqual([{ marketId: market.marketId, value: null }]);
  });

  test("throws for a whole RPC error", async () => {
    const { fetchImpl } = fakeFetch(() => null);
    const rpcErrorFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchImpl(url, init);
      const payload = await readJson(response);
      if (!isRecord(payload)) throw new Error("Expected a JSON-RPC response object");
      if (payload.method === "eth_chainId") return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: "0x2105" }));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: -32000, message: "archive unavailable" } }));
    }) as typeof fetch;
    const chain = createHistoryChainReader({ rpcUrl: "https://example.com", fetchImpl: rpcErrorFetch });
    await expect(chain.readVaultRates({ vaults: [TOKEN], block: BigInt(5) })).rejects.toThrow("archive unavailable");
  });
});

function blockRef(number: bigint, timestamp: number) {
  return { number, timestamp, hash: HASH };
}
