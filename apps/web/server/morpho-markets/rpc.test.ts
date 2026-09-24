import { describe, expect, test } from "bun:test";
import { VERIFIED_MORPHO_MARKETS, type VerifiedMorphoMarketRef } from "@/shared/morpho-markets/config";
import { encodeCoinbaseExecuteBatch } from "./abi";
import { createMorphoMarketRpcReader } from "./rpc";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const OTHER_HASH = `0x${"cd".repeat(32)}` as `0x${string}`;
const IMPLEMENTATION = "0x2222222222222222222222222222222222222222" as const;
const prices = [
  "843242900000000000000000000000000000000",
  "1504740000000000000000000000000000000",
  "3059024445000000000000000000",
  "941080000000000000000000000000000",
  "238684290000000000000000000000000000",
];
function word(value: bigint) { return value.toString(16).padStart(64, "0"); }
function addressWord(address: string) { return address.slice(2).toLowerCase().padStart(64, "0"); }
function words(...values: string[]) { return `0x${values.join("")}`; }
type Call = { id: number; method: string; params: unknown[] };

function fixture(options: { badDecimals?: number; badParams?: number; badOracle?: number; missing?: number; reorg?: boolean; transport?: boolean } = {}) {
  const requests: Array<Call | Call[]> = [];
  const respond = (request: Call) => {
    if (request.method === "eth_chainId") return { jsonrpc: "2.0", id: request.id, result: "0x2105" };
    if (request.method === "eth_getBlockByNumber") {
      return { jsonrpc: "2.0", id: request.id, result: { number: "0x64", hash: options.reorg && request.params[0] === "0x64" && requests.length > 2 ? OTHER_HASH : BLOCK_HASH, timestamp: "0x64" } };
    }
    const index = Math.floor((request.id - 3) / 12);
    const slot = (request.id - 3) % 12;
    const market = VERIFIED_MORPHO_MARKETS[index];
    const result = slot === 0 ? words(addressWord(market.loanToken.address), addressWord(market.collateralToken.address), addressWord(market.oracle), addressWord(market.irm), word(options.badParams === index ? market.lltvWad - BigInt(1) : market.lltvWad))
      : slot === 1 ? words(word(BigInt("100000000000")), word(BigInt("2000000000")), word(BigInt("500000000")), word(BigInt("500000000")), word(BigInt("90")), word(BigInt(0)))
      : slot === 2 ? words(word(BigInt(0)), word(BigInt("100000000")), word(BigInt(10) ** BigInt(market.collateralToken.decimals)))
      : slot === 3 ? words(word(options.badOracle === index ? BigInt(0) : BigInt(prices[index])))
      : slot === 8 ? words(word(BigInt(market.loanToken.decimals + (options.badDecimals === index ? 1 : 0))))
      : slot === 9 ? words(word(BigInt(market.collateralToken.decimals + (options.badDecimals === index ? 1 : 0))))
      : slot === 10 ? words(word(BigInt(0)))
      : words(word(BigInt("50000000")));
    return { jsonrpc: "2.0", id: request.id, result };
  };
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Call | Call[];
    requests.push(body);
    if (options.transport && Array.isArray(body)) return new Response("unavailable", { status: 502 });
    return Response.json(Array.isArray(body)
      ? body.filter((entry) => entry.id !== options.missing).map(respond).reverse()
      : respond(body));
  };
  return { requests, fetchImpl: fetchImpl as typeof fetch };
}
function reader(source: ReturnType<typeof fixture>) {
  return createMorphoMarketRpcReader({ fetchImpl: source.fetchImpl, rpcUrl: "https://rpc.example.test", now: () => new Date("2026-09-24T02:49:17.000Z") });
}

describe("Base Morpho market RPC", () => {
  test("pins one block, chunks initial reads to 40, batches rates, and reconfirms once for all five markets", async () => {
    const source = fixture();
    const results = await reader(source).readSnapshots(OWNER, VERIFIED_MORPHO_MARKETS, undefined, { number: "100", hash: BLOCK_HASH });
    expect(results).toHaveLength(5);
    expect(results.every((result) => result.snapshot !== undefined)).toBe(true);
    for (const [index, result] of results.entries()) {
      expect(result.snapshot?.market.id).toBe(VERIFIED_MORPHO_MARKETS[index].marketId);
      expect(result.snapshot?.state.oraclePriceRaw).toBe(prices[index]);
      expect(result.snapshot?.source.blockHash).toBe(BLOCK_HASH);
    }
    const batches = source.requests.filter((entry): entry is Call[] => Array.isArray(entry));
    expect(batches.map((batch) => batch.length)).toEqual([40, 10, 5]);
    expect(batches.every((batch) => batch.every((call) => call.params[1] === "0x64"))).toBe(true);
    const requests = source.requests.flat();
    expect(requests.filter((entry) => entry.method === "eth_chainId")).toHaveLength(1);
    expect(requests.filter((entry) => entry.method === "eth_getBlockByNumber")).toHaveLength(2);
  });

  test("isolates bad decimals, params, zero oracle, and a missing response", async () => {
    for (const [fault, index] of [["badDecimals", 0], ["badParams", 1], ["badOracle", 2], ["missing", 39]] as const) {
      const source = fixture({ [fault]: index });
      const results = await reader(source).readSnapshots(OWNER, VERIFIED_MORPHO_MARKETS);
      const broken = fault === "missing" ? 3 : index;
      expect(results.map((result) => Boolean(result.error))).toEqual(VERIFIED_MORPHO_MARKETS.map((_, i) => i === broken));
    }
  });

  test("rejects a configured id mismatch before issuing any onchain request", async () => {
    const source = fixture();
    const bad = { ...VERIFIED_MORPHO_MARKETS[0], marketId: `0x${"01".repeat(32)}` as `0x${string}` } satisfies VerifiedMorphoMarketRef;
    const [failure, good] = await reader(source).readSnapshots(OWNER, [bad, VERIFIED_MORPHO_MARKETS[1]]);
    expect(failure.error?.message).toContain("id does not match");
    expect(good.snapshot?.market.id).toBe(VERIFIED_MORPHO_MARKETS[1].marketId);
    expect(source.requests.flat().filter((entry) => entry.method === "eth_call").every((entry) => entry.id >= 15)).toBe(true);
    const empty = fixture();
    await expect(reader(empty).readSnapshot(OWNER, bad)).rejects.toThrow("id does not match");
    expect(empty.requests).toEqual([]);
  });

  test("rejects a reorg or whole-batch transport error for all markets", async () => {
    await expect(reader(fixture({ reorg: true })).readSnapshots(OWNER, VERIFIED_MORPHO_MARKETS)).rejects.toThrow("source block changed");
    await expect(reader(fixture({ transport: true })).readSnapshots(OWNER, VERIFIED_MORPHO_MARKETS)).rejects.toThrow("invalid batch response");
  });

  test("rejects an incorrect externally pinned block and verifies the chain once per reader", async () => {
    const source = fixture();
    const client = reader(source);
    await expect(client.readSnapshots(OWNER, VERIFIED_MORPHO_MARKETS, undefined, { number: "100", hash: OTHER_HASH })).rejects.toThrow("not canonical");
    await client.readSnapshot(OWNER, VERIFIED_MORPHO_MARKETS[0]);
    expect(source.requests.flat().filter((entry) => entry.method === "eth_chainId")).toHaveLength(1);
  });

  test("simulates the exact ordered calls through the deployed account and reconfirms the source hash", async () => {
    const requests: Call[] = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const call = JSON.parse(String(init?.body)) as Call;
      requests.push(call);
      const result = call.id === 21 ? "0x6001" : call.id === 22 ? words(addressWord(IMPLEMENTATION))
        : call.id === 23 ? "0x6002" : call.id === 24 ? "0x"
        : { number: "0x64", hash: BLOCK_HASH, timestamp: "0x64" };
      return Response.json({ jsonrpc: "2.0", id: call.id, result });
    };
    const calls = [
      { to: OWNER, value: "0", data: "0x1234" as const },
      { to: IMPLEMENTATION, value: "0", data: "0xabcd" as const },
    ];
    await createMorphoMarketRpcReader({ fetchImpl: fetchImpl as typeof fetch, rpcUrl: "https://rpc.example.test" }).simulateBatch(calls, OWNER, "100", BLOCK_HASH);
    expect(requests.map(({ method }) => method)).toEqual(["eth_getCode", "eth_call", "eth_getCode", "eth_call", "eth_getBlockByNumber"]);
    const batchCall = requests[3].params[0] as { from: string; to: string; data: string };
    expect(batchCall).toMatchObject({ from: OWNER, to: OWNER, data: encodeCoinbaseExecuteBatch(calls) });
    expect(requests[4].params).toEqual(["0x64", false]);
  });
});
