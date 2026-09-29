import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures, json, RECIPIENT, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";

const wallet = sessionBody.smartAccount.address;
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const warning = "Some activity is unavailable";
const merchant = "Fixture Coffee";

function activityResponse(url: URL, partial: boolean) {
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
    cards: { status: "ready", rows: [{
      id: "ipi_fixturerecovery1",
      kind: "transaction",
      amountMinor: "450",
      currency: "USD",
      merchantName: merchant,
      merchantCategory: null,
      status: "completed",
      declineReasonCode: null,
      createdAt: new Date(Date.parse(to) - 30 * 60_000).toISOString(),
      updatedAt: new Date(Date.parse(to) - 30 * 60_000).toISOString(),
    }] },
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

async function setup(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const createdAt = new Date(Date.now() - 5 * 60_000).toISOString();
  await page.route("**/api/actions*", (route) =>
    new URL(route.request().url()).pathname === "/api/actions"
      ? json(route, { actions: [{
        id: "11111111-1111-4111-8111-111111111112",
        provider: "cdp-embedded",
        kind: "send",
        summary: { title: "Fixture send", amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }], warnings: [], expiresAt: createdAt },
        status: "confirmed",
        createdAt,
        confirmedAt: createdAt,
        owner: { subject: sessionBody.user.subject, address: wallet, chainId: 8453, accountProvider: sessionBody.accountProvider },
      }] }) : route.fallback());
  const feed = page.locator('[data-shell-panel]:not([hidden]) [data-activity-feed]');
  return { feed, rows: feed.getByRole("button", { name: /^(Received|Sent) .*USDC$/ }) };
}

test("background revalidation keeps loaded rows when onchain history is briefly unavailable", async ({ page }) => {
  const { feed, rows } = await setup(page);
  let reads = 0;
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    reads++;
    return json(route, activityResponse(url, reads > 1));
  });
  await page.goto("/home");
  await expect(rows).toHaveCount(3);
  await page.clock.fastForward(11_000);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => reads).toBeGreaterThan(1);
  await page.clock.runFor(2_500);
  await expect(rows).toHaveCount(3);
  await expect(feed.getByText(warning)).toHaveCount(0);
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
