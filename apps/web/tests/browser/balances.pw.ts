import { expect, test, type Page } from "@playwright/test";
import { ownerQueryPersistThrottleMs } from "../../client/query/query-client";
import { decodeOwnerCache } from "../../client/query/owner-cache-codec";
import { readIndexedOwnerCache, replaceIndexedOwnerCache } from "./fixtures/owner-cache";
import { FIXED_NOW } from "./fixtures/fixed-time";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";
import { trackHydrationErrors } from "./fixtures/hydration-errors";
import { borrowOverviewBody, savingsVaultsBody, sessionBody } from "./fixtures/bodies";
import { cdpRenderSessionCookies } from "./fixtures/session";
import { homeSummaryCookieName, encodeHomeSummaryCookie } from "../../shared/balances/home-summary";
import { dataOwnerKey } from "../../shared/account/data-owner";
import { presentHomeBalances } from "../../shared/balances/present";
import { balancesSnapshot } from "./fixtures/balances";
import { expectNavigation } from "./fixtures/navigation-budget";

declare global { interface Window { cachedMoneyTexts?: string[][] } }

// The hosted-runner tier also covers an idle laptop. A loaded shared machine stretches both marks
// together, so the persisted paint may take twice the machine's own shell paint, never less than the tier.
const BALANCES_PAINTED_BUDGET_MS = 3_500;
const BALANCES_PAINTED_LOAD_FACTOR = 2;
const BALANCES_PAINTED_WAIT_MS = 15_000;

async function visibleBalanceRowLayout(page: Page) {
  const rows = page.getByRole("region", { name: "Your money", exact: true }).locator('[data-kind="balance"]');
  await expect(rows).toHaveCount(3);
  return rows.evaluateAll((rows) => rows.map((row) => {
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
    const value = await readIndexedOwnerCache(page);
    const persisted = value ? JSON.parse(await decodeOwnerCache(value)) as {
      clientState?: { queries?: Array<{ queryKey?: unknown[] }> };
    } : null;
    const persistedQueries = persisted?.clientState?.queries;
    const queries = persistedQueries?.some((query) => query.queryKey?.[1] === "balances")
      ? JSON.stringify(persistedQueries) : null;
    const settled = queries !== null && queries === previousQueries;
    previousQueries = queries;
    return settled;
  }, { intervals: [ownerQueryPersistThrottleMs + 100] }).toBe(true);
}

async function markPersistedQueriesStale(page: Page) {
  const value = await readIndexedOwnerCache(page);
  if (!value) throw new Error("Persisted owner cache is missing");
  const persisted = JSON.parse(await decodeOwnerCache(value)) as {
    clientState?: { queries?: Array<{ state?: { dataUpdatedAt?: number } }> };
  };
  for (const query of persisted.clientState?.queries ?? []) {
    if (query.state) query.state.dataUpdatedAt = FIXED_NOW - 60_000;
  }
  await replaceIndexedOwnerCache(page, value, JSON.stringify(persisted));
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
    indexedDB.deleteDatabase("home-query-cache");
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
  const summaryPaint = await page.evaluate(() => performance.getEntriesByName("balances:summary-painted", "mark")[0]?.startTime);
  expect(summaryPaint).toBeDefined();
  const balancesPaint = await page.evaluate(() => performance.getEntriesByName("balances:painted", "mark")[0]?.startTime);
  if (balancesPaint === undefined) throw new Error("Persisted balances paint mark is missing");
  expect(summaryPaint).toBeLessThanOrEqual(balancesPaint);

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

test("summary-only reload retains rate subtitles without pulsing placeholders", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  const fixtures = await installApiFixtures(page);
  let releaseRates: (() => void) | undefined;
  let ratesHeld = false;
  const delayedRates = new Promise<void>((resolve) => { releaseRates = resolve; });
  const ratesBody = savingsVaultsBody(new Date(FIXED_NOW).toISOString(), new Date(FIXED_NOW).toISOString());
  await page.route("**/api/savings/vaults", async (route) => {
    if (ratesHeld) await delayedRates;
    await route.fulfill({ json: ratesBody });
  });
  await page.route("**/api/borrow", async (route) => {
    if (ratesHeld) await delayedRates;
    await route.fulfill({ json: borrowOverviewBody() });
  });
  await page.goto("/home");
  const money = page.getByRole("region", { name: "Your money", exact: true });
  await expect(money).toContainText("APY");
  await expect(money).toContainText("APR");
  await waitForSettledPersistedBalances(page);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => {
    if (!key.includes(":home-summary:US")) return false;
    const value = localStorage.getItem(key);
    if (!value) return false;
    const record: { rates?: { cash?: { value?: string }; borrow?: { value?: string } } } = JSON.parse(value);
    const rates = record.rates;
    return Boolean(rates?.cash?.value && rates?.borrow?.value);
  }))).toBe(true);
  const settled = await visibleBalanceRowLayout(page);
  const value = await readIndexedOwnerCache(page);
  if (!value) throw new Error("Owner cache missing");
  const envelope = JSON.parse(await decodeOwnerCache(value));
  envelope.clientState.queries = [];
  await replaceIndexedOwnerCache(page, value, JSON.stringify(envelope));
  await page.addInitScript((expected) => {
    window.cachedMoneyTexts = [];
    let revealed = false;
    new MutationObserver(() => {
      const region = document.querySelector('[aria-label="Your money"], [aria-labelledby="your-money-heading"]');
      const rows = region?.querySelectorAll('[data-kind="balance"]');
      if (rows?.length !== expected.length) {
        if (revealed) window.cachedMoneyTexts?.push([]);
        return;
      }
      revealed = true;
      const texts = Array.from(rows).map((row) => row.textContent?.replace(/\s+/g, " ").trim() ?? "");
      window.cachedMoneyTexts?.push(texts);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, settled.map((row) => row.text));
  ratesHeld = true;
  const sessionObserved = fixtures.delayNextSession();
  const balancesObserved = fixtures.delayNextBalances();
  try {
    await page.reload();
    await sessionObserved;
    await expect(page.getByLabel("Total balance")).toContainText("$91.55");
    expect(await visibleBalanceRowLayout(page)).toEqual(settled);
    const activity = page.getByRole("region", { name: "Activity", exact: true });
    await expect(activity).toHaveAttribute("aria-busy", "true");
    await expect(activity.locator('[data-shimmer]')).toHaveCount(0);
    await expect(money.locator('[data-shimmer]')).toHaveCount(0);
    fixtures.releaseSession();
    await balancesObserved;
    expect(await visibleBalanceRowLayout(page)).toEqual(settled);
    fixtures.releaseBalances();
    await expect(page.getByLabel("Total balance")).not.toHaveAttribute("aria-busy", "true");
    expect(await visibleBalanceRowLayout(page)).toEqual(settled);
    releaseRates?.();
    await expect(activity.getByRole("button", { name: /^Received / }).first()).toBeVisible();
    expect(await visibleBalanceRowLayout(page)).toEqual(settled);
    const observed = await page.evaluate(() => window.cachedMoneyTexts ?? []);
    expect(observed.length).toBeGreaterThan(0);
    for (const texts of observed) expect(texts).toEqual(settled.map((row) => row.text));
    await page.screenshot({ path: test.info().outputPath("cached-home.png") });
  } finally {
    fixtures.releaseSession();
    fixtures.releaseBalances();
    releaseRates?.();
  }
});

test("cached Home HTML contains money before React hydration", async ({ browser, baseURL, context }) => {
  const documentResponse = await context.request.get(`${baseURL}/home`);
  const now = Date.parse(documentResponse.headers().date ?? "");
  if (!Number.isFinite(now)) throw new Error("Server clock header missing");
  const session = { ...sessionBody, smartAccount: { ...sessionBody.smartAccount, address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const }, accountProvider: "cdp-embedded" as const };
  const presentation = presentHomeBalances({ status: "ready", snapshot: balancesSnapshot(), error: null });
  const summary = presentation.summary;
  const total = presentation.displayTotal;
  if (!summary || total === null) throw new Error("Summary fixture invalid");
  const value = encodeHomeSummaryCookie({ version: 2, owner: dataOwnerKey(session), region: "US", updatedAt: now, presentation: { ...presentation, status: "ready", summary },
    rates: { cash: { value: "3.50% APY", updatedAt: now }, borrow: { value: "3.15% APR", updatedAt: now } } });
  if (!value || !baseURL) throw new Error("Summary fixture unavailable");
  const noScript = await browser.newContext({ extraHTTPHeaders: { "x-vercel-ip-country": "US" }, viewport: { width: 390, height: 844 } });
  try {
    await noScript.addCookies(await context.cookies());
    await noScript.addCookies([...cdpRenderSessionCookies(session).map((cookie) => ({ ...cookie, url: baseURL })),
      { name: homeSummaryCookieName, value, domain: new URL(baseURL).hostname, path: "/home" }]);
    const page = await noScript.newPage();
    await page.route("**/*", (route) => route.request().resourceType() === "script" ? route.abort() : route.continue());
    let requests = 0;
    page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) requests += 1; });
    await page.goto("/home");
    await expect(page.getByLabel("Total balance", { exact: true })).toContainText(total);
    const money = page.getByRole("region", { name: "Your money", exact: true });
    await expect(money).toContainText("3.50% APY");
    await expect(money).toContainText("3.15% APR");
    await expect(money.locator('[data-shimmer]')).toHaveCount(0);
    await expect(page.getByLabel("Money actions").getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    expect(requests).toBe(0);
    await page.screenshot({ path: test.info().outputPath("home-before-javascript.png") });
    await noScript.clearCookies({ name: "home-cdp-live" });
    await page.reload();
    await expect(page.getByLabel("Total balance", { exact: true })).toHaveCount(0);
  } finally { await noScript.close(); }
});
