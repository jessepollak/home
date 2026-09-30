import { expect, test } from "bun:test";
import { BORROW_MARKETS } from "../../shared/borrowing/config";
import { parseBorrowOverview } from "../../shared/borrowing/contract";
import { parseMarketPricesResponse } from "../../shared/invest/contracts/market-prices";
import { sessionBody } from "../../tests/browser/fixtures/bodies";
import { performanceBorrowOverview, performanceMarketPrices } from "./fixtures";

test("performance market-prices fixture passes the client contract", () => {
  const parsed = parseMarketPricesResponse(performanceMarketPrices);
  expect(parsed?.version).toBe(1);
  expect(parsed?.markets).toEqual({ stock: { status: "unavailable" }, crypto: { status: "unavailable" }, meme: { status: "unavailable" } });
  expect(parseMarketPricesResponse({ ...performanceMarketPrices, version: 0 })).toBeNull();
});

test("performance borrow fixture covers every configured market as an unavailable read", () => {
  const owner = sessionBody.smartAccount.address as `0x${string}`;
  const parsed = parseBorrowOverview(performanceBorrowOverview, owner);
  expect(BORROW_MARKETS.length).toBeGreaterThan(1);
  expect(parsed?.opportunities).toHaveLength(BORROW_MARKETS.length);
  expect(parsed?.opportunities.map((entry) => entry.market.id))
    .toEqual(BORROW_MARKETS.map((market) => market.marketId));
  expect(parsed?.opportunities.every((entry) => entry.availability.status === "unavailable")).toBe(true);
  expect(parsed?.discovery.status).toBe("partial");
  expect(parseBorrowOverview(performanceBorrowOverview, "0x2222222222222222222222222222222222222222")).toBeNull();
});
