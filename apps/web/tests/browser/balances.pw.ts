import { expect, test, type Page } from "@playwright/test";
import type { RegionId } from "../../config/regions";
import { ownerQueryPersistThrottleMs } from "../../client/query/query-client";
import { scrollableBalancesSnapshot } from "./fixtures/balances";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { trackHydrationErrors } from "./fixtures/hydration-errors";

const BALANCES_PAINTED_BUDGET_MS = process.env.CI ? 3_500 : 1_000;

async function visibleBalanceRowLayout(page: Page) {
  return page.locator(
    '[data-shell-panel]:not([hidden]) [data-balance-list] [data-kind="balance"]',
  ).evaluateAll((rows) => rows.map((row) => {
    const bounds = row.getBoundingClientRect();
    return {
      text: row.textContent?.replace(/\s+/g, " ").trim() ?? "",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }));
}

function countVisibleBalanceRows() {
  return document.querySelectorAll(
    '[data-shell-panel]:not([hidden]) [data-balance-list] [data-kind="balance"]',
  ).length;
}

async function openScrolledBalances(page: Page) {
  await seedSignedInSession(page);
  await installApiFixtures(page, { balances: scrollableBalancesSnapshot() });
  await page.setViewportSize({ width: 390, height: 440 });
  await page.goto("/balances");
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBeGreaterThanOrEqual(10);
  const freshCount = await page.evaluate(countVisibleBalanceRows);
  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("[data-app-main-authenticated]");
    return main ? main.scrollHeight - main.clientHeight : 0;
  })).toBeGreaterThan(0);
  const maxTop = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("[data-app-main-authenticated]");
    return main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0;
  });
  const target = await page.evaluate((max) => {
    const main = document.querySelector<HTMLElement>("[data-app-main-authenticated]");
    if (!main) return 0;
    main.scrollTop = Math.min(max, Math.max(240, Math.round(max * 0.6)));
    main.dispatchEvent(new Event("scroll", { bubbles: true }));
    return main.scrollTop;
  }, maxTop);
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBeGreaterThan(freshCount);
  return {
    target,
    maxTop,
    freshCount,
    revealedCount: await page.evaluate(countVisibleBalanceRows),
  };
}

async function openInvestAssetDetail(page: Page) {
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page).toHaveURL(/\/invest$/);
  await page.getByRole("button", { name: /^NVIDIA/ }).click();
  await expect(page).toHaveURL(/\/invest\/nvdac$/);
}

async function expectBalancesRestored(
  page: Page,
  state: { target: number; maxTop: number; revealedCount: number },
) {
  await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.querySelector<HTMLElement>("[data-app-main-authenticated]")?.scrollTop ?? 0,
  )).toBe(state.target);
  expect(state.target).toBeLessThanOrEqual(state.maxTop);
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBe(state.revealedCount);
}

function anchoredGroupOffset(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("[data-app-main-authenticated]");
    const group = document.getElementById("investments");
    return main && group && main.scrollTop > 0
      ? group.getBoundingClientRect().top - main.getBoundingClientRect().top
      : null;
  });
}

async function waitForSettledPersistedBalances(page: Page) {
  let previousQueries: string | null = null;
  await expect.poll(async () => {
    const queries = await page.evaluate(() => {
      const key = Object.keys(localStorage)
        .find((candidate) => candidate.startsWith("home.query.v1:"));
      if (!key) return null;
      const persisted = JSON.parse(localStorage.getItem(key) ?? "null") as {
        clientState?: { queries?: Array<{ queryKey?: unknown[] }> };
      } | null;
      const persistedQueries = persisted?.clientState?.queries;
      if (!persistedQueries?.some((query) => query.queryKey?.[1] === "balances")) return null;
      return JSON.stringify(persistedQueries);
    });
    const settled = queries !== null && queries === previousQueries;
    previousQueries = queries;
    return settled;
  }, { intervals: [ownerQueryPersistThrottleMs + 100] }).toBe(true);
}

async function markPersistedQueriesStale(page: Page) {
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("home.query.v1:"));
    if (!key) throw new Error("Persisted owner cache is missing");
    const persisted = JSON.parse(localStorage.getItem(key) ?? "null") as {
      clientState?: { queries?: Array<{ state?: { dataUpdatedAt?: number } }> };
    };
    for (const query of persisted.clientState?.queries ?? []) {
      if (query.state) query.state.dataUpdatedAt = Date.now() - 60_000;
    }
    localStorage.setItem(key, JSON.stringify(persisted));
  });
}

test("persisted balances paint before verification and settle without row shift", async ({ page }) => {
  await seedSignedInSession(page);
  const fixtures = await installApiFixtures(page);
  await page.goto("/home");
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName("balances:painted", "mark").length,
  )).toBeGreaterThan(0);
  const coldPaint = await page.evaluate(() =>
    performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Number.POSITIVE_INFINITY,
  );
  expect(coldPaint).toBeLessThan(BALANCES_PAINTED_BUDGET_MS);
  await waitForSettledPersistedBalances(page);
  await markPersistedQueriesStale(page);
  const hydrationErrors = trackHydrationErrors(page);
  const sessionObserved = fixtures.delayNextSession();
  const balancesObserved = fixtures.delayNextBalances();
  const balancesReadsBeforeReload = fixtures.balancesReads();

  await page.reload();
  await sessionObserved;
  await expect(page.getByText("Recognized Coin", { exact: true }).first()).toBeVisible();
  expect(fixtures.balancesReads()).toBe(balancesReadsBeforeReload);
  const provisionalLayout = await visibleBalanceRowLayout(page);
  const provisionalPaint = await page.evaluate(() => ({
    balances: performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Infinity,
    verified: performance.getEntriesByName("session:verified", "mark")[0]?.startTime ?? Infinity,
  }));
  expect(provisionalPaint.balances).toBeLessThan(coldPaint);
  expect(provisionalPaint.balances).toBeLessThan(provisionalPaint.verified);

  fixtures.releaseSession();
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName("session:verified", "mark").length,
  )).toBeGreaterThan(0);
  await balancesObserved;
  fixtures.releaseBalances();
  await expect(page.locator('[data-shell-panel]:not([hidden]) [aria-label="Total balance"]'))
    .not.toHaveAttribute("aria-busy", "true");
  expect(await visibleBalanceRowLayout(page)).toEqual(provisionalLayout);
  expect(hydrationErrors).toEqual([]);
});

test("browser Back restores the Balances reveal and scroll offset", async ({ page }) => {
  const state = await openScrolledBalances(page);
  await openInvestAssetDetail(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/invest$/);
  await page.goBack();
  await expectBalancesRestored(page, state);
});

test("generic destination resets Balances to the top on browser Back", async ({ page }) => {
  const state = await openScrolledBalances(page);
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page).toHaveURL(/\/invest$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.querySelector<HTMLElement>("[data-app-main-authenticated]")?.scrollTop ?? 0,
  )).toBe(0);
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBe(state.freshCount);
});

test("cold and revalidated cached Balances stay anchored to the requested group", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  let serveChanged = false;
  let releaseChanged = () => {};
  const changedResponse = new Promise<void>((resolve) => { releaseChanged = resolve; });
  let revalidatedReads = 0;
  await installApiFixtures(page, { balances: scrollableBalancesSnapshot() });
  await page.route((url) => url.pathname === "/api/balances", async (route) => {
    const region = (new URL(route.request().url()).searchParams.get("region") ?? "US") as RegionId;
    const snapshot = scrollableBalancesSnapshot(region);
    if (!serveChanged) return json(route, snapshot);
    revalidatedReads += 1;
    await changedResponse;
    return json(route, {
      ...snapshot,
      holdings: snapshot.holdings.map((holding) => holding.symbol === "USDC"
        ? {
            ...holding,
            ...(holding.value.status === "priced"
              ? { value: { ...holding.value, amount: { atoms: "1235", scale: 2 } } }
              : {}),
            ...(holding.cashValue?.status === "priced"
              ? { cashValue: { ...holding.cashValue, amount: { atoms: "1235", scale: 2 } } }
              : {}),
          }
        : holding),
    });
  });

  await page.goto("/balances/investments");
  await expect.poll(() => anchoredGroupOffset(page)).toBeGreaterThanOrEqual(14);
  await waitForSettledPersistedBalances(page);
  await markPersistedQueriesStale(page);

  serveChanged = true;
  await page.reload();
  await expect(
    page.locator('[data-shell-panel]:not([hidden]) li', { hasText: "$12.34" }).first(),
  ).toBeVisible();
  await expect.poll(() => anchoredGroupOffset(page)).toBeGreaterThanOrEqual(14);
  await expect.poll(() => revalidatedReads).toBeGreaterThanOrEqual(1);
  releaseChanged();
  await expect(page.locator('[data-shell-panel]:not([hidden]) li', { hasText: "$12.35" }).first())
    .toBeVisible();
  await expect.poll(() => anchoredGroupOffset(page)).toBeGreaterThanOrEqual(14);
});
