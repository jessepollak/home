import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import { DEFAULT_BORROW_MARKET } from "@/shared/borrowing/config";
import type { VerifiedMorphoMarketRef } from "@/shared/morpho-markets/config";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import type { MorphoMarketRpcReader, MorphoMarketSnapshot } from "@/server/morpho-markets/rpc";
import { createBorrowHandler, createBorrowMarketHandler } from "./handler";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as const;
const market = DEFAULT_BORROW_MARKET;
const lendOnlyMarket = {
  ...market,
  marketId: `0x${"cd".repeat(32)}`,
  rank: 2,
  capabilities: { lend: "enabled" },
} as const satisfies VerifiedMorphoMarketRef;

function session(): VerifiedAccountSession { return { user: { subject: "borrow-test-user" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }; }
function snapshot(ref: VerifiedMorphoMarketRef = market, overrides: {
  position?: Partial<MorphoMarketSnapshot["position"]>;
  state?: Partial<MorphoMarketSnapshot["state"]>;
} = {}): MorphoMarketSnapshot {
  return {
    chainId: 8453,
    walletAddress: OWNER,
    market: { id: ref.marketId, morpho: ref.morpho, loanToken: ref.loanToken, collateralToken: ref.collateralToken, oracle: ref.oracle, irm: ref.irm, lltvWad: ref.lltvWad.toString(), rank: ref.rank },
    capabilities: ref.capabilities,
    source: { provider: "Base JSON-RPC", blockNumber: "100", blockHash: BLOCK_HASH, blockTimestamp: "1789329600", fetchedAt: "2026-09-13T12:00:00.000Z" },
    state: {
      oraclePriceRaw: "1", borrowRatePerSecondWad: "0", borrowAprWad: "0",
      totalSupplyAssetsRaw: "2", totalSupplySharesRaw: "2", totalBorrowAssetsRaw: "1", totalBorrowSharesRaw: "1",
      liquidityAssetsRaw: "1", feeWad: "0", utilizationWad: "500000000000000000", supplyAprWad: "0", lastUpdateTimestamp: "1",
      ...overrides.state,
    },
    wallet: { collateralBalanceRaw: "1", loanBalanceRaw: "1", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: {
      supplySharesRaw: "1", suppliedAssetsRaw: "1", withdrawableSupplyAssetsRaw: "1",
      collateralRaw: "1", borrowSharesRaw: "1", debtAssetsRaw: "1", availableBorrowAssetsRaw: "0", withdrawableCollateralRaw: "0",
      healthFactorWad: "1", liquidationPriceRaw: "1", ...overrides.position,
    },
  };
}
function request(path = "/api/borrow") { return new Request(`https://home.test${path}`, { headers: { [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" } }); }
function rpc(readSnapshot: MorphoMarketRpcReader["readSnapshot"]): MorphoMarketRpcReader { return { readSnapshot, simulateBatch: async () => {} }; }

describe("borrow API handlers", () => {
  test("preserves Borrow v1 projection while reading a shared market once", async () => {
    let reads = 0;
    const handler = createBorrowHandler({ authorize: async () => Response.json(session()), rpc: rpc(async () => { reads += 1; return snapshot(); }), now: () => new Date("2026-09-13T12:00:00.000Z") });
    const response = await handler(request());
    const value = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(Object.keys(value)).toEqual(["version", "chainId", "owner", "discovery", "opportunities", "positions", "lending"]);
    expect(value).toMatchObject({ version: "1", owner: { address: OWNER }, discovery: { status: "complete", candidateCount: 1, verifiedCount: 1 } });
    expect(value.opportunities).toHaveLength(1);
    expect(value.positions).toHaveLength(1);
    expect(value.lending).toMatchObject({ version: "1", opportunities: [{ availability: { status: "available", canSupply: true, canWithdraw: true } }] });
    expect(value.lending.positions).toHaveLength(1);
    expect(value.positions[0]).not.toHaveProperty("supplySharesRaw");
    expect(reads).toBe(1);
  });

  test("makes canWithdraw reflect current withdrawable assets rather than residual shares", async () => {
    const handler = createBorrowHandler({
      authorize: async () => Response.json(session()),
      rpc: rpc(async () => snapshot(market, { position: { supplySharesRaw: "1", suppliedAssetsRaw: "1", withdrawableSupplyAssetsRaw: "0" } })),
    });
    const value = await (await handler(request())).json();
    expect(value.lending.opportunities[0].availability).toMatchObject({ status: "available", canSupply: true, canWithdraw: false });
    expect(value.lending.positions).toHaveLength(1);
  });

  test("represents an RPC failure as unavailable, disables supply, and emits redacted bounded observability", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    try {
      const handler = createBorrowHandler({ authorize: async () => Response.json(session()), rpc: rpc(async () => { throw new Error("offline"); }) });
      const response = await handler(request());
      const value = await response.json();
      expect(response.status).toBe(200);
      expect(value.discovery.status).toBe("partial");
      expect(value.opportunities[0].availability).toMatchObject({ status: "unavailable", source: null });
      expect(value.positions).toEqual([]);
      expect(value.lending.opportunities[0].availability).toMatchObject({ status: "unavailable", canSupply: false, canWithdraw: false, source: null, state: null });
      expect(value.lending.positions).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ kind: "borrow-overview", route: "/api/borrow", code: "BORROW_MARKET_READ_UNAVAILABLE", outcome: "unavailable", provider: "base-rpc" });
      expect(lines[0]).not.toContain(OWNER);
      expect(lines[0]).not.toContain(market.marketId);
    } finally {
      setObservabilityLogWriterForTests();
    }
  });

  test("contains malformed lending projection to that market without crashing Borrow overview", async () => {
    const malformed = snapshot();
    (malformed.state as { supplyAprWad: unknown }).supplyAprWad = 1;
    const handler = createBorrowHandler({ authorize: async () => Response.json(session()), rpc: rpc(async () => malformed) });
    const value = await (await handler(request())).json();
    expect(value.opportunities[0].availability.status).toBe("available");
    expect(value.lending.opportunities[0].availability).toMatchObject({ status: "unavailable", canSupply: false, state: null });
  });

  test("discovers and serves an actionable lend-only market while keeping Borrow separate", async () => {
    const markets = [market, lendOnlyMarket];
    const reads: string[] = [];
    const reader = rpc(async (_owner, ref) => { reads.push(ref.marketId); return snapshot(ref); });
    const overviewHandler = createBorrowHandler({ authorize: async () => Response.json(session()), rpc: reader, markets });
    const overview = await (await overviewHandler(request())).json();
    expect(overview.discovery).toMatchObject({ candidateCount: 1, verifiedCount: 1 });
    expect(overview.opportunities.map((entry: { market: { id: string } }) => entry.market.id)).toEqual([market.marketId]);
    expect(overview.positions.map((entry: { market: { id: string } }) => entry.market.id)).toEqual([market.marketId]);
    expect(overview.lending.opportunities.map((entry: { market: { id: string } }) => entry.market.id)).toEqual([market.marketId, lendOnlyMarket.marketId]);
    expect(overview.lending.positions.map((entry: { market: { id: string } }) => entry.market.id)).toEqual([market.marketId, lendOnlyMarket.marketId]);
    expect(reads).toEqual([market.marketId, lendOnlyMarket.marketId]);

    const detailHandler = createBorrowMarketHandler({ authorize: async () => Response.json(session()), rpc: reader, markets });
    const detailResponse = await detailHandler(request(`/api/borrow/markets/${lendOnlyMarket.marketId}`), { params: Promise.resolve({ marketId: lendOnlyMarket.marketId }) });
    const detail = await detailResponse.json();
    expect(detailResponse.status).toBe(200);
    expect(detail).not.toHaveProperty("eligibility");
    expect(detail.lending).toMatchObject({ version: "1", mode: "enabled", canSupply: true, canWithdraw: true });
  });

  test("returns versioned Borrow detail only for a configured market", async () => {
    const handler = createBorrowMarketHandler({ authorize: async () => Response.json(session()), rpc: rpc(async (_owner, ref) => snapshot(ref)), markets: [market] });
    const ok = await handler(request(`/api/borrow/markets/${market.marketId}`), { params: Promise.resolve({ marketId: market.marketId }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).eligibility).toMatchObject({ mode: "enabled" });
    const missing = await handler(request("/api/borrow/markets/0xdead"), { params: Promise.resolve({ marketId: "0xdead" }) });
    expect(missing.status).toBe(404);
  });

  test("relays authentication failure without reading chain state", async () => {
    let reads = 0;
    const handler = createBorrowHandler({ authorize: async () => Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }), rpc: rpc(async () => { reads += 1; return snapshot(); }) });
    expect((await handler(request())).status).toBe(401);
    expect(reads).toBe(0);
  });
});
