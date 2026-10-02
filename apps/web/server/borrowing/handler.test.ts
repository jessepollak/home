import { readJson } from "@/tests/helpers/read-json";
import { parseHash32 } from "@/shared/chain/hex";
import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import { BORROW_MARKETS, type BorrowMarketRef } from "@/shared/borrowing/config";
import { resolveProductOffering } from "@/shared/operator-settings/products";
import { parseBorrowOverview, parseSnapshot, type BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import { createBorrowHandler, createBorrowMarketHandler } from "./handler";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import type { BorrowRpcReader } from "./rpc";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = parseHash32(`0x${"ab".repeat(32)}`)!;
function session(): VerifiedAccountSession { return { user: { subject: "borrow-test-user" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }; }
function snapshot(ref: BorrowMarketRef): BorrowMarketSnapshot {
  return {
    version: "1", chainId: 8453, walletAddress: OWNER,
    market: { id: ref.marketId, morpho: ref.morpho, loanToken: ref.loanToken, collateralToken: ref.collateralToken, oracle: ref.oracle, irm: ref.irm, lltvWad: ref.lltvWad.toString(), rank: ref.rank },
    eligibility: { mode: ref.availability, newRisk: ref.availability === "enabled", reason: null },
    source: { provider: "Base JSON-RPC", blockNumber: "100", blockHash: BLOCK_HASH, blockTimestamp: "1789329600", fetchedAt: "2026-09-24T12:00:00.000Z" },
    state: { oraclePriceRaw: "1", borrowRatePerSecondWad: "0", borrowAprWad: "0", totalSupplyAssetsRaw: "2", totalBorrowAssetsRaw: "1", totalBorrowSharesRaw: "1", liquidityAssetsRaw: "1", lastUpdateTimestamp: "1" },
    wallet: { collateralBalanceRaw: "1", loanBalanceRaw: "1", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: { collateralRaw: "1", borrowSharesRaw: "1", debtAssetsRaw: "1", rawBorrowCapacityAssetsRaw: "1", borrowCapacityAssetsRaw: "0", rawWithdrawableCollateralRaw: "0", withdrawableCollateralRaw: "0", healthFactorWad: "1", liquidationPriceRaw: "1" },
  };
}
function request(path = "/api/borrow") { return new Request(`https://home.test${path}`, { headers: { [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" } }); }
function rpc(options: { fail?: number; blockFailure?: boolean } = {}): BorrowRpcReader {
  return {
    readSnapshots: async (_owner, markets) => {
      if (options.blockFailure) throw new Error("reorg");
      return markets.map((market, index) => index === options.fail
        ? { market, error: new Error("invalid market") } : { market, snapshot: snapshot(market) });
    },
    readSnapshot: async (_owner, market) => snapshot(market),
    simulateBatch: async () => {},
  };
}

describe("borrow API handlers", () => {
  test("reads all five in one operation and emits parseable v2 snapshots from one block", async () => {
    const response = await createBorrowHandler({ authorize: async () => Response.json(session()), rpc: rpc(), now: () => new Date("2026-09-24T12:00:00.000Z") })(request());
    const value = await readJson(response);
    const parsed = parseBorrowOverview(value, OWNER);
    if (!parsed) throw new Error("Invalid borrowing overview");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(value).toMatchObject({ version: "2", owner: { address: OWNER }, discovery: { status: "complete", candidateCount: 5, verifiedCount: 5, sourceBlock: { blockNumber: "100", blockHash: BLOCK_HASH } } });
    expect(parsed.opportunities).toHaveLength(5);
    expect(parsed.positions).toHaveLength(5);
    expect(parsed.opportunities.map((entry) => entry.availability.status === "available" ? entry.availability.snapshot.market.id : null)).toEqual(BORROW_MARKETS.map((market) => market.marketId));
  });

  test("projects paused and unavailable markets as reducing-only without widening compiled capabilities", async () => {
    const deployment = resolveProductOffering({ kind: "deployment" });
    const paused = resolveProductOffering({ kind: "saved", value: { products: { ...deployment.products, borrow: "exit-only" }, vaults: deployment.vaults, markets: deployment.markets } });
    const result = await createBorrowHandler({ authorize: async () => Response.json(session()), rpc: rpc(), readOffering: async () => paused })(request());
    const value = await result.json();
    for (const opportunity of value.opportunities) {
      expect(opportunity.availability).toMatchObject({ mode: "reducing-only", snapshot: { eligibility: { mode: "reducing-only", newRisk: false } } });
    }
    expect(parseBorrowOverview(value, OWNER)).not.toBeNull();
    const unavailable = await (await createBorrowHandler({ authorize: async () => Response.json(session()), rpc: rpc(), readOffering: async () => { throw new Error("db outage"); } })(request())).json();
    expect(unavailable.opportunities.every((item: { availability: { mode: string } }) => item.availability.mode === "reducing-only")).toBe(true);
    expect(parseBorrowOverview(unavailable, OWNER)).not.toBeNull();
  });

  test("isolates a failed market and emits redacted observability", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    try {
      const response = await createBorrowHandler({ authorize: async () => Response.json(session()), rpc: rpc({ fail: 2 }) })(request());
      const value = await readJson(response);
      const parsed = parseBorrowOverview(value, OWNER);
      if (!parsed) throw new Error("Invalid borrowing overview");
      expect(parsed.discovery).toMatchObject({ status: "partial", verifiedCount: 4, sourceBlock: { blockNumber: "100" } });
      expect(parsed.opportunities[2].availability).toMatchObject({ status: "unavailable", source: null });
      expect(parsed.opportunities[2].availability).not.toHaveProperty("snapshot");
      expect(parsed.positions).toHaveLength(4);
        expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ kind: "borrow-overview", code: "BORROW_MARKET_READ_UNAVAILABLE", provider: "base-rpc" });
      expect(lines[0]).not.toContain(OWNER);
    } finally { setObservabilityLogWriterForTests(); }
  });

  test("makes every market unavailable on block failure without inventing a common source", async () => {
    const value = await readJson((await createBorrowHandler({ authorize: async () => Response.json(session()), rpc: rpc({ blockFailure: true }) })(request())));
    const parsed = parseBorrowOverview(value, OWNER);
    if (!parsed) throw new Error("Invalid borrowing overview");
    expect(parsed.discovery).toMatchObject({ status: "partial", verifiedCount: 0, sourceBlock: null });
    expect(parsed.positions).toEqual([]);
  });

  test("market detail uses the same reducing-only projection as the overview", async () => {
    const market = BORROW_MARKETS.find((item) => item.availability === "enabled");
    if (!market) throw new Error("Expected an enabled borrow market fixture.");
    const handler = createBorrowMarketHandler({ authorize: async () => Response.json(session()), rpc: rpc(), readOffering: async () => resolveProductOffering({ kind: "unavailable" }) });
    const detail = await (await handler(request(`/api/borrow/markets/${market.marketId}`), { params: Promise.resolve({ marketId: market.marketId }) })).json();
    expect(detail.eligibility).toMatchObject({ mode: "reducing-only", newRisk: false });
    expect(parseSnapshot(detail, OWNER)).not.toBeNull();
  });

  test("returns detail only for a configured market and never reads without authentication", async () => {
    const handler = createBorrowMarketHandler({ authorize: async () => Response.json(session()), rpc: rpc() });
    const market = BORROW_MARKETS[3];
    const ok = await handler(request(`/api/borrow/markets/${market.marketId}`), { params: Promise.resolve({ marketId: market.marketId }) });
    expect(ok.status).toBe(200);
    expect(await readJson(ok)).toEqual(snapshot(market));
    const missing = await handler(request("/api/borrow/markets/0xdead"), { params: Promise.resolve({ marketId: "0xdead" }) });
    expect(missing.status).toBe(404);
    let reads = 0;
    const denied = createBorrowHandler({ authorize: async () => Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }), rpc: { ...rpc(), readSnapshots: async () => { reads++; return []; } } });
    expect((await denied(request())).status).toBe(401);
    expect(reads).toBe(0);
  });
});
