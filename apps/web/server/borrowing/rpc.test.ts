import { describe, expect, test } from "bun:test";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { createBorrowRpcReader } from "./rpc";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
function word(value: bigint) { return value.toString(16).padStart(64, "0"); }
function addressWord(address: string) { return address.slice(2).toLowerCase().padStart(64, "0"); }
function words(...values: string[]) { return `0x${values.join("")}`; }
type RpcCall = { id: number; method: string; params: unknown[] };
function fixture() {
  const batches: RpcCall[][] = [];
  const respond = (call: RpcCall) => {
    if (call.method === "eth_chainId") return { jsonrpc: "2.0", id: call.id, result: "0x2105" };
    if (call.method === "eth_getBlockByNumber") return { jsonrpc: "2.0", id: call.id, result: { number: "0x64", hash: HASH, timestamp: "0x64" } };
    const index = Math.floor((call.id - 3) / 12);
    const slot = (call.id - 3) % 12;
    const ref = BORROW_MARKETS[index];
    const price = BigInt(10) ** BigInt(36 + 6 - ref.collateralToken.decimals) * BigInt(80000);
    const result = slot === 0 ? words(addressWord(ref.loanToken.address), addressWord(ref.collateralToken.address), addressWord(ref.oracle), addressWord(ref.irm), word(ref.lltvWad))
      : slot === 1 ? words(word(BigInt("100000000000")), word(BigInt(0)), word(BigInt("500000000")), word(BigInt("500000000")), word(BigInt(90)), word(BigInt(0)))
      : slot === 2 ? words(word(BigInt(0)), word(BigInt("100000000")), word(BigInt(10) ** BigInt(ref.collateralToken.decimals)))
      : slot === 3 ? words(word(price))
      : slot === 8 ? words(word(BigInt(ref.loanToken.decimals)))
      : slot === 9 ? words(word(BigInt(ref.collateralToken.decimals)))
      : words(word(BigInt(0)));
    return { jsonrpc: "2.0", id: call.id, result };
  };
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RpcCall | RpcCall[];
    if (Array.isArray(body)) batches.push(body);
    return Response.json(Array.isArray(body) ? body.map(respond) : respond(body));
  };
  return { batches, fetchImpl: fetchImpl as typeof fetch };
}

describe("Borrow RPC projection", () => {
  test("projects all five policy limits and eligibility from one shared pinned read", async () => {
    const source = fixture();
    const reader = createBorrowRpcReader({ fetchImpl: source.fetchImpl, rpcUrl: "https://rpc.example.test" });
    const results = await reader.readSnapshots(OWNER, BORROW_MARKETS);
    expect(results).toHaveLength(5);
    for (const [index, result] of results.entries()) {
      expect(result.snapshot).toMatchObject({
        version: "1", market: { id: BORROW_MARKETS[index].marketId },
        eligibility: { mode: "enabled", newRisk: true }, source: { blockHash: HASH },
      });
      expect(BigInt(result.snapshot!.position.borrowCapacityAssetsRaw)).toBeLessThan(BigInt(result.snapshot!.position.rawBorrowCapacityAssetsRaw));
      expect(BigInt(result.snapshot!.position.withdrawableCollateralRaw)).toBeLessThanOrEqual(BigInt(result.snapshot!.position.rawWithdrawableCollateralRaw));
    }
    expect(source.batches.map((batch) => batch.length)).toEqual([40, 10, 5]);
  });

  test("readSnapshot preserves detail compatibility and a bad registry id fails closed", async () => {
    const source = fixture();
    const reader = createBorrowRpcReader({ fetchImpl: source.fetchImpl, rpcUrl: "https://rpc.example.test" });
    const result = await reader.readSnapshot(OWNER, BORROW_MARKETS[0]);
    expect(result.market.id).toBe(BORROW_MARKETS[0].marketId);
    await expect(reader.readSnapshot(OWNER, { ...BORROW_MARKETS[0], marketId: `0x${"cd".repeat(32)}` })).rejects.toThrow("id does not match");
  });
});
