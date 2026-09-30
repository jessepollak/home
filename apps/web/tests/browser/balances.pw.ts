import { expect, test, type Page } from "@playwright/test";
import type { RegionId } from "../../config/regions";
import { ownerQueryPersistThrottleMs } from "../../client/query/query-client";
import { scrollableBalancesSnapshot } from "./fixtures/balances";
import { FIXED_NOW } from "./fixtures/fixed-time";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { trackHydrationErrors } from "./fixtures/hydration-errors";

// The hosted-runner tier also covers an idle laptop. A loaded shared machine stretches both marks
// together, so the persisted paint may take twice the machine's own shell paint, never less than the tier.
const BALANCES_PAINTED_BUDGET_MS = 3_500;
const BALANCES_PAINTED_LOAD_FACTOR = 2;
const BALANCES_PAINTED_WAIT_MS = 15_000;
const BALANCES_FIRST_BATCH = 10;

async function visibleBalanceRowLayout(page: Page) {
  return page.locator(
    '[data-shell-panel]:not([hidden]) :is([data-balance-list], [data-money-summary]) [data-kind="balance"]',
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

async function settledBalanceRowCount(page: Page) {
  let previous = -1;
  let quiet = 0;
  let settled = -1;
  await expect.poll(async () => {
    const { count, complete } = await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-shell-panel]:not([hidden]) [data-balance-list] [data-kind="balance"]');
      return { count: rows.length, complete: document.querySelector("[data-balances-sentinel]") === null };
    });
    quiet = count === previous ? quiet + 1 : 0;
    previous = count;
    const stable = count >= BALANCES_FIRST_BATCH && (complete || quiet >= 4);
    if (stable) settled = count;
    return stable;
  }, { intervals: [250, 250, 250, 500, 1_000], timeout: 10_000, message: "the balances reveal window to settle" }).toBe(true);
  return settled;
}

async function openScrolledBalances(page: Page) {
  await seedSignedInSession(page);
  await installApiFixtures(page, { balances: scrollableBalancesSnapshot() });
  await page.setViewportSize({ width: 390, height: 440 });
  await page.goto("/balances");
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBeGreaterThanOrEqual(BALANCES_FIRST_BATCH);
  const freshCount = await settledBalanceRowCount(page);
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
    revealedCount: await settledBalanceRowCount(page),
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

async function expectBalancesPaintedWithinBudget(page: Page) {
  await expect.poll(
    () => page.evaluate(() => performance.getEntriesByName("balances:painted", "mark").length),
    { message: "the persisted balances paint mark", timeout: BALANCES_PAINTED_WAIT_MS },
  ).toBeGreaterThan(0);
  const paint = await page.evaluate(() => ({
    balances: performance.getEntriesByName("balances:painted", "mark")[0]!.startTime,
    shell: performance.getEntriesByName("shell:paint", "mark")[0]?.startTime ?? 0,
  }));
  expect(paint.balances).toBeLessThan(
    Math.max(BALANCES_PAINTED_BUDGET_MS, paint.shell * BALANCES_PAINTED_LOAD_FACTOR),
  );
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
  await page.evaluate((fixedNow) => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("home.query.v1:"));
    if (!key) throw new Error("Persisted owner cache is missing");
    const persisted = JSON.parse(localStorage.getItem(key) ?? "null") as {
      clientState?: { queries?: Array<{ state?: { dataUpdatedAt?: number } }> };
    };
    for (const query of persisted.clientState?.queries ?? []) {
      if (query.state) query.state.dataUpdatedAt = fixedNow - 60_000;
    }
    localStorage.setItem(key, JSON.stringify(persisted));
  }, FIXED_NOW);
}

test("cold balances request and paint finish before delayed session verification", async ({ page }) => {
  await seedSignedInSession(page);
  const fixtures = await installApiFixtures(page);
  const sessionObserved = fixtures.delayNextSession();
  const balancesObserved = fixtures.delayNextBalances();
  try {
    await page.goto("/home");
    await sessionObserved;
    await balancesObserved;
    expect(fixtures.balancesReads()).toBeGreaterThan(0);
    fixtures.releaseBalances();
    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByName("balances:painted", "mark").length,
    )).toBeGreaterThan(0);
    expect(await page.evaluate(() =>
      performance.getEntriesByName("session:verified", "mark").length,
    )).toBe(0);
    await expect(page.getByText("Across 2 assets", { exact: true }).first()).toBeVisible();
    fixtures.releaseSession();
    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByName("session:verified", "mark").length,
    )).toBeGreaterThan(0);
    await expect(page.locator('[data-shell-panel]:not([hidden]) [aria-label="Total balance"]'))
      .not.toHaveAttribute("aria-busy", "true");
  } finally {
    fixtures.releaseBalances();
    fixtures.releaseSession();
  }
});

test("cold Home balance value paints before delayed verification without a persisted query cache", async ({ page }) => {
  await seedSignedInSession(page);
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("home.query.v1:")) localStorage.removeItem(key);
    }
    localStorage.removeItem("home.country.v2");
    const witness = window as typeof window & { coldBalanceValueMs?: number };
    const captureBalance = () => {
      if (witness.coldBalanceValueMs !== undefined) return;
      if (document.querySelector('[aria-label="Total balance"]')?.textContent?.includes("$91.55")) {
        performance.mark("cold-balance:value");
        witness.coldBalanceValueMs = performance.getEntriesByName("cold-balance:value", "mark")[0]!.startTime;
      }
    };
    new MutationObserver(captureBalance).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const fixtures = await installApiFixtures(page);
  const sessionObserved = fixtures.delayNextSession();
  let sessionResponded = false;
  let balancesStartedBeforeSession = false;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/balances" && !sessionResponded) {
      balancesStartedBeforeSession = true;
    }
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/session") sessionResponded = true;
  });

  try {
    const balanceResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/balances");
    await page.goto("/home");
    await sessionObserved;
    await balanceResponse;
    expect(balancesStartedBeforeSession).toBe(true);
    expect(sessionResponded).toBe(false);
    await expect(page.getByLabel("Total balance")).toContainText("$91.55");
    const valueMs = await page.evaluate(() =>
      (window as typeof window & { coldBalanceValueMs?: number }).coldBalanceValueMs ?? Infinity,
    );
    expect(sessionResponded).toBe(false);
    expect(await page.evaluate(() => performance.getEntriesByName("session:verified", "mark").length)).toBe(0);
    fixtures.releaseSession();
    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByName("session:verified", "mark")[0]?.startTime ?? 0,
    )).toBeGreaterThan(0);
    expect(sessionResponded).toBe(true);
    const verifiedMs = await page.evaluate(() =>
      performance.getEntriesByName("session:verified", "mark")[0]!.startTime,
    );
    console.log(`cold Home balance value: ${valueMs.toFixed(0)}ms; verification: ${verifiedMs.toFixed(0)}ms`);
    expect(valueMs).toBeLessThan(verifiedMs);
    await expect(page.getByRole("region", { name: "Activity" }).getByRole("button", { name: /^Received / }).first()).toBeVisible();
    await expect(page.getByLabel("Total balance")).toContainText("$91.55");
    await expect(page.getByLabel("Total balance")).not.toHaveAttribute("aria-busy", "true");
  } finally {
    fixtures.releaseSession();
  }
});

test("persisted balances paint before verification and settle without row shift", async ({ page }) => {
  await seedSignedInSession(page);
  const fixtures = await installApiFixtures(page);
  await page.goto("/home");
  await expectBalancesPaintedWithinBudget(page);
  await waitForSettledPersistedBalances(page);
  await markPersistedQueriesStale(page);
  const hydrationErrors = trackHydrationErrors(page);
  const sessionObserved = fixtures.delayNextSession();
  const balancesObserved = fixtures.delayNextBalances();
  const balancesReadsBeforeReload = fixtures.balancesReads();

  await page.reload();
  await sessionObserved;
  await expect(page.getByText("Across 2 assets", { exact: true }).first()).toBeVisible();
  await balancesObserved;
  expect(fixtures.balancesReads()).toBeGreaterThan(balancesReadsBeforeReload);
  const provisionalLayout = await visibleBalanceRowLayout(page);
  await expectBalancesPaintedWithinBudget(page);
  const provisionalPaint = await page.evaluate(() => ({
    balances: performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Infinity,
    verified: performance.getEntriesByName("session:verified", "mark")[0]?.startTime ?? Infinity,
  }));
  expect(provisionalPaint.balances).toBeLessThan(provisionalPaint.verified);

  fixtures.releaseBalances();
  fixtures.releaseSession();
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName("session:verified", "mark").length,
  )).toBeGreaterThan(0);
  await expect(page.locator('[data-shell-panel]:not([hidden]) [aria-label="Total balance"]'))
    .not.toHaveAttribute("aria-busy", "true");
  expect(await visibleBalanceRowLayout(page)).toEqual(provisionalLayout);
  expect(hydrationErrors).toEqual([]);
});

test("cached Home balances paint before delayed verification and revalidation, then survive Borrow navigation", async ({ page }) => {
  await seedSignedInSession(page);
  const fixtures = await installApiFixtures(page, { countryPreferenceRegion: "US" });
  await page.goto("/home");
  await expect(page.getByLabel("Total balance")).toContainText("$91.55");
  await waitForSettledPersistedBalances(page);
  await markPersistedQueriesStale(page);
  await page.addInitScript(() => localStorage.removeItem("home.country.v2"));

  const sessionObserved = fixtures.delayNextSession();
  const balancesObserved = fixtures.delayNextBalances();
  let sessionResponded = false;
  let balancesResponded = false;
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path === "/api/session") sessionResponded = true;
    if (path === "/api/balances") balancesResponded = true;
  });
  try {
    await page.reload();
    await sessionObserved;
    await expect(page.getByLabel("Total balance")).toContainText("$91.55");
    const warmPaint = await page.evaluate(() =>
      performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Infinity,
    );
    expect(sessionResponded).toBe(false);
    expect(balancesResponded).toBe(false);
    await balancesObserved;
    expect(sessionResponded).toBe(false);
    expect(balancesResponded).toBe(false);
    expect(await page.evaluate(() => performance.getEntriesByName("session:verified", "mark").length)).toBe(0);
    const balanceResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/balances");
    fixtures.releaseBalances();
    await balanceResponse;
    expect(balancesResponded).toBe(true);
    expect(sessionResponded).toBe(false);
    const balanceResponseMs = await page.evaluate(() => {
      performance.mark("balances:response");
      return performance.getEntriesByName("balances:response", "mark")[0]!.startTime;
    });
    fixtures.releaseSession();
    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByName("session:verified", "mark")[0]?.startTime ?? 0,
    )).toBeGreaterThan(0);
    expect(sessionResponded).toBe(true);
    const verifiedMs = await page.evaluate(() =>
      performance.getEntriesByName("session:verified", "mark")[0]!.startTime,
    );
    console.log(`warm Home balance paint: ${warmPaint.toFixed(0)}ms; verification: ${verifiedMs.toFixed(0)}ms; balance response: ${balanceResponseMs.toFixed(0)}ms`);
    expect(warmPaint).toBeLessThan(verifiedMs);
    await expect(page.getByRole("region", { name: "Activity" }).getByRole("button", { name: /^Received / }).first()).toBeVisible();
    await expect(page.getByLabel("Total balance")).toContainText("$91.55");
    await expect(page.getByLabel("Total balance")).not.toHaveAttribute("aria-busy", "true");

    await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /Borrow Cash/ }).click();
    await expect(page).toHaveURL(/\/borrow$/);
    const returnStart = await page.evaluate(() => {
      const witness = window as typeof window & { balanceReturn?: { busy: boolean; observer: MutationObserver } };
      const wasBusy = () => Boolean(document.querySelector(
        '[data-shell-panel]:not([hidden]) [aria-label="Updating…"], [data-shell-panel]:not([hidden]) [aria-label="Your money"][aria-busy="true"]',
      ));
      const observer = new MutationObserver(() => {
        if (witness.balanceReturn && wasBusy()) witness.balanceReturn.busy = true;
      });
      witness.balanceReturn = { busy: wasBusy(), observer };
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy", "aria-label", "hidden"] });
      performance.mark("balances:return-start");
      return performance.getEntriesByName("balances:return-start", "mark")[0]!.startTime;
    });
    await page.getByRole("button", { name: "Home", exact: true }).first().click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByLabel("Total balance")).toContainText("$91.55");
    await expect(page.getByLabel("Total balance")).not.toHaveAttribute("aria-busy", "true");
    const { returnMs, busy } = await page.evaluate((started) => {
      const witness = window as typeof window & { balanceReturn?: { busy: boolean; observer: MutationObserver } };
      witness.balanceReturn?.observer.disconnect();
      return { returnMs: performance.now() - started, busy: witness.balanceReturn?.busy };
    }, returnStart);
    expect(busy).toBe(false);
    console.log(`Borrow → Home balance visible: ${returnMs.toFixed(0)}ms`);
  } finally {
    fixtures.releaseSession();
    fixtures.releaseBalances();
  }
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
  const restoredCount = await settledBalanceRowCount(page);
  expect(restoredCount).toBeGreaterThanOrEqual(BALANCES_FIRST_BATCH);
  expect(restoredCount).toBeLessThan(state.revealedCount);
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
