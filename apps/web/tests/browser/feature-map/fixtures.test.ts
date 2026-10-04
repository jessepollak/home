import { expect, test } from "bun:test";
import { parseCardSpendingResponse } from "../../../shared/cards/allowance-contract";
import { FIXED_NOW } from "../fixtures/fixed-time";
import { fixtureRoutes } from "./fixtures";
import { matches } from "../../../scripts/device-profile/proxy";
import { parseActivityOrders } from "../../../shared/activity/contract-orders";
import { sessionBody } from "../fixtures/bodies";

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
