import { expect, test, type Page } from "@playwright/test";
import { ownerQueryPersistThrottleMs } from "../../client/query/query-client";
import { FIXED_NOW } from "./fixtures/fixed-time";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";
import { trackHydrationErrors } from "./fixtures/hydration-errors";
import { expectNavigation } from "./fixtures/navigation-budget";

// The hosted-runner tier also covers an idle laptop. A loaded shared machine stretches both marks
// together, so the persisted paint may take twice the machine's own shell paint, never less than the tier.
const BALANCES_PAINTED_BUDGET_MS = 3_500;
const BALANCES_PAINTED_LOAD_FACTOR = 2;
const BALANCES_PAINTED_WAIT_MS = 15_000;

async function visibleBalanceRowLayout(page: Page) {
  return page.locator(
    '[aria-label="Your money"] [data-kind="balance"]',
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
    await expect(page.locator('[aria-label="Total balance"]'))
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
  const provisionalMarks = await page.evaluate(() => ({
    balances: performance.getEntriesByName("balances:painted", "mark").length,
    verified: performance.getEntriesByName("session:verified", "mark").length,
  }));
  expect(provisionalMarks.balances).toBeGreaterThan(0);
  expect(provisionalMarks.verified).toBe(0);

  fixtures.releaseBalances();
  fixtures.releaseSession();
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName("session:verified", "mark").length,
  )).toBeGreaterThan(0);
  await expect(page.locator('[aria-label="Total balance"]'))
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
    await expectNavigation(page, /\/borrow$/);
    const returnStart = await page.evaluate(() => {
      const witness = window as typeof window & { balanceReturn?: { busy: boolean; observer: MutationObserver } };
      const wasBusy = () => Boolean(document.querySelector(
        '[aria-label="Updating…"], [aria-label="Your money"][aria-busy="true"]',
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
    await expectNavigation(page, /\/home$/);
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
