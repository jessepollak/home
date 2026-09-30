import { expect, test } from "bun:test";
import { parseCardSpendingResponse } from "../../../shared/cards/allowance-contract";
import { FIXED_NOW } from "../fixtures/fixed-time";
import { fixtureRoutes } from "./fixtures";

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
