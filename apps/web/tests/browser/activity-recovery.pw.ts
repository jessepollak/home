import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures, json, RECIPIENT, seedSignedInSession } from "./fixtures/api";
import { requestBackgroundRevalidation } from "./fixtures/background-revalidation";
import { sessionBody } from "./fixtures/bodies";
import { FIXED_NOW } from "./fixtures/fixed-time";

const wallet = sessionBody.smartAccount.address;
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const warning = "Some activity is unavailable";
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

test("a newer-window partial snapshot replaces a superseded authorization with its transaction", async ({ page }) => {
  const { feed, rows } = await refreshWithNewerCards(page, { supersede: true });
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}.*Pending`) })).toHaveCount(0);
  await expect(feed.getByRole("button", { name: settledMerchant })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toHaveCount(1);
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("a same-window read completed during a newer-window card read cannot restore its superseded authorization", async ({ page }) => {
  const { feed, rows } = await refreshWithNewerCards(page, { supersede: true, revalidationWhileNewerReadHeld: true });
  await expect(feed.getByRole("button", { name: settledMerchant })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}.*Pending`) })).toHaveCount(0);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toHaveCount(1);
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
    await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}.*Pending`) })).toHaveCount(0);
    await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toHaveCount(1);
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

test("healthy same-window revalidation removes a missing authorization without losing newer-only cards", async ({ page }) => {
  const { feed, rows, currentWindowReads } = await refreshWithNewerCards(page, { revalidationRemovesAuthorization: true });
  const authorization = feed.getByRole("button", { name: /^Fixture Market.*Pending/ });
  await expect(authorization).toBeVisible();
  await page.clock.fastForward(11_000);
  const readsBeforeRevalidation = currentWindowReads();
  await requestBackgroundRevalidation(page, currentWindowReads, readsBeforeRevalidation);
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return feed.getByRole("button", { name: /^Fixture Market/ }).count();
  }).toBe(0);
  await expect(feed.getByRole("button", { name: /^Fixture Market/ })).toHaveCount(0);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("partial same-window revalidation removes a missing authorization without losing newer-only cards or transfers", async ({ page }) => {
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
    return feed.getByRole("button", { name: /^Fixture Market/ }).count();
  }, { timeout: 15_000 }).toBe(0);
  expect(currentWindowReads()).toBeGreaterThanOrEqual(readsBeforeRevalidation + 3);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("partial same-window revalidation removes a late-persisted authorization when cards match the old-window cache", async ({ page }) => {
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
    return feed.getByRole("button", { name: /^Fixture Market/ }).count();
  }, { timeout: 15_000 }).toBe(0);
  expect(currentWindowReads()).toBeGreaterThanOrEqual(readsBeforeRevalidation + 3);
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${freshMerchant}`) })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});

test("older-window card-source failure keeps newer cards and shows its warning", async ({ page }) => {
  const { feed, rows, currentWindowReads } = await refreshWithNewerCards(page, { revalidationCardsUnavailable: true });
  await page.clock.fastForward(11_000);
  const readsBeforeRevalidation = currentWindowReads();
  await requestBackgroundRevalidation(page, currentWindowReads, readsBeforeRevalidation);
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return feed.getByText("Card purchases may be out of date.").count();
  }).toBe(1);
  await expect(feed.getByText("Card purchases may be out of date.")).toBeVisible();
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

test("Reload retries a failed onchain read and clears the warning", async ({ page }) => {
  const { feed, rows } = await setup(page);
  let healthy = false;
  let reads = 0;
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    reads++;
    return json(route, activityResponse(url, !healthy));
  });
  await page.goto("/home");
  await expect.poll(() => reads).toBeGreaterThan(0);
  await page.clock.runFor(2_500);
  await expect(feed.getByText(warning)).toBeVisible();
  await expect(feed.getByRole("button", { name: new RegExp(`^${merchant}`) })).toBeVisible();
  const readsBeforeReload = reads;
  healthy = true;
  await feed.getByRole("button", { name: "Reload activity" }).click();
  await expect.poll(() => reads).toBeGreaterThan(readsBeforeReload);
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
});
