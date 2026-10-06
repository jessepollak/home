import { expect, test, type Page } from "@playwright/test";
import { hashKey, type DehydratedState } from "@tanstack/react-query";
import type { BalancesSnapshot } from "../../shared/balances/types";
import { decodeOwnerCache } from "../../client/query/owner-cache-codec";
import { ownerQueryMeta, ownerQueryPersistThrottleMs } from "../../client/query/query-client";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";
import { balancesSnapshot } from "./fixtures/balances";
import { FIXED_NOW } from "./fixtures/fixed-time";
import { readIndexedOwnerCache, replaceIndexedOwnerCache } from "./fixtures/owner-cache";

type OwnerCache = { timestamp: number; clientState: DehydratedState };

async function waitForSettledPersistedBalances(page: Page) {
  let previousQueries: string | null = null;
  await expect.poll(async () => {
    const value = await readIndexedOwnerCache(page);
    const persisted: OwnerCache | null = value ? JSON.parse(await decodeOwnerCache(value)) : null;
    const persistedQueries = persisted?.clientState.queries;
    const queries = persistedQueries?.some((query) => query.queryKey[1] === "balances")
      ? JSON.stringify(persistedQueries) : null;
    const settled = queries !== null && queries === previousQueries;
    previousQueries = queries;
    return settled;
  }, { intervals: [ownerQueryPersistThrottleMs + 100] }).toBe(true);
}

test("a reload keeps the post-action balance qualifier until a proving read clears it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page, { clock: "playwright" });
  const base = balancesSnapshot("US");
  const beforeSettlement: BalancesSnapshot = {
    ...base, stale: undefined, fetchedAt: new Date(FIXED_NOW).toISOString(),
    block: { ...base.block, number: "35123456", timestamp: String(FIXED_NOW / 1_000) },
  };
  const proving = {
    ...beforeSettlement, fetchedAt: new Date(FIXED_NOW + 1).toISOString(),
    block: { ...beforeSettlement.block, number: "35123457" },
  };
  let snapshot = beforeSettlement;
  await page.route("**/api/balances**", (route) => route.fulfill({ json: snapshot }));
  await page.goto("/home");
  await expect(page.getByLabel("Total balance")).toContainText("$91.55");
  await waitForSettledPersistedBalances(page);

  const value = await readIndexedOwnerCache(page);
  if (!value) throw new Error("Persisted owner cache is missing");
  const persisted: OwnerCache = JSON.parse(await decodeOwnerCache(value));
  const balances = persisted.clientState.queries.find((query) => query.queryKey[1] === "balances" && query.queryKey[2] === "US");
  const ownerKey = balances?.queryKey[0];
  if (!balances || typeof ownerKey !== "string") throw new Error("Persisted US balances are missing");
  balances.state = { ...balances.state, data: beforeSettlement, dataUpdatedAt: FIXED_NOW, isInvalidated: false };
  const markerKey = [ownerKey, "balances-action"];
  const marker = { at: FIXED_NOW, fresh: {}, settledBlock: "35123457", settledActionId: "action-a" };
  persisted.clientState.queries = persisted.clientState.queries.filter((query) => query.queryKey[1] !== "balances-action");
  persisted.clientState.queries.push({
    queryKey: markerKey, queryHash: hashKey(markerKey), meta: ownerQueryMeta(ownerKey, "owner"),
    state: { ...balances.state, data: marker },
  });
  await replaceIndexedOwnerCache(page, value, JSON.stringify(persisted));

  await page.goto("/cash");
  const savings = page.getByRole("region", { name: "Savings", exact: true });
  const qualifier = savings.getByText("May be out of date", { exact: true });
  await expect(qualifier).toBeVisible();
  await page.clock.fastForward(6 * 60_000);
  await expect(qualifier).toBeVisible();
  await waitForSettledPersistedBalances(page);

  await page.reload();
  await expect(qualifier).toBeVisible();
  await waitForSettledPersistedBalances(page);

  snapshot = proving;
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/balances");
  await page.reload();
  await response;
  await expect(savings.getByRole("button", { name: /^US dollar / })).toBeVisible();
  await expect(qualifier).toHaveCount(0);
});
