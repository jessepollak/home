import { expect, test } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`Activity anchors older rows at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedSignedInSession(page);
    await installApiFixtures(page);
    const anchor = Date.now() - 60_000;
    const timestamp = (minute: number) => new Date(anchor - minute * 60_000).toISOString();
    const wallet = sessionBody.smartAccount.address;
    const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const recipient = "0x2222222222222222222222222222222222222222";
    const transfer = (minute: number) => ({
      id: `8453:${token}:history-${minute}`,
      logId: `history-${minute}`,
      chainId: 8453,
      assetId: "usdc",
      tokenAddress: token,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      tokenImageUrl: null,
      walletAddress: wallet,
      fromAddress: recipient,
      toAddress: wallet,
      direction: "incoming",
      amountBaseUnits: String(minute * 1_000_000),
      blockNumber: String(1000 - minute),
      blockHash: `0x${"ef".repeat(32)}`,
      transactionHash: `0x${minute.toString(16).padStart(64, "0")}`,
      logIndex: "1",
      blockTimestamp: timestamp(minute),
      valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
    });
    const action = (id: string, kind: "cash-out" | "send", title: string, status: "confirmed" | "pending", minute: number) => ({
      id,
      provider: "cdp-embedded",
      kind,
      summary: { title, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }], warnings: [], expiresAt: timestamp(0) },
      status,
      createdAt: timestamp(minute),
      confirmedAt: timestamp(minute),
      owner: { subject: sessionBody.user.subject, address: wallet, chainId: 8453, accountProvider: sessionBody.accountProvider },
    });
    await page.route("**/api/actions*", (route) => {
      if (new URL(route.request().url()).pathname !== "/api/actions") return route.fallback();
      return json(route, { actions: [
        action("11111111-1111-4111-8111-111111111112", "send", "Pending send", "pending", 0),
        action("11111111-1111-4111-8111-111111111113", "cash-out", "Cash out with Peer", "confirmed", 21),
      ] });
    });
    let releasePageTwo!: () => void;
    const pageTwoHeld = new Promise<void>((resolve) => { releasePageTwo = resolve; });
    let observePageTwo!: () => void;
    const pageTwoObserved = new Promise<void>((resolve) => { observePageTwo = resolve; });
    let observeSparsePage!: () => void;
    const sparsePageServed = new Promise<void>((resolve) => { observeSparsePage = resolve; });
    const reads = new Map<string, number>();
    await page.route("**/api/activity*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/activity") return route.fallback();
      const cursor = url.searchParams.get("cursor") ?? "initial";
      reads.set(cursor, (reads.get(cursor) ?? 0) + 1);
      if (cursor === "page-2") {
        observePageTwo();
        await pageTwoHeld;
      }
      if (cursor === "page-4" && reads.get(cursor) === 1) {
        return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      }
      const to = url.searchParams.get("to")!;
      const pages: Record<string, { minutes: number[]; nextCursor: string | null }> = {
        initial: { minutes: Array.from({ length: 12 }, (_, index) => index + 1), nextCursor: "page-2" },
        "page-2": { minutes: [13, 14, 15, 16], nextCursor: "page-3" },
        "page-3": { minutes: [], nextCursor: "page-4" },
        "page-4": { minutes: [20, 22], nextCursor: "page-5" },
        "page-5": { minutes: [24], nextCursor: null },
      };
      const data = pages[cursor]!;
      await json(route, {
        version: 1,
        walletAddress: wallet,
        chainId: 8453,
        currency: url.searchParams.get("currency") ?? "USD",
        window: { from: new Date(Date.parse(to) - 24 * 60 * 60_000).toISOString(), to },
        transfers: data.minutes.map(transfer),
        nextCursor: data.nextCursor,
        source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
      });
      if (cursor === "page-3") observeSparsePage();
    });

    const container = page.locator("[data-app-main-authenticated]");
    const activitySection = container.locator('section[aria-label="Activity"]').last();
    const rows = activitySection.locator("ol > li");
    const rowAt = (minute: number) => rows.filter({ has: page.locator(`time[datetime="${timestamp(minute)}"]`) });
    const pending = rows.filter({ hasText: "Pending send" });
    const cashout = rows.filter({ hasText: "Cash out with Peer" });
    const retry = activitySection.getByRole("button", { name: "Try again", exact: true });
    await page.goto("/activity");
    await expect(rowAt(12)).toHaveCount(1);
    await expect(pending).toHaveCount(1);
    await expect(cashout).toHaveCount(0);
    await container.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await pageTwoObserved;
    await expect(rowAt(12)).toBeVisible();
    const position = () => rowAt(12).evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      scrollTop: element.closest("[data-app-main-authenticated]")!.scrollTop,
    }));
    const before = await position();
    expect(before.scrollTop).toBeGreaterThan(0);
    releasePageTwo();
    await expect(rowAt(16)).toHaveCount(1);
    const after = await position();
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1);

    await container.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await sparsePageServed;
    await container.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(rowAt(22)).toHaveCount(1);
    await container.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(activitySection.getByRole("status", { name: "" }).filter({ hasText: "End of activity" })).toBeVisible();
    await expect(rowAt(24)).toHaveCount(1);
    await expect(cashout).toHaveCount(1);
    await expect(pending).toHaveCount(1);
    await expect(retry).toHaveCount(0);
    const times = await rows.locator("time[datetime]").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("datetime")));
    expect(times.indexOf(timestamp(20))).toBeLessThan(times.indexOf(timestamp(21)));
    expect(times.indexOf(timestamp(21))).toBeLessThan(times.indexOf(timestamp(22)));
    expect(times.indexOf(timestamp(0))).toBeLessThan(times.indexOf(timestamp(1)));
    expect(Object.fromEntries(reads)).toEqual({ initial: 1, "page-2": 1, "page-3": 1, "page-4": 2, "page-5": 1 });
  });
}

for (const path of ["/home", "/activity"]) {
  test(`${path} renders the fixture transfer with fiat above native quantity`, async ({ page }) => {
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto(path);

    await expect(
      page.locator("main").getByRole("button", { name: /^Received .* \+\$25\.00 \+25\.00 USDC$/ }).first(),
    ).toBeVisible();
  });
}
