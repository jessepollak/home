import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER, type VerifiedAccountSession } from "@/shared/account/session-types";
import { DEFAULT_BORROW_MARKET } from "@/shared/borrowing/config";
import type { BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import { createBorrowHandler, createBorrowMarketHandler } from "./handler";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import type { BorrowRpcReader } from "./rpc";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as const;
const market = DEFAULT_BORROW_MARKET;
function session(): VerifiedAccountSession { return { user: { subject: "borrow-test-user" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" }; }
function snapshot(): BorrowMarketSnapshot {
  return {
    version: "1", chainId: 8453, walletAddress: OWNER,
    market: { id: market.marketId, morpho: market.morpho, loanToken: market.loanToken, collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm, lltvWad: market.lltvWad.toString(), rank: market.rank },
    eligibility: { mode: "enabled", newRisk: true, reason: null },
    source: { provider: "Base JSON-RPC", blockNumber: "100", blockHash: BLOCK_HASH, blockTimestamp: "1789329600", fetchedAt: "2026-09-13T12:00:00.000Z" },
    state: { oraclePriceRaw: "1", borrowRatePerSecondWad: "0", borrowAprWad: "0", totalSupplyAssetsRaw: "2", totalBorrowAssetsRaw: "1", totalBorrowSharesRaw: "1", liquidityAssetsRaw: "1", lastUpdateTimestamp: "1" },
    wallet: { collateralBalanceRaw: "1", loanBalanceRaw: "1", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: { collateralRaw: "1", borrowSharesRaw: "1", debtAssetsRaw: "1", rawBorrowCapacityAssetsRaw: "1", borrowCapacityAssetsRaw: "0", rawWithdrawableCollateralRaw: "0", withdrawableCollateralRaw: "0", healthFactorWad: "1", liquidationPriceRaw: "1" },
  };
}
function request(path = "/api/borrow") { return new Request(`https://home.test${path}`, { headers: { [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" } }); }
function rpc(readSnapshot: BorrowRpcReader["readSnapshot"]): BorrowRpcReader { return { readSnapshot, simulateBatch: async () => {} }; }

describe("borrow API handlers", () => {
  test("returns a versioned private overview with configured opportunity and verified position", async () => {
    const handler = createBorrowHandler({ authorize: async () => Response.json(session()), rpc: rpc(async () => snapshot()), now: () => new Date("2026-09-13T12:00:00.000Z") });
    const response = await handler(request());
    const value = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(value).toMatchObject({ version: "1", owner: { address: OWNER }, discovery: { status: "complete", verifiedCount: 1 } });
    expect(value.opportunities).toHaveLength(1);
    expect(value.positions).toHaveLength(1);
  });

  test("represents an RPC failure as unavailable and emits redacted bounded observability", async () => {
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
      expect(JSON.stringify(value.opportunities[0])).not.toContain("collateralRaw");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        kind: "borrow-overview",
        route: "/api/borrow",
        code: "BORROW_MARKET_READ_UNAVAILABLE",
        outcome: "unavailable",
        provider: "base-rpc",
      });
      expect(lines[0]).not.toContain(OWNER);
      expect(lines[0]).not.toContain(market.marketId);
      expect(lines[0]).not.toContain("amount");
      expect(lines[0]).not.toContain("calldata");
    } finally {
      setObservabilityLogWriterForTests();
    }
  });

  test("returns versioned detail only for a configured market", async () => {
    const handler = createBorrowMarketHandler({ authorize: async () => Response.json(session()), rpc: rpc(async (_owner, ref) => { expect(ref.marketId).toBe(market.marketId); return snapshot(); }) });
    const ok = await handler(request(`/api/borrow/markets/${market.marketId}`), { params: Promise.resolve({ marketId: market.marketId }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(snapshot());
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
