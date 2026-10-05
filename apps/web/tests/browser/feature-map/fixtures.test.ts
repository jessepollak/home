import { expect, test } from "bun:test";
import { parseCardSpendingResponse } from "../../../shared/cards/allowance-contract";
import { FIXED_NOW } from "../fixtures/fixed-time";
import { fixtureRoutes } from "./fixtures";
import { matches } from "../../../scripts/device-profile/proxy";
import { parseActivityPage } from "../../../shared/activity/contract";
import { parseActivityOrders } from "../../../shared/activity/contract-orders";
import { sessionBody } from "../fixtures/bodies";
import { parseAddress } from "../../../shared/chain/hex";
import { parseOperatorSupportConversationResponse, parseOperatorSupportListResponse, parseOperatorSupportSummary } from "../../../shared/support/contract";
import { operatorSupportFixtureConversationId, operatorSupportFixtureRoutes } from "./operator-support-fixture";
import { assertFundingProvidersResponse, readProviderBindings } from "../../../shared/funding/contracts/providers";
import { isRecord } from "../../../shared/guards";

test("Activity query and bare fixtures cannot shadow the owner-fenced orders route", () => {
  const routes = fixtureRoutes();
  const matching = (path: string) => routes.filter(([pattern]) => matches(pattern, `http://localhost:3199${path}`));
  expect(matching("/api/activity/orders")).toHaveLength(1);
  const body = matching("/api/activity/orders")[0]?.[1];
  expect(parseActivityOrders(body, { user: sessionBody.user, accountProvider: "cdp-embedded",
    smartAccount: { address: "0x1111111111111111111111111111111111111111", chainId: 8453 } })).toEqual([]);
  expect(matching("/api/activity?to=now&currency=USD")).toHaveLength(1);
  expect(matching("/api/activity")).toHaveLength(1);
});

test("operator support fixtures parse with the shared response contracts", () => {
  for (const [route, body] of operatorSupportFixtureRoutes()) {
    if (route.endsWith("/summary")) expect(parseOperatorSupportSummary(body)).not.toBeNull();
    else if (route.endsWith("/conversations?**")) expect(parseOperatorSupportListResponse(body)).not.toBeNull();
    else if (route.endsWith("/read")) expect(body).toEqual({});
    else {
      const detail = parseOperatorSupportConversationResponse(body);
      expect(detail).not.toBeNull();
      expect(detail?.conversation.id).toBe(operatorSupportFixtureConversationId);
      expect(detail?.conversation.messages[0]).toMatchObject({
        authorType: "customer", authorOperator: null, body: "My funding order needs help",
      });
    }
  }
});

test.each(["onramp", "offramp"] as const)("funding provider fixtures match only the requested %s direction", (direction) => {
  const routes = fixtureRoutes().filter(([pattern]) => matches(pattern, `http://localhost:3199/api/funding/providers?region=US&direction=${direction}`));
  expect(routes).toHaveLength(1);
  const body = routes[0]?.[1];
  expect(() => assertFundingProvidersResponse(body, direction, "US")).not.toThrow();
  expect(readProviderBindings(body)).toEqual([]);
});

test("card spending fixture parses with the shared response contract", () => {
  const fixture = fixtureRoutes().find(([route]) => route === "**/api/cards/spending")?.[1];
  const response = parseCardSpendingResponse(fixture);
  expect(response).not.toBeNull();
  expect(response?.status).toBe("available");
  if (response?.status === "available") {
    expect(response.fetchedAt).toBe(new Date(FIXED_NOW).toISOString());
    expect(response.availableBaseUnits).toBe("25000000");
  }
});

test("activity fixtures parse with all card purchase statuses and common decline reasons", () => {
  const routes = fixtureRoutes();
  const body = routes.find(([route]) => route === "**/api/activity")?.[1];
  if (!isRecord(body) || !("window" in body) || !isRecord(body.window) || typeof body.window.to !== "string") throw new Error("Missing activity fixture");
  expect(routes.find(([route]) => route === "**/api/activity?**")?.[1]).toBe(body);
  expect(body.window.to).toBe(new Date(Math.floor(FIXED_NOW / 60_000) * 60_000).toISOString());
  const address = parseAddress(sessionBody.smartAccount.address);
  if (!address) throw new Error("Invalid fixture smart account address");
  const session = { user: sessionBody.user, accountProvider: "cdp-embedded" as const,
    smartAccount: { address, chainId: 8453 as const } };
  const page = parseActivityPage(body, session, body.window.to, "USD");
  expect(page.cards?.status).toBe("ready");
  expect(page.cards?.rows.map((row) => row.status)).toEqual([
    "pending", "declined", "declined", "completed", "reversed", "refunded",
  ]);
  expect(page.cards?.rows.map((row) => row.declineReasonCode)).toEqual([
    null, "card_inactive", "insufficient_funds", null, null, null,
  ]);
  for (const row of page.cards?.rows ?? []) {
    expect(Date.parse(row.createdAt)).toBeGreaterThanOrEqual(Date.parse(page.window.from));
    expect(Date.parse(row.createdAt)).toBeLessThan(Date.parse(page.window.to));
  }
});
