import { describe, expect, test } from "bun:test";
import { DEFAULT_VERIFIED_MORPHO_MARKET } from "@/shared/morpho-markets/config";
import { parseLendingMarketDetailResponse, parseLendingOverviewResponse } from "./contract";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const market = DEFAULT_VERIFIED_MORPHO_MARKET;
const source = { provider: "Base JSON-RPC", blockNumber: "1", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1", fetchedAt: "2026-09-14T00:00:00.000Z" } as const;
const identity = { id: market.marketId, morpho: market.morpho, loanToken: market.loanToken, collateralToken: market.collateralToken, oracle: market.oracle, irm: market.irm, lltvWad: market.lltvWad.toString(), rank: market.rank };
const state = { totalSupplyAssetsRaw: "10", totalSupplySharesRaw: "10", totalBorrowAssetsRaw: "5", liquidityAssetsRaw: "5", feeWad: "0", utilizationWad: "500000000000000000", supplyAprWad: "1" };

describe("lending API contract", () => {
  test("parses the additive owner-fenced overview without treating Borrow positions as lending positions", () => {
    const response = {
      version: "1", chainId: 8453, owner: { address: OWNER, accountProvider: "cdp-embedded" },
      discovery: {}, opportunities: [], positions: [{ debtAssetsRaw: "5" }],
      lending: {
        version: "1",
        opportunities: [{ market: identity, availability: { status: "available", mode: "enabled", canSupply: true, canWithdraw: true, reason: null, source, state } }],
        positions: [{ market: identity, source, supplySharesRaw: "2", suppliedAssetsRaw: "2", withdrawableAssetsRaw: "2" }],
      },
    };
    expect(parseLendingOverviewResponse(response, OWNER)?.positions[0]?.supplySharesRaw).toBe("2");
    expect(parseLendingOverviewResponse(response, "0x2222222222222222222222222222222222222222")).toBeNull();
    expect(parseLendingOverviewResponse({ ...response, lending: { ...response.lending, positions: [{ ...response.lending.positions[0], market: { ...identity, id: `0x${"12".repeat(32)}` } }] } }, OWNER)).toBeNull();
  });

  test("parses additive detail and rejects fabricated unavailable zero state", () => {
    const response = {
      version: "1", chainId: 8453, walletAddress: OWNER, market: identity,
      lending: { version: "1", mode: "enabled", canSupply: true, canWithdraw: false, reason: null, state, position: { supplySharesRaw: "0", suppliedAssetsRaw: "0", withdrawableAssetsRaw: "0" } },
    };
    expect(parseLendingMarketDetailResponse(response, OWNER)).not.toBeNull();
    expect(parseLendingMarketDetailResponse({ ...response, lending: { ...response.lending, state: null } }, OWNER)).toBeNull();
  });
});
