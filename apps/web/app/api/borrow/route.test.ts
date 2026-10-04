import { describe, expect, test } from "bun:test";
import { createBorrowHandler, createBorrowMarketHandler } from "@/server/borrowing/handler";
import type { BorrowRpcReader } from "@/server/borrowing/rpc";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { parseBorrowOverview, parseSnapshot, type BorrowMarketSnapshot } from "@/shared/borrowing/contract";
import { resolveProductOffering } from "@/shared/operator-settings/products";
import { borrowOverviewBody, sessionBody } from "@/tests/browser/fixtures/bodies";
import { readJson } from "@/tests/helpers/read-json";

const fixture = borrowOverviewBody({ openMarketId: null });
const OWNER = fixture.owner.address;
const now = () => new Date("2026-09-24T12:00:00.000Z");
const authorize = async () => Response.json(sessionBody);
const readOffering = async () => resolveProductOffering({ kind: "deployment" });
function request(path = "/api/borrow") {
  return new Request(`https://home.test${path}`, { headers: { [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded" } });
}
function snapshot(marketId: string): BorrowMarketSnapshot {
  const opportunity = fixture.opportunities.find((entry) => entry.market.id === marketId);
  if (opportunity?.availability.status !== "available") throw new Error("Expected a verified fixture snapshot");
  return structuredClone(opportunity.availability.snapshot);
}
function rpc(failedMarket?: string): BorrowRpcReader {
  return {
    readSnapshots: async (_owner, markets) => markets.map((market) => market.marketId === failedMarket
      ? { market, error: new Error("unreadable market") } : { market, snapshot: snapshot(market.marketId) }),
    readSnapshot: async (_owner, market) => {
      if (market.marketId === failedMarket) throw new Error("unreadable market");
      return snapshot(market.marketId);
    },
    simulateBatch: async () => {},
  };
}

describe("borrowing handler contract round-trips", () => {
  test("overview keeps verified zero balances and unknown health rather than conflating them", async () => {
    const response = await createBorrowHandler({ authorize, rpc: rpc(), now, readOffering })(request());
    const parsed = parseBorrowOverview(await readJson(response), OWNER);
    if (!parsed) throw new Error("Expected a parseable overview");
    expect(response.status).toBe(200);
    expect(parsed.version).toBe("2");
    expect(parsed.discovery.status).toBe("complete");
    expect(parsed.positions).toEqual([]);
    for (const entry of parsed.opportunities) {
      if (entry.availability.status !== "available") throw new Error("Expected a verified market");
      expect(entry.availability.snapshot.position).toMatchObject({ collateralRaw: "0", debtAssetsRaw: "0", healthFactorWad: null, liquidationPriceRaw: null });
    }
    expect(parseBorrowOverview(JSON.parse(JSON.stringify(parsed)), OWNER)).toEqual(parsed);
  });

  test("detail handlers for every configured market preserve nullable unknown versus measured zero", async () => {
    const reader = rpc();
    reader.readSnapshot = async (_owner, market) => {
      const value = snapshot(market.marketId);
      if (market.marketId === BORROW_MARKETS[0].marketId) value.position.healthFactorWad = "0";
      return value;
    };
    const handler = createBorrowMarketHandler({ authorize, rpc: reader, readOffering });
    for (const market of BORROW_MARKETS) {
      const response = await handler(request(`/api/borrow/markets/${market.marketId}`), { params: Promise.resolve({ marketId: market.marketId }) });
      const parsed = parseSnapshot(await readJson(response), OWNER);
      if (!parsed) throw new Error("Expected a parseable market detail");
      expect(response.status).toBe(200);
      expect(parsed.version).toBe("1");
      expect(parsed.position.debtAssetsRaw).toBe("0");
      expect(parsed.position.healthFactorWad).toBe(market.marketId === BORROW_MARKETS[0].marketId ? "0" : null);
      expect(parsed.position.liquidationPriceRaw).toBeNull();
      expect(parseSnapshot(JSON.parse(JSON.stringify(parsed)), OWNER)).toEqual(parsed);
    }
  });

  test("a failed market stays unavailable alongside a verified zero position", async () => {
    const response = await createBorrowHandler({ authorize, rpc: rpc(BORROW_MARKETS[1].marketId), now, readOffering })(request());
    const parsed = parseBorrowOverview(await readJson(response), OWNER);
    if (!parsed) throw new Error("Expected a parseable partial overview");
    expect(response.status).toBe(200);
    expect(parsed.discovery).toMatchObject({ status: "partial", candidateCount: 5, verifiedCount: 4 });
    expect(parsed.opportunities[1].availability).toMatchObject({ status: "unavailable", source: null });
    expect(parsed.opportunities[1].availability).not.toHaveProperty("snapshot");
    const verified = parsed.opportunities[0].availability;
    if (verified.status !== "available") throw new Error("Expected a verified market");
    expect(verified.snapshot.position.debtAssetsRaw).toBe("0");
    expect(parseBorrowOverview(JSON.parse(JSON.stringify(parsed)), OWNER)).toEqual(parsed);
  });

  test("an unreadable shared block preserves a partial null-source overview", async () => {
    const reader = rpc();
    reader.readSnapshots = async () => { throw new Error("unreadable source block"); };
    const response = await createBorrowHandler({ authorize, rpc: reader, now, readOffering })(request());
    const parsed = parseBorrowOverview(await readJson(response), OWNER);
    if (!parsed) throw new Error("Expected a parseable unavailable overview");
    expect(response.status).toBe(200);
    expect(parsed.discovery).toMatchObject({ status: "partial", verifiedCount: 0, sourceBlock: null });
    expect(parsed.positions).toEqual([]);
    for (const entry of parsed.opportunities) {
      expect(entry.availability.status).toBe("unavailable");
      expect(entry.availability.source).toBeNull();
      expect(entry.availability).not.toHaveProperty("snapshot");
    }
    expect(parseBorrowOverview(JSON.parse(JSON.stringify(parsed)), OWNER)).toEqual(parsed);
  });

  test("unreadable detail returns an error, not a zero-valued snapshot", async () => {
    const marketId = BORROW_MARKETS[0].marketId;
    const response = await createBorrowMarketHandler({ authorize, rpc: rpc(marketId), readOffering })(request(), { params: Promise.resolve({ marketId }) });
    const value = await readJson(response);
    expect(response.status).toBe(502);
    expect(value).toMatchObject({ error: { code: "BORROW_STATE_UNAVAILABLE" } });
    expect(parseSnapshot(value, OWNER)).toBeNull();
  });

  test.each(["0xdead", `0x${"zz".repeat(32)}`, `0x${"00".repeat(32)}`])("rejects unconfigured market %s before RPC", async (marketId) => {
    let reads = 0;
    const reader = rpc();
    reader.readSnapshot = async () => { reads++; throw new Error("unexpected read"); };
    const response = await createBorrowMarketHandler({ authorize, rpc: reader, readOffering })(request(), { params: Promise.resolve({ marketId }) });
    const value = await readJson(response);
    expect(response.status).toBe(404);
    expect(value).toMatchObject({ error: { code: "BORROW_MARKET_NOT_FOUND" } });
    expect(reads).toBe(0);
    expect(parseSnapshot(value, OWNER)).toBeNull();
  });
});
