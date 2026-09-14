import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BORROW_MARKET,
  MORPHO_BLUE_ADDRESS,
  type BorrowMarketRef,
} from "@/shared/borrowing/config";
import { encodeCoinbaseExecuteBatch } from "./abi";
import { ORACLE_PRICE_SCALE, availableBorrowAssets, borrowCapacityAssets, toAssetsUp } from "./math";
import { BorrowRpcError, createBorrowRpcReader } from "./rpc";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const IMPLEMENTATION = "0x2222222222222222222222222222222222222222" as const;

function word(value: bigint) { return value.toString(16).padStart(64, "0"); }
function addressWord(address: string) { return address.slice(2).toLowerCase().padStart(64, "0"); }
function words(...values: string[]) { return `0x${values.join("")}`; }

function fixture(options: { wrongLltv?: boolean; market?: BorrowMarketRef } = {}) {
  const configured = options.market ?? DEFAULT_BORROW_MARKET;
  const requests: unknown[] = [];
  const totalSupplyAssets = BigInt("100000000000");
  const totalBorrowAssets = BigInt("500000000");
  const totalBorrowShares = BigInt("500000000");
  const borrowShares = BigInt("100000000");
  const collateral = BigInt(10) ** BigInt(configured.collateralToken.decimals);
  const oraclePrice = BigInt("80000") * ORACLE_PRICE_SCALE *
    (BigInt(10) ** BigInt(configured.loanToken.decimals)) /
    (BigInt(10) ** BigInt(configured.collateralToken.decimals));

  const respond = (request: { id: number; method: string }) => {
    if (request.id === 1) return { jsonrpc: "2.0", id: 1, result: "0x2105" };
    if (request.id === 2 || request.id === 12) {
      return { jsonrpc: "2.0", id: request.id, result: { number: "0x64", hash: BLOCK_HASH, timestamp: "0x64" } };
    }
    const callResult: Record<number, string> = {
      3: words(
        addressWord(configured.loanToken.address),
        addressWord(configured.collateralToken.address),
        addressWord(configured.oracle),
        addressWord(configured.irm),
        word(options.wrongLltv ? configured.lltvWad - BigInt("1") : configured.lltvWad),
      ),
      4: words(word(totalSupplyAssets), word(BigInt("2000000000")), word(totalBorrowAssets), word(totalBorrowShares), word(BigInt("90")), word(BigInt("0"))),
      5: words(word(BigInt("0")), word(borrowShares), word(collateral)),
      6: words(word(oraclePrice)),
      7: words(word(BigInt("2000000"))),
      8: words(word(BigInt("50000000"))),
      9: words(word(BigInt("0"))),
      10: words(word(BigInt("0"))),
      11: words(word(BigInt("0"))),
    };
    return { jsonrpc: "2.0", id: request.id, result: callResult[request.id] };
  };

  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string } | Array<{ id: number; method: string }>;
    requests.push(body);
    return Response.json(Array.isArray(body) ? body.map(respond) : respond(body));
  };
  return {
    fetchImpl: fetchImpl as typeof fetch,
    requests,
    expectedDebt: toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares),
    expectedCapacity: availableBorrowAssets({
      positionBorrowShares: borrowShares,
      totalBorrowAssets,
      totalBorrowShares,
      maxDebtAssets: borrowCapacityAssets(collateral, oraclePrice, configured.lltvWad),
      liquidityAssets: totalSupplyAssets - totalBorrowAssets,
    }),
  };
}

describe("Base Morpho borrowing RPC", () => {
  test("pins all reads, verifies the exact market params, and derives debt and capacity from shares", async () => {
    const source = fixture();
    const snapshot = await createBorrowRpcReader({
      fetchImpl: source.fetchImpl,
      rpcUrl: "https://rpc.example.test",
      now: () => new Date("2026-09-08T12:00:00.000Z"),
    }).readSnapshot(OWNER, DEFAULT_BORROW_MARKET);

    expect(snapshot.market.morpho).toBe(MORPHO_BLUE_ADDRESS);
    expect(snapshot.position.debtAssetsRaw).toBe(source.expectedDebt.toString());
    expect(BigInt(snapshot.position.rawBorrowCapacityAssetsRaw)).toBe(source.expectedCapacity);
    expect(BigInt(snapshot.position.borrowCapacityAssetsRaw)).toBeLessThan(source.expectedCapacity);
    expect(snapshot.source.blockHash).toBe(BLOCK_HASH);
    const batch = source.requests[2] as Array<{ params: unknown[] }>;
    expect(batch).toHaveLength(8);
    expect(batch.every((request) => request.params[1] === "0x64")).toBe(true);
  });

  test("uses the supplied typed market tuple and asset decimals without pair-specific branches", async () => {
    const generic = {
      ...DEFAULT_BORROW_MARKET,
      marketId: `0x${"12".repeat(32)}` as const,
      loanToken: { ...DEFAULT_BORROW_MARKET.loanToken, id: "eip155:8453/erc20:0x3333333333333333333333333333333333333333" as const, address: "0x3333333333333333333333333333333333333333" as const, symbol: "LOAN", decimals: 6 },
      collateralToken: { ...DEFAULT_BORROW_MARKET.collateralToken, id: "eip155:8453/erc20:0x4444444444444444444444444444444444444444" as const, address: "0x4444444444444444444444444444444444444444" as const, symbol: "COLL", decimals: 18 },
      lltvWad: BigInt("700000000000000000"),
      rank: 2,
    } satisfies BorrowMarketRef;
    const source = fixture({ market: generic });
    const snapshot = await createBorrowRpcReader({ fetchImpl: source.fetchImpl, rpcUrl: "https://rpc.example.test" }).readSnapshot(OWNER, generic);
    expect(snapshot.market).toMatchObject({ id: generic.marketId, rank: 2, loanToken: { symbol: "LOAN", decimals: 6 }, collateralToken: { symbol: "COLL", decimals: 18 } });
    const remainingCollateral = BigInt(snapshot.position.collateralRaw) - BigInt(snapshot.position.withdrawableCollateralRaw);
    const remainingMaximumDebt = borrowCapacityAssets(remainingCollateral, BigInt(snapshot.state.oraclePriceRaw), generic.lltvWad);
    expect(remainingMaximumDebt * BigInt("1000000000000000000"))
      .toBeGreaterThanOrEqual(BigInt(snapshot.position.debtAssetsRaw) * BigInt("1250000000000000000"));
  });

  test("encodes the documented Coinbase executeBatch tuple array exactly", () => {
    expect(encodeCoinbaseExecuteBatch([
      { to: OWNER, value: "0", data: "0x1234" },
      { to: IMPLEMENTATION, value: "0", data: "0xabcd" },
    ])).toBe("0x34fcd5be00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000212340000000000000000000000000000000000000000000000000000000000000000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000002abcd000000000000000000000000000000000000000000000000000000000000");
  });

  test("simulates the exact ordered calls through the deployed account and reconfirms the source hash", async () => {
    const requests: Array<{ id: number; method: string; params: unknown[] }> = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
      requests.push(request);
      const result = request.id === 21 ? "0x6001"
        : request.id === 22 ? words(addressWord(IMPLEMENTATION))
        : request.id === 23 ? "0x6002"
        : request.id === 24 ? "0x"
        : { number: "0x64", hash: BLOCK_HASH, timestamp: "0x64" };
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    };
    const calls = [
      { to: OWNER, value: "0", data: "0x1234" as const },
      { to: IMPLEMENTATION, value: "0", data: "0xabcd" as const },
    ];
    await createBorrowRpcReader({
      fetchImpl: fetchImpl as typeof fetch,
      rpcUrl: "https://rpc.example.test",
    }).simulateBatch(calls, OWNER, "100", BLOCK_HASH);

    expect(requests.map(({ method }) => method)).toEqual([
      "eth_getCode",
      "eth_call",
      "eth_getCode",
      "eth_call",
      "eth_getBlockByNumber",
    ]);
    const batchCall = requests[3].params[0] as { from: string; to: string; data: string };
    expect(batchCall.from).toBe(OWNER);
    expect(batchCall.to).toBe(OWNER);
    expect(batchCall.data).toBe(encodeCoinbaseExecuteBatch(calls));
    expect(requests[4].params).toEqual(["0x64", false]);
  });

  test("rejects empty account or implementation code and a source hash change after successful batch simulation", async () => {
    const readerWith = (
      accountCode: string,
      confirmedHash = BLOCK_HASH,
      implementationCode = "0x6002",
    ) => createBorrowRpcReader({
      rpcUrl: "https://rpc.example.test",
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { id: number };
        const result = request.id === 21 ? accountCode
          : request.id === 22 ? words(addressWord(IMPLEMENTATION))
          : request.id === 23 ? implementationCode
          : request.id === 24 ? "0x"
          : { number: "0x64", hash: confirmedHash, timestamp: "0x64" };
        return Response.json({ jsonrpc: "2.0", id: request.id, result });
      }) as typeof fetch,
    });
    const calls = [{ to: IMPLEMENTATION, value: "0", data: "0x1234" as const }];

    await expect(readerWith("0x").simulateBatch(calls, OWNER, "100", BLOCK_HASH))
      .rejects.toMatchObject({ code: "account-capability" });
    await expect(readerWith("0x6001", BLOCK_HASH, "0x").simulateBatch(calls, OWNER, "100", BLOCK_HASH))
      .rejects.toMatchObject({ code: "account-capability" });
    await expect(readerWith("0x6001", `0x${"cd".repeat(32)}` as `0x${string}`).simulateBatch(calls, OWNER, "100", BLOCK_HASH))
      .rejects.toThrow("changed during batch simulation");
  });

  test("fails closed if onchain market parameters differ from the verified market", async () => {
    const source = fixture({ wrongLltv: true });
    await expect(createBorrowRpcReader({
      fetchImpl: source.fetchImpl,
      rpcUrl: "https://rpc.example.test",
    }).readSnapshot(OWNER, DEFAULT_BORROW_MARKET)).rejects.toBeInstanceOf(BorrowRpcError);
  });
});
