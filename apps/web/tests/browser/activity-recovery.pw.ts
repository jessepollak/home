import { expect, test, type Page } from "@playwright/test";
import type { DehydratedState } from "@tanstack/react-query";
import { installApiFixtures, json, RECIPIENT, seedSignedInSession } from "./fixtures/api";
import { requestBackgroundRevalidation } from "./fixtures/background-revalidation";
import { sessionBody } from "./fixtures/bodies";
import { FIXED_NOW } from "./fixtures/fixed-time";
import { expectNavigation } from "./fixtures/navigation-budget";
import { activityOrdersFixture } from "./feature-map/fixtures";
import { readIndexedOwnerCache, replaceIndexedOwnerCache } from "./fixtures/owner-cache";
import { decodeOwnerCache } from "../../client/query/owner-cache-codec";
import { ownerQueryPersistThrottleMs } from "../../client/query/query-client";

const wallet = sessionBody.smartAccount.address;
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const warning = /Some activity is unavailable|Latest activity didn't load|Your Home actions are unavailable|Add money and cash-out orders are unavailable|Card purchases may be out of date/;
const merchant = "Fixture Coffee";
const freshMerchant = "Fixture Bakery";
const settledMerchant = new RegExp(`^${merchant} (?!.*Pending)`);

function activityResponse(url: URL, partial: boolean, freshCard = false) {
  const to = url.searchParams.get("to")!;
  const currency = url.searchParams.get("currency") ?? "USD";
  return {
    version: 1,
    walletAddress: wallet,
    chainId: 8453,
    window: { from: new Date(Date.parse(to) - 86_400_000).toISOString(), to },
    currency,
    transfers: partial ? [] : [1, 2, 3].map((minute) => ({
      id: `8453:${token}:recovery-${minute}`,
      logId: `recovery-${minute}`,
      chainId: 8453,
      assetId: "usdc",
      tokenAddress: token,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      tokenImageUrl: null,
      walletAddress: wallet,
      fromAddress: minute % 2 ? RECIPIENT : wallet,
      toAddress: minute % 2 ? wallet : RECIPIENT,
      direction: minute % 2 ? "incoming" : "outgoing",
      amountBaseUnits: `${minute * 1_000_000}`,
      blockNumber: `${1000 - minute}`,
      blockHash: `0x${"ef".repeat(32)}`,
      transactionHash: `0x${minute.toString(16).padStart(64, "0")}`,
      logIndex: "1",
      blockTimestamp: new Date(Date.parse(to) - minute * 60_000).toISOString(),
      valuation: { status: "unpriced", currency, reason: "quote-unavailable" },
    })),
    cards: { version: 1, status: "ready", rows: [{
      id: "11111111-1111-4111-8111-111111110011",
      kind: "transaction",
      amountMinor: "450",
      currency: "USD",
      merchantName: merchant,
      merchantCategory: null,
      status: "completed",
      declineReasonCode: null,
      createdAt: new Date(Date.parse(to) - 30 * 60_000).toISOString(),
      updatedAt: new Date(Date.parse(to) - 30 * 60_000).toISOString(),
    }, ...(freshCard ? [{
      id: "11111111-1111-4111-8111-111111110012",
      kind: "transaction",
      amountMinor: "725",
      currency: "USD",
      merchantName: freshMerchant,
      merchantCategory: null,
      status: "completed",
      declineReasonCode: null,
      createdAt: new Date(Date.parse(to) - 10 * 60_000).toISOString(),
      updatedAt: new Date(Date.parse(to) - 10 * 60_000).toISOString(),
    }] : [])] },
    nextCursor: null,
    source: partial ? null : {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: to,
      executionTimeMs: 1,
      fetchedAt: to,
    },
    ...(partial ? { onchainStatus: "unavailable" } : {}),
  };
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: FIXED_NOW });
});

async function setup(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  await installApiFixtures(page, { clock: "system" });
  const createdAt = new Date(FIXED_NOW - 5 * 60_000).toISOString();
  await page.route("**/api/actions*", (route) =>
    new URL(route.request().url()).pathname === "/api/actions"
      ? json(route, { version: 1, truncated: false, actions: [{
        id: "11111111-1111-4111-8111-111111111112",
        provider: "cdp-embedded",
        kind: "send",
        summary: { title: "Fixture send", amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }], warnings: [], expiresAt: createdAt },
        status: "confirmed",
        createdAt,
        confirmedAt: createdAt,
        owner: { subject: sessionBody.user.subject, address: wallet, chainId: 8453, accountProvider: sessionBody.accountProvider },
      }] }) : route.fallback());
  const feed = page.locator("#navigation-panel [data-activity-feed]");
  return { feed, rows: feed.getByRole("button", { name: /^(Received|Sent) .*USDC$/ }) };
}

test("background revalidation keeps loaded rows and shows fresh card purchases when onchain history is briefly unavailable", async ({ page }) => {
  const { feed, rows } = await setup(page);
  let reads = 0;
  let releaseFirstRead = () => {};
  const firstReadHeld = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
  await page.route("**/api/activity*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    reads++;
    if (reads === 1) await firstReadHeld;
    return json(route, activityResponse(url, reads > 1, reads > 1));
  });
  await page.goto("/home");
  await expect.poll(() => reads).toBeGreaterThan(0);
  // Hold the first read open and pause the page clock before it settles; the pause margin only
  // has to outlast the evaluate/pause round trip, so it does not consume the retry budget
  // below. Drive the first paint with small clock steps because the feed needs frames, then
  // advance 11s to cross the 10s stale time while staying short of the 15s valuation retry,
  // so only the visibility-triggered refetch can satisfy the handshake. Resume afterward so
  // the refetch's recovery retries can run.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 30_000));
  releaseFirstRead();
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return rows.count();
  }, { timeout: 10_000 }).toBe(3);
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toHaveCount(0);
  await page.clock.fastForward(11_000);
  expect(reads).toBe(1);
  await requestBackgroundRevalidation(page, () => reads, 1);
  await page.clock.runFor(2_500);
  await page.clock.resume();
  await expect(rows).toHaveCount(3);
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("a partial revalidation keeps its fresh card purchases when the remaining retries fail", async ({ page }) => {
  const { feed, rows } = await setup(page);
  let reads = 0;
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    reads++;
    if (reads === 1) return json(route, activityResponse(url, false));
    if (reads === 2) return json(route, activityResponse(url, true, true));
    return route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." } }),
    });
  });
  await page.goto("/home");
  await expect(rows).toHaveCount(3);
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toHaveCount(0);
  await page.clock.fastForward(11_000);
  await requestBackgroundRevalidation(page, () => reads, 1);
  await expect.poll(async () => {
    await page.clock.runFor(1_000);
    return reads;
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
  await expect(rows).toHaveCount(3);
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(feed.getByText(warning)).toHaveCount(0);
});

type FixtureCardRow = ReturnType<typeof activityResponse>["cards"]["rows"][number];

function cardRow(rows: FixtureCardRow[], index: number): FixtureCardRow {
  const row = rows[index];
  if (!row) throw new Error(`Missing fixture card row ${index}`);
  return row;
}

async function refreshWithNewerCards(page: Page, options: {
  supersede?: boolean;
  remainingRetriesFail?: boolean;
  revalidationCardsUnavailable?: boolean;
  revalidationCompletesCard?: boolean;
  revalidationRemovesAuthorization?: boolean;
  revalidationAddsBacklogCard?: boolean;
  authorizationPersistedLate?: boolean;
  revalidationOnchainUnavailable?: boolean;
  revalidationWhileNewerReadHeld?: boolean;
  revalidationSupersedesRetainedPartial?: boolean;
  revalidationStartsSameTick?: boolean;
} = {}) {
  const { feed, rows } = await setup(page);
  let firstWindow: string | undefined;
  let currentWindowReads = 0;
  let newerWindowReads = 0;
  let releaseFirstRead = () => {};
  const firstReadHeld = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
  let releaseNewerRead = () => {};
  const newerReadHeld = new Promise<void>((resolve) => { releaseNewerRead = resolve; });
  await page.route("**/api/activity*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    const to = url.searchParams.get("to");
    if (!to) return route.fallback();
    firstWindow ??= to;
    const newer = Date.parse(to) > Date.parse(firstWindow);
    if (newer) newerWindowReads++;
    else currentWindowReads++;
    if (currentWindowReads === 1 && !newer) await firstReadHeld;
    if (newer && newerWindowReads === 3 && options.revalidationWhileNewerReadHeld) await newerReadHeld;
    if (newer && options.remainingRetriesFail && newerWindowReads > 1) {
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." } }),
      });
    }
    const response = activityResponse(url, newer || (options.revalidationOnchainUnavailable === true && currentWindowReads > 1), newer);
    if (!newer && options.revalidationCardsUnavailable && currentWindowReads > 1) {
      response.cards.status = "unavailable";
    }
    if (options.revalidationSupersedesRetainedPartial) {
      const completed = !newer && currentWindowReads > 1;
      const createdAt = new Date(Date.parse(firstWindow) + (completed ? 2 : -30 * 60_000)).toISOString();
      response.cards.rows[0] = {
        ...cardRow(response.cards.rows, 0),
        id: completed ? "11111111-1111-4111-8111-111111110011" : "11111111-1111-4111-8111-111111110013",
        kind: completed ? "transaction" : "authorization",
        status: completed ? "completed" : "pending",
        createdAt,
        updatedAt: createdAt,
      };
    }
    if (options.revalidationCompletesCard) {
      const completed = !newer && currentWindowReads > 1;
      response.cards.rows[0] = {
        ...cardRow(response.cards.rows, 0),
        status: completed ? "completed" : "pending",
        createdAt: new Date(Date.parse(firstWindow) - 30 * 60_000).toISOString(),
        updatedAt: new Date(Date.parse(firstWindow) - (completed ? 30_000 : 60_000)).toISOString(),
      };
    }
    if (options.supersede && !newer) {
      response.cards.rows[0] = { ...cardRow(response.cards.rows, 0), id: "11111111-1111-4111-8111-111111110013", kind: "authorization", status: "pending" };
    }
    if (newer) {
      const fresh = cardRow(response.cards.rows, 1);
      const createdAt = new Date(Date.parse(firstWindow) + 1).toISOString();
      response.cards.rows[1] = { ...fresh, createdAt, updatedAt: createdAt };
      if (options.supersede) {
        const captureCreatedAt = new Date(Date.parse(firstWindow) + 2).toISOString();
        response.cards.rows[0] = { ...cardRow(response.cards.rows, 0), createdAt: captureCreatedAt, updatedAt: captureCreatedAt };
      }
    }
    if (options.revalidationRemovesAuthorization && (newer || (currentWindowReads === 1 && !options.authorizationPersistedLate))) {
      const createdAt = new Date(Date.parse(firstWindow) - 30 * 60_000).toISOString();
      response.cards.rows.push({
        ...cardRow(response.cards.rows, 0), id: "11111111-1111-4111-8111-111111110014", kind: "authorization", status: "pending",
        merchantName: "Fixture Market", createdAt, updatedAt: createdAt,
      });
    }
    if (options.revalidationAddsBacklogCard && !newer && currentWindowReads > 1) {
      const createdAt = new Date(Date.parse(firstWindow) - 20 * 60_000).toISOString();
      response.cards.rows.push({
        ...cardRow(response.cards.rows, 0), id: "11111111-1111-4111-8111-111111110015", kind: "transaction", status: "completed",
        merchantName: "Fixture Market", createdAt, updatedAt: createdAt,
      });
    }
    return json(route, response);
  });
  await page.goto("/home");
  await expect.poll(() => currentWindowReads).toBeGreaterThan(0);
  await page.clock.pauseAt(new Date(FIXED_NOW + 60_000));
  releaseFirstRead();
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return rows.count();
  }, { timeout: 10_000 }).toBe(3);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toHaveCount(0);
  if (options.supersede) await expect(feed.getByRole("list", { name: "Pending", exact: true }).getByRole("button", { name: new RegExp(`^${merchant}.*Pending`) })).toBeVisible();
  if (options.authorizationPersistedLate) await expect(feed.getByRole("button", { name: /^Fixture Market/ })).toHaveCount(0);
  if (options.revalidationWhileNewerReadHeld || options.revalidationSupersedesRetainedPartial) await page.clock.fastForward(11_000);
  else await page.clock.runFor(1_000);
  const retainedPartialResponse = options.revalidationSupersedesRetainedPartial ? page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/activity" && Date.parse(url.searchParams.get("to") ?? "") > Date.parse(firstWindow ?? "");
  }) : undefined;
  await page.getByLabel("Refresh Home").evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Refresh Home is not an element");
    element.click();
  });
  if (retainedPartialResponse) {
    await (await retainedPartialResponse).finished();
    if (!options.revalidationStartsSameTick) await page.clock.runFor(100);
    expect(newerWindowReads).toBe(1);
    await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toHaveCount(0);
    const revalidationResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/activity" && url.searchParams.get("to") === firstWindow;
    });
    const readsBeforeRevalidation = currentWindowReads;
    await requestBackgroundRevalidation(page, () => currentWindowReads, readsBeforeRevalidation);
    await (await revalidationResponse).finished();
    await page.clock.runFor(100);
    await expect(feed.getByRole("button", { name: settledMerchant })).toBeVisible();
    expect(newerWindowReads).toBe(1);
  }
  await expect.poll(async () => {
    await page.clock.runFor(500);
    return newerWindowReads;
  }, { timeout: 15_000 }).toBe(3);
  if (options.revalidationWhileNewerReadHeld) {
    await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toHaveCount(0);
    await page.clock.runFor(100);
    const revalidationResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/activity" && url.searchParams.get("to") === firstWindow;
    });
    const readsBeforeRevalidation = currentWindowReads;
    await requestBackgroundRevalidation(page, () => currentWindowReads, readsBeforeRevalidation);
    await (await revalidationResponse).finished();
    await page.clock.runFor(100);
    await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}.*Pending`) })).toBeVisible();
    releaseNewerRead();
    await page.clock.runFor(100);
  }
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  return { feed, rows, currentWindowReads: () => currentWindowReads };
}

for (const remainingRetriesFail of [false, true]) {
  test(`a newer-window partial refresh shows new card purchases and keeps healthy transfers${remainingRetriesFail ? " when remaining retries fail" : ""}`, async ({ page }) => {
    const { feed, rows } = await refreshWithNewerCards(page, { remainingRetriesFail });
    await expect(rows).toHaveCount(3);
    await expect(feed.getByText(warning)).toHaveCount(0);
  });
}

test("a newer-window partial snapshot retains a shown authorization alongside its transaction", async ({ page }) => {
  const { feed, rows } = await refreshWithNewerCards(page, { supersede: true });
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}.*Pending`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: settledMerchant })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toHaveCount(2);
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("overlapping same-window and newer-window reads retain both shown card IDs", async ({ page }) => {
  const { feed, rows } = await refreshWithNewerCards(page, { supersede: true, revalidationWhileNewerReadHeld: true });
  await expect(feed.getByRole("button", { name: settledMerchant })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}.*Pending`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toHaveCount(2);
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

for (const revalidationStartsSameTick of [false, true]) {
  test(`a same-window revalidation completed before a retained newer-window partial publishes keeps its completed capture${revalidationStartsSameTick ? " when the reads meet on the same clock tick" : ""}`, async ({ page }) => {
    const { feed, rows } = await refreshWithNewerCards(page, {
      remainingRetriesFail: true,
      revalidationSupersedesRetainedPartial: true,
      revalidationStartsSameTick,
    });
    await expect(feed.getByRole("button", { name: settledMerchant })).toBeVisible();
    await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}.*Pending`) })).toBeVisible();
    await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toHaveCount(2);
    await expect(rows).toHaveCount(3);
    await expect(feed.getByText(warning)).toHaveCount(0);
  });
}

test("healthy same-window revalidation preserves the newer-window card snapshot", async ({ page }) => {
  const { feed, rows, currentWindowReads } = await refreshWithNewerCards(page);
  await page.clock.fastForward(11_000);
  const readsBeforeRevalidation = currentWindowReads();
  await requestBackgroundRevalidation(page, currentWindowReads, readsBeforeRevalidation);
  await page.clock.runFor(100);
  await expect(rows).toHaveCount(3);
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("healthy same-window revalidation adds a backlog card inside the newer snapshot window", async ({ page }) => {
  const { feed, rows, currentWindowReads } = await refreshWithNewerCards(page, { revalidationAddsBacklogCard: true });
  await expect(feed.getByRole("button", { name: /^Fixture Market/ })).toHaveCount(0);
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await page.clock.fastForward(11_000);
  const readsBeforeRevalidation = currentWindowReads();
  await requestBackgroundRevalidation(page, currentWindowReads, readsBeforeRevalidation);
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return feed.getByRole("button", { name: /^Fixture Market/ }).count();
  }).toBe(1);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(rows).toHaveCount(3);
});

test("healthy same-window revalidation completes a shared pending card without losing newer-only cards", async ({ page }) => {
  const { feed, rows, currentWindowReads } = await refreshWithNewerCards(page, { revalidationCompletesCard: true });
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}.*Pending`) })).toBeVisible();
  await page.clock.fastForward(11_000);
  const readsBeforeRevalidation = currentWindowReads();
  await requestBackgroundRevalidation(page, currentWindowReads, readsBeforeRevalidation);
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return feed.getByRole("button", { name: settledMerchant }).count();
  }).toBe(1);
  await expect(feed.getByRole("button", { name: settledMerchant })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}.*Pending`) })).toHaveCount(0);
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("healthy same-window revalidation retains a missing authorization alongside newer-only cards", async ({ page }) => {
  const { feed, rows, currentWindowReads } = await refreshWithNewerCards(page, { revalidationRemovesAuthorization: true });
  const authorization = feed.getByRole("button", { name: /^Fixture Market.*Pending/ });
  await expect(authorization).toBeVisible();
  await page.clock.fastForward(11_000);
  const readsBeforeRevalidation = currentWindowReads();
  await requestBackgroundRevalidation(page, currentWindowReads, readsBeforeRevalidation);
  await page.clock.runFor(100);
  await expect(authorization).toBeVisible();
  await expect(feed.getByRole("button", { name: /^Fixture Market/ })).toHaveCount(1);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("partial same-window revalidation retains a missing authorization alongside newer-only cards and transfers", async ({ page }) => {
  const { feed, rows, currentWindowReads } = await refreshWithNewerCards(page, {
    revalidationRemovesAuthorization: true,
    revalidationOnchainUnavailable: true,
  });
  await expect(feed.getByRole("button", { name: /^Fixture Market.*Pending/ })).toBeVisible();
  await page.clock.fastForward(11_000);
  const readsBeforeRevalidation = currentWindowReads();
  await requestBackgroundRevalidation(page, currentWindowReads, readsBeforeRevalidation);
  await expect.poll(async () => {
    await page.clock.runFor(500);
    return currentWindowReads();
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(readsBeforeRevalidation + 3);
  await expect(feed.getByRole("button", { name: /^Fixture Market.*Pending/ })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("partial same-window revalidation retains a late-persisted authorization when cards match the old-window cache", async ({ page }) => {
  const { feed, rows, currentWindowReads } = await refreshWithNewerCards(page, {
    revalidationRemovesAuthorization: true,
    authorizationPersistedLate: true,
    revalidationOnchainUnavailable: true,
  });
  await expect(feed.getByRole("button", { name: /^Fixture Market.*Pending/ })).toBeVisible();
  await page.clock.fastForward(11_000);
  const readsBeforeRevalidation = currentWindowReads();
  await requestBackgroundRevalidation(page, currentWindowReads, readsBeforeRevalidation);
  await expect.poll(async () => {
    await page.clock.runFor(500);
    return currentWindowReads();
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(readsBeforeRevalidation + 3);
  await expect(feed.getByRole("button", { name: /^Fixture Market.*Pending/ })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("older-window card-source failure keeps newer cards without a notice or retry", async ({ page }) => {
  const { feed, rows, currentWindowReads } = await refreshWithNewerCards(page, { revalidationCardsUnavailable: true });
  await page.clock.fastForward(11_000);
  const readsBeforeRevalidation = currentWindowReads();
  await requestBackgroundRevalidation(page, currentWindowReads, readsBeforeRevalidation);
  await page.clock.runFor(100);
  await expect(feed.getByText(warning)).toHaveCount(0);
  await expect(feed.getByRole("button", { name: /Try again|Retry|Reload activity/ })).toHaveCount(0);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(rows).toHaveCount(3);
});

test("a transient first read recovers automatically", async ({ page }) => {
  const { feed, rows } = await setup(page);
  let reads = 0;
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    reads++;
    if (reads === 1) return route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." } }),
    });
    return json(route, activityResponse(url, false));
  });
  await page.goto("/home");
  await expect.poll(() => reads).toBeGreaterThan(0);
  await page.clock.runFor(2_500);
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("Try again recovers a failed first read with no rows", async ({ page }) => {
  const { feed, rows } = await setup(page);
  let healthy = false;
  let reads = 0;
  await page.route("**/api/actions", (route) => json(route, { version: 1, truncated: false, actions: [] }));
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    reads++;
    return healthy ? json(route, activityResponse(url, false)) : route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." } }),
    });
  });
  await page.goto("/home");
  await expect.poll(async () => {
    await page.clock.runFor(1_000);
    return reads;
  }).toBeGreaterThanOrEqual(3);
  await expect(feed.getByRole("alert")).toContainText("Activity is temporarily unavailable.");
  await expect(rows).toHaveCount(0);
  await expect(feed.getByRole("listitem")).toHaveCount(0);
  const readsBeforeRetry = reads;
  healthy = true;
  await feed.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => reads).toBeGreaterThan(readsBeforeRetry);
  await expect(rows).toHaveCount(3);
  await expect(feed.getByRole("alert")).toHaveCount(0);
  await expect(feed.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

for (const outcome of ["failed", "partial", "shorter"] as const) {
  test(`a ${outcome} refetch retains the same transfers and cards for a later Home consumer`, async ({ page }) => {
    await setup(page);
    let reads = 0;
    let refreshing = false;
    await page.route("**/api/activity*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/activity") return route.fallback();
      reads += 1;
      if (refreshing && outcome === "failed") return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." } }),
      });
      const response = activityResponse(url, refreshing && outcome === "partial");
      if (refreshing) {
        response.cards.rows = [];
        if (outcome === "partial") response.cards.status = "unavailable";
        else response.transfers = response.transfers.slice(0, 1);
      }
      return json(route, response);
    });
    const activity = page.locator("#navigation-panel [data-activity-sources]");
    const transfers = activity.getByRole("button", { name: /^(Received|Sent) .*USDC$/ });
    const coffee = activity.getByRole("button", { name: new RegExp(`^${merchant}`) });
    await page.goto("/activity");
    await expect(transfers).toHaveCount(3);
    await expect(coffee).toBeVisible();
    const before = await transfers.allTextContents();
    refreshing = true;
    await page.clock.fastForward(11_000);
    const beforeReads = reads;
    await requestBackgroundRevalidation(page, () => reads, beforeReads);
    await expect.poll(async () => {
      await page.clock.runFor(500);
      return reads;
    }).toBeGreaterThanOrEqual(beforeReads + (outcome === "shorter" ? 1 : 3));
    await expect(transfers).toHaveCount(3);
    await expect(coffee).toBeVisible();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
    await expectNavigation(page, /\/home$/);
    await expect(transfers).toHaveText(before);
    await expect(coffee).toBeVisible();
    await expect(activity.getByText(warning)).toHaveCount(0);
    await expect(activity.getByRole("button", { name: /Try again|Retry|Reload activity/ })).toHaveCount(0);
    await page.goBack();
    await expectNavigation(page, /\/activity$/);
    await expect(transfers).toHaveText(before);
    await expect(coffee).toBeVisible();
  });
}

test("failed Home refresh retains card purchases across a new Activity window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  await installApiFixtures(page, { clock: "system" });
  const panel = page.locator("#navigation-panel");
  const activity = panel.locator("[data-activity-sources]");
  const cards = activity.getByRole("button", { name: /^(Blue Bottle Coffee|Lyft|Whole Foods Market|Grand Hotel|Apple) / });
  const home = async () => {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
    await expectNavigation(page, "/home");
  };
  const cash = async () => {
    await panel.getByRole("region", { name: "Your money", exact: true }).getByRole("button", { name: /^Cash / }).click();
    await expectNavigation(page, "/cash");
    await expect(page.getByRole("region", { name: "Cash", exact: true })).toBeVisible();
  };
  const investments = async () => {
    await home();
    await panel.getByRole("region", { name: "Your money", exact: true }).getByRole("button", { name: /^Investments / }).click();
    await expectNavigation(page, "/investments");
    await expect(page.getByRole("heading", { name: "Investments", exact: true })).toBeVisible();
  };
  const openActivity = async () => {
    await home();
    await page.evaluate(() => history.pushState(null, "", "/activity"));
    await expectNavigation(page, "/activity");
  };
  await page.goto("/home");
  await expect(cards).toHaveCount(6);
  await cash();
  await investments();
  await openActivity();
  await expect(cards).toHaveCount(6);
  const before = await cards.allTextContents();
  let failedReads = 0;
  await page.route("**/api/balances**", (route) => route.abort());
  await page.route("**/api/activity**", (route) => {
    failedReads++;
    return route.abort();
  });
  await home();
  await page.getByRole("button", { name: "Refresh Home", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => {
    await page.clock.runFor(1_000);
    return page.getByText("Some of Home didn't refresh.", { exact: true }).isVisible();
  }, { timeout: 15_000 }).toBe(true);
  await expect(page.getByText("Some of Home didn't refresh.", { exact: true })).toBeVisible();
  await cash();
  await investments();
  const readsBeforeReturn = failedReads;
  await openActivity();
  await expect.poll(async () => {
    await page.clock.runFor(500);
    return failedReads;
  }).toBeGreaterThanOrEqual(readsBeforeReturn + 3);
  await expect(cards).toHaveText(before);
  await expect(activity.getByText(warning)).toHaveCount(0);
  await expect(activity.getByRole("button", { name: /Try again|Retry|Reload activity/ })).toHaveCount(0);
});

test("an owner switch drops retained transfers and card purchases", async ({ page }) => {
  const { feed, rows } = await setup(page);
  let switched = false;
  let reads = 0;
  await page.route("**/api/actions", (route) => json(route, { version: 1, truncated: false, actions: [] }));
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    reads += 1;
    const response = activityResponse(url, false);
    if (switched) response.walletAddress = "0x3333333333333333333333333333333333333333";
    if (switched || reads > 1) {
      response.transfers = [];
      response.cards.rows = [];
    }
    return json(route, response);
  });
  await page.goto("/home");
  await expect(rows).toHaveCount(3);
  await page.clock.fastForward(11_000);
  await requestBackgroundRevalidation(page, () => reads, 1);
  await expect(rows).toHaveCount(3);
  switched = true;
  await page.route("**/api/activity/orders", (route) => json(route, {
    version: 1, owner: { subject: "playwright-smoke-second-subject", accountProvider: sessionBody.accountProvider }, orders: [],
  }));
  await page.route("**/api/session", (route) => json(route, { ...sessionBody, user: { subject: "playwright-smoke-second-subject" },
    smartAccount: { ...sessionBody.smartAccount, address: "0x3333333333333333333333333333333333333333" } }));
  await page.evaluate(() => window.dispatchEvent(new Event("home:playwright-smoke:owner-switch")));
  await expect(feed.getByText("No activity yet", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(0);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toHaveCount(0);
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function listLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function persistedActivityQueries(persisted: unknown): Array<[number, number | null, number | null]> {
  if (!isObject(persisted) || !isObject(persisted.clientState) || !Array.isArray(persisted.clientState.queries)) return [];
  return persisted.clientState.queries.flatMap((query: unknown) => {
    if (!isObject(query) || !Array.isArray(query.queryKey) || query.queryKey[1] !== "activity" ||
      !isObject(query.state) || !isObject(query.state.data)) return [];
    const { pages, retainedPage } = query.state.data;
    const pageList: unknown[] = Array.isArray(pages) ? pages : [];
    const first = pageList[0];
    return [[
      pageList.reduce<number>((total, page) => total + (isObject(page) ? listLength(page.transfers) ?? 0 : 0), 0),
      isObject(retainedPage) ? listLength(retainedPage.transfers) : null,
      isObject(first) && isObject(first.cards) ? listLength(first.cards.rows) : null,
    ]];
  });
}

test("a panel mounted after a shorter orders read shows the rows the first panel kept", async ({ page }) => {
  await setup(page);
  const createdAt = new Date(FIXED_NOW - 5 * 60_000).toISOString();
  const action = (id: string, title: string) => ({
    id,
    provider: "cdp-embedded",
    kind: "send",
    summary: { title, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }], warnings: [], expiresAt: createdAt },
    status: "confirmed",
    createdAt,
    confirmedAt: createdAt,
    owner: { subject: sessionBody.user.subject, address: wallet, chainId: 8453, accountProvider: sessionBody.accountProvider },
  });
  const allOrders = activityOrdersFixture();
  let shorter = false;
  let shorterOrderReads = 0;
  await page.route("**/api/actions", (route) => json(route, { version: 1, truncated: false, actions: [
    action("11111111-1111-4111-8111-111111111112", "Fixture send"),
    action("11111111-1111-4111-8111-111111111113", "Second send"),
  ] }));
  await page.route("**/api/activity/orders", (route) => {
    if (shorter) shorterOrderReads += 1;
    return json(route, { ...allOrders, orders: shorter ? allOrders.orders.slice(0, 1) : allOrders.orders });
  });
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    return url.pathname === "/api/activity" ? json(route, activityResponse(url, false)) : route.fallback();
  });
  const activity = page.locator("#navigation-panel [data-activity-sources]");
  const items = activity.getByRole("button", { name: /^(Add money|Cash out|Received|Sent|Fixture send|Second send|Fixture Coffee)/ });
  await page.goto("/activity");
  await expect(items).toHaveCount(11);
  const before = await items.allTextContents();
  shorter = true;
  await expect.poll(async () => {
    await page.clock.runFor(1_000);
    return shorterOrderReads;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(items).toHaveText(before);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
  await expectNavigation(page, /\/home$/);
  await expect(items).toHaveText(before);
});

test("a full reload restores the Activity rows shown before a shorter read, and an owner switch drops them", async ({ page }) => {
  const { feed, rows } = await setup(page);
  let reads = 0;
  let revalidating = false;
  let unavailable = false;
  let switched = false;
  await page.route("**/api/actions", (route) => json(route, { version: 1, truncated: false, actions: [] }));
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    reads += 1;
    if (unavailable && !switched) return route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." } }),
    });
    const response = activityResponse(url, false, revalidating);
    const to = Date.parse(url.searchParams.get("to") ?? "");
    const template = response.cards.rows[0];
    if (!revalidating && template) response.cards.rows.push(...Array.from({ length: 49 }, (_, index) => ({
      ...template,
      id: `11111111-1111-4111-8111-${(200 + index).toString().padStart(12, "0")}`,
      merchantName: `Bulk Card ${index}`,
      createdAt: new Date(to - (40 + index) * 60_000).toISOString(),
      updatedAt: new Date(to - (40 + index) * 60_000).toISOString(),
    })));
    if (switched) response.walletAddress = "0x3333333333333333333333333333333333333333";
    if (revalidating || switched) {
      response.transfers = switched ? [] : response.transfers.slice(0, 1);
      response.cards.rows = switched ? [] : response.cards.rows.filter((row) => row.merchantName === freshMerchant);
    }
    return json(route, response);
  });
  await page.goto("/home");
  await expect(rows).toHaveCount(3);
  const before = await rows.allTextContents();
  revalidating = true;
  await page.clock.fastForward(11_000);
  await requestBackgroundRevalidation(page, () => reads, 1);
  await expect.poll(async () => {
    await page.clock.runFor(500);
    return reads;
  }).toBeGreaterThanOrEqual(2);
  await expect(rows).toHaveText(before);
  let previous: string | null = null;
  const expected = [1, 3, 1];
  await expect.poll(async () => {
    const value = await readIndexedOwnerCache(page);
    const persisted: unknown = value ? JSON.parse(await decodeOwnerCache(value)) : null;
    const shown = JSON.stringify(persistedActivityQueries(persisted));
    const settled = shown === previous && shown.includes(JSON.stringify(expected));
    previous = shown;
    return settled;
  }, { intervals: [ownerQueryPersistThrottleMs + 100] }).toBe(true);
  unavailable = true;
  await page.reload();
  await expect(rows).toHaveText(before);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  unavailable = false;
  const settledReads = reads;
  await page.reload();
  await expect(rows).toHaveText(before);
  await page.clock.fastForward(11_000);
  await requestBackgroundRevalidation(page, () => reads, settledReads);
  await expect(rows).toHaveText(before);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  switched = true;
  await page.route("**/api/activity/orders", (route) => json(route, {
    version: 1, owner: { subject: "playwright-smoke-second-subject", accountProvider: sessionBody.accountProvider }, orders: [],
  }));
  await page.route("**/api/session", (route) => json(route, { ...sessionBody, user: { subject: "playwright-smoke-second-subject" },
    smartAccount: { ...sessionBody.smartAccount, address: "0x3333333333333333333333333333333333333333" } }));
  await page.evaluate(() => window.dispatchEvent(new Event("home:playwright-smoke:owner-switch")));
  await expect(feed.getByText("No activity yet", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(0);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toHaveCount(0);
});

test("a full reload restores retained transfers and cards from an onchain-unavailable display page but rejects another owner or currency", async ({ page }) => {
  const { feed, rows } = await setup(page);
  let unavailable = false;
  await page.route("**/api/actions", (route) => json(route, { version: 1, truncated: false, actions: [] }));
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    return unavailable ? route.abort() : json(route, activityResponse(url, false, true));
  });
  await page.goto("/home");
  await expect(rows).toHaveCount(3);
  const before = await rows.allTextContents();
  let previous: string | null = null;
  await expect.poll(async () => {
    const value = await readIndexedOwnerCache(page);
    const persisted: unknown = value ? JSON.parse(await decodeOwnerCache(value)) : null;
    const shown = JSON.stringify(persistedActivityQueries(persisted));
    const settled = shown === previous && shown.includes(JSON.stringify([3, 3, 2]));
    previous = shown;
    return settled;
  }, { intervals: [ownerQueryPersistThrottleMs + 100] }).toBe(true);
  const value = await readIndexedOwnerCache(page);
  if (!value) throw new Error("Persisted owner cache is missing");
  const baseline: { clientState: DehydratedState } = JSON.parse(await decodeOwnerCache(value));
  unavailable = true;
  await page.route("**/__owner-cache-edit", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>cache</title>" }));
  for (const variant of ["retained", "wrong owner", "wrong currency"] as const) {
    await test.step(variant, async () => {
      const persisted = structuredClone(baseline);
      const query = persisted.clientState.queries.find((query) => query.queryKey[1] === "activity");
      const to = query?.queryKey[2];
      if (!query || typeof to !== "string") throw new Error("Persisted Activity query is missing");
      const url = new URL(`/api/activity?to=${encodeURIComponent(to)}`, "http://localhost");
      const partial = activityResponse(url, true);
      partial.cards.rows = [];
      const retained = { ...activityResponse(url, true, true), transfers: activityResponse(url, false).transfers };
      if (variant === "wrong owner") retained.walletAddress = RECIPIENT;
      if (variant === "wrong currency") retained.currency = "EUR";
      query.state.data = { pages: [partial], pageParams: [null], retainedPage: retained };
      await page.goto("/__owner-cache-edit");
      const current = await readIndexedOwnerCache(page);
      if (!current) throw new Error("Persisted owner cache is missing");
      await replaceIndexedOwnerCache(page, current, JSON.stringify(persisted));
      await page.goto("/home");
      if (variant === "retained") {
        await expect(rows).toHaveText(before);
        await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
        await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
        await expect(feed.getByText("End of activity", { exact: true })).toHaveCount(0);
        await expect(feed.getByRole("alert")).toHaveCount(0);
        await expect(feed.getByText(warning)).toHaveCount(0);
      } else {
        await expect(feed.getByRole("alert")).toContainText("Activity is temporarily unavailable.");
        await expect(rows).toHaveCount(0);
        await expect(feed.getByRole("button", { name: new RegExp(`^(${merchant}|${freshMerchant})`) })).toHaveCount(0);
      }
    });
  }
});

test("a panel mounted after an order settles behind the loaded boundary still shows the order the first panel showed", async ({ page }) => {
  await setup(page);
  const [pending] = activityOrdersFixture().orders;
  if (!pending || pending.kind !== "funding") throw new Error("Pending funding fixture is missing");
  const settledAt = new Date(FIXED_NOW - 2 * 3_600_000).toISOString();
  const settled = { ...pending, status: "confirmed" as const, stage: "received" as const, instruction: null, resumable: false, updatedAt: settledAt, movedAt: settledAt };
  let settledReads = 0;
  await page.route("**/api/activity/orders", (route) => {
    if (settledReads > 0) settledReads += 1;
    return json(route, { ...activityOrdersFixture(), orders: [settledReads > 0 ? settled : pending] });
  });
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    if (url.searchParams.has("cursor")) return new Promise<void>(() => {});
    return json(route, { ...activityResponse(url, false), nextCursor: "next-page" });
  });
  const orders = page.locator("#navigation-panel [data-activity-sources]").getByRole("button", { name: /^Add money/ });
  await page.goto("/activity");
  await expect(orders).toHaveCount(1);
  settledReads = 1;
  await expect.poll(async () => {
    await page.clock.runFor(1_000);
    return settledReads;
  }, { timeout: 30_000 }).toBeGreaterThan(1);
  await expect(orders).toHaveCount(1);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
  await expectNavigation(page, /\/home$/);
  await expect(orders).toHaveCount(1);
});
