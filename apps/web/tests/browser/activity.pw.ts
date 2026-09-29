import { expect, test } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";
import { cashoutFixtureAction, cashoutFixtureProgress } from "./feature-map/cashout-fixture";
import { FIXED_NOW } from "./fixtures/fixed-time";

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`Activity anchors older rows at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    const anchor = FIXED_NOW - 60_000;
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
    const action = (id: string, kind: "cash-out" | "send", title: string, status: "confirmed" | "pending", minute: number, amountBaseUnits = "1000000") => ({
      id,
      provider: "cdp-embedded",
      kind,
      summary: { title, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits, direction: "spend" }], warnings: [], expiresAt: timestamp(0) },
      status,
      createdAt: timestamp(minute),
      confirmedAt: timestamp(minute),
      owner: { subject: sessionBody.user.subject, address: wallet, chainId: 8453, accountProvider: sessionBody.accountProvider },
    });
    await page.route("**/api/actions*", (route) => {
      if (new URL(route.request().url()).pathname !== "/api/actions") return route.fallback();
      return json(route, { actions: [
        action("11111111-1111-4111-8111-111111111112", "send", "Pending send", "pending", 0),
        {
          ...action("11111111-1111-4111-8111-111111111113", "cash-out", "Cash out with Peer", "confirmed", 21, "25000000"),
          cashout: { ...cashoutFixtureProgress, platform: "zelle", platformLabel: "Zelle", amountAtomic: "25000000", remainingAtomic: "25000000", updatedAt: timestamp(21) },
        },
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
    const recentList = activitySection.getByRole("list", { name: "Recent" });
    const recentRows = recentList.locator(":scope > li");
    const rowAt = (minute: number) => recentRows
      .filter({ hasNot: page.locator("button[aria-expanded]") })
      .filter({ has: page.locator(`time[datetime="${timestamp(minute)}"]`) });
    const transferRun = (count: number) => recentList.getByRole("button").filter({ hasText: `×${count}` });
    const rows = activitySection.locator("ul > li");
    const pending = rows.filter({ hasText: "Pending send" });
    const cashout = rows.filter({ hasText: "Cash out to Zelle" });
    const retry = activitySection.getByRole("button", { name: "Try again", exact: true });
    await page.goto("/activity");
    await expect(recentRows).toHaveCount(1);
    await expect(transferRun(12)).toHaveCount(1);
    await expect(transferRun(12)).toHaveAccessibleDescription("12 Received USDC transfers");
    await expect(transferRun(12)).toHaveAttribute("aria-expanded", "false");
    await expect(rowAt(12)).toHaveCount(0);
    await transferRun(12).click();
    await expect(transferRun(12)).toHaveAttribute("aria-expanded", "true");
    await expect(transferRun(12)).toHaveAttribute("aria-controls", /.+/);
    const controlledId = await transferRun(12).getAttribute("aria-controls");
    expect(controlledId).toBeTruthy();
    expect(controlledId).not.toMatch(/\s/);
    await expect(recentList).toHaveAttribute("id", controlledId!);
    await expect(rowAt(1)).toBeVisible();
    await expect(rowAt(12)).toHaveCount(1);
    await expect(pending).toHaveCount(1);
    await expect(activitySection.getByRole("heading", { name: "Pending" })).toBeVisible();
    await expect(activitySection.getByRole("heading", { name: "Recent" })).toBeVisible();
    await expect(cashout).toHaveCount(1);
    await expect(activitySection.getByRole("list", { name: "Pending" }).locator("li").filter({ hasText: "Cash out to Zelle" })).toHaveCount(1);
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
    await expect(recentRows).toHaveCount(17);
    await expect(transferRun(16)).toHaveCount(1);
    await expect(transferRun(16)).toHaveAccessibleDescription("16 Received USDC transfers");
    await expect(transferRun(16)).toHaveAttribute("aria-expanded", "true");
    await expect(transferRun(16)).toHaveAttribute("aria-controls", controlledId!);
    await expect(recentList).toHaveAttribute("id", controlledId!);
    await expect(transferRun(12)).toHaveCount(0);
    await expect(rowAt(16)).toHaveCount(1);
    await expect.poll(async () => Math.abs((await position()).top - before.top)).toBeLessThanOrEqual(1);

    await container.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await sparsePageServed;
    await container.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(rowAt(22)).toHaveCount(1);
    await container.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(activitySection.getByRole("status", { name: "" }).filter({ hasText: "End of activity" })).toBeVisible();
    await expect(rowAt(24)).toHaveCount(1);
    await expect(retry).toHaveCount(0);
    const olderTimes = await rows.locator("time[datetime]").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("datetime")));
    expect(olderTimes.indexOf(timestamp(20))).toBeGreaterThanOrEqual(0);
    expect(olderTimes.indexOf(timestamp(20))).toBeLessThan(olderTimes.indexOf(timestamp(22)));
    await container.evaluate((element) => { element.scrollTop = 0; });
    await expect(cashout).toHaveCount(1);
    await expect(pending).toHaveCount(1);
    const newerTimes = await rows.locator("time[datetime]").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("datetime")));
    expect(newerTimes.indexOf(timestamp(21))).toBe(0);
    expect(newerTimes.indexOf(timestamp(0))).toBeLessThan(newerTimes.indexOf(timestamp(1)));
    await expect(recentRows.count()).resolves.toBeGreaterThan(1);
    await expect(transferRun(19)).toHaveCount(1);
    await expect(transferRun(19)).toHaveAttribute("aria-expanded", "true");
    await expect(cashout).toHaveCount(1);
    await expect(pending).toHaveCount(1);
    await expect(retry).toHaveCount(0);
    const pendingTimes = await activitySection.getByRole("list", { name: "Pending" }).locator("time[datetime]").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("datetime")));
    expect(pendingTimes).toEqual([timestamp(21), timestamp(0)]);
    const visiblePositions = await recentRows.evaluateAll((elements) => elements.map((element) => Number((element as HTMLElement).dataset.index)));
    expect(visiblePositions).toEqual([...visiblePositions].sort((a, b) => a - b));
    await expect(recentRows.first()).toHaveAttribute("aria-setsize", "20");
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
test("Activity preserves the visible row through an insertion, reorder, and size correction", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedSignedInSession(page);
  await installApiFixtures(page, { clock: "playwright" });
  const wallet = sessionBody.smartAccount.address;
  const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const now = FIXED_NOW;
  let prepend = false;
  let promote = false;
  let reads = 0;
  await page.route("**/api/actions*", (route) =>
    new URL(route.request().url()).pathname === "/api/actions" ? json(route, { actions: [] }) : route.fallback());
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    reads++;
    const to = url.searchParams.get("to")!;
    const transfers = [...(prepend ? [0] : []), ...Array.from({ length: 24 }, (_, index) => index + 1)]
      .sort((a, b) => (promote && a === 12 ? 0.5 : a) - (promote && b === 12 ? 0.5 : b))
      .map((index) => ({
        id: `8453:${token}:anchor-${index}`,
        logId: `anchor-${index}`,
        chainId: 8453,
        assetId: "usdc",
        tokenAddress: token,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        tokenImageUrl: null,
        walletAddress: wallet,
        fromAddress: (index % 2 || index === 12) ? wallet : "0x2222222222222222222222222222222222222222",
        toAddress: (index % 2 || index === 12) ? "0x2222222222222222222222222222222222222222" : wallet,
        direction: (index % 2 || index === 12) ? "outgoing" : "incoming",
        amountBaseUnits: "1000000",
        blockNumber: String(2000 - (promote && index === 12 ? 1 : index * 2)),
        blockHash: `0x${"ef".repeat(32)}`,
        transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
        logIndex: "1",
        blockTimestamp: new Date(now - (promote && index === 12 ? 90_000 : (index + 1) * 60_000)).toISOString(),
        valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
      }));
    return json(route, {
      version: 1,
      walletAddress: wallet,
      chainId: 8453,
      currency: "USD",
      window: { from: new Date(Date.parse(to) - 24 * 60 * 60_000).toISOString(), to },
      transfers,
      nextCursor: null,
      source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
    });
  });
  const main = page.locator("main[data-app-main-authenticated]");
  const section = main.locator('section[aria-label="Activity"]').last();
  const snapshot = () => main.evaluate((host) => {
    const top = host.getBoundingClientRect().top;
    const row = [...host.querySelectorAll<HTMLElement>('section[aria-label="Activity"] ul > li[data-index]')]
      .find((node) => node.getBoundingClientRect().bottom > top)!;
    return { time: row.querySelector("time")?.dateTime, top: row.getBoundingClientRect().top - top, rowIndex: row.dataset.index };
  });
  await page.goto("/activity");
  await expect(section.locator('ul > li[aria-posinset="1"]')).toBeVisible();
  await main.evaluate((host) => { host.scrollTop = 360; });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const before = await snapshot();
  expect(before.top).toBeLessThan(0);
  prepend = true;
  await page.clock.fastForward(11_000);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => reads).toBeGreaterThan(1);
  await expect(section.locator('ul > li[aria-posinset="1"]')).toHaveAttribute("aria-setsize", "25");
  await expect.poll(async () => Math.abs((await snapshot()).top - before.top)).toBeLessThanOrEqual(1);
  const afterInsert = await snapshot();
  expect(afterInsert.time).toBe(before.time);
  expect(Math.abs(afterInsert.top - before.top)).toBeLessThanOrEqual(1);
  promote = true;
  await page.clock.fastForward(16_000);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => reads).toBeGreaterThan(2);
  await expect.poll(async () => (await snapshot()).rowIndex).toBe("7");
  await expect.poll(async () => Math.abs((await snapshot()).top - before.top)).toBeLessThanOrEqual(1);
  const afterReorder = await snapshot();
  expect(afterReorder.time).toBe(before.time);
  await page.addStyleTag({ content: 'section[aria-label="Activity"] ul > li[aria-posinset="1"] { min-height: 160px; }' });
  await expect.poll(() => section.locator('ul > li[aria-posinset="1"]').evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(150);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(async () => Math.abs((await snapshot()).top - before.top)).toBeLessThanOrEqual(1);
  const afterResize = await snapshot();
  expect(afterResize.time).toBe(before.time);
  expect(Math.abs(afterResize.top - before.top)).toBeLessThanOrEqual(1);
});

test("Activity keeps the visible Recent row fixed when a pending action settles", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedSignedInSession(page);
  await installApiFixtures(page, { clock: "playwright" });
  const now = FIXED_NOW;
  const wallet = sessionBody.smartAccount.address;
  const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const timestamp = (minute: number) => new Date(now - minute * 60_000).toISOString();
  let settled = false;
  let actionReads = 0;
  await page.route("**/api/actions*", (route) => {
    if (new URL(route.request().url()).pathname !== "/api/actions") return route.fallback();
    actionReads++;
    return json(route, { actions: [{
      ...cashoutFixtureAction,
      createdAt: timestamp(0), confirmedAt: timestamp(0), status: settled ? "confirmed" : "pending",
      cashout: { ...cashoutFixtureProgress, state: settled ? "delivered" : "awaiting-buyer", settledAt: settled ? timestamp(0) : null, updatedAt: timestamp(0) },
    }] });
  });
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    const to = url.searchParams.get("to")!;
    return json(route, {
      version: 1, walletAddress: wallet, chainId: 8453, currency: "USD",
      window: { from: new Date(Date.parse(to) - 24 * 60 * 60_000).toISOString(), to },
      transfers: Array.from({ length: 24 }, (_, index) => {
        const minute = index + 1;
        return {
          id: `8453:${token}:pending-anchor-${minute}`, logId: `pending-anchor-${minute}`,
          chainId: 8453, assetId: "usdc", tokenAddress: token, tokenSymbol: "USDC", tokenDecimals: 6,
          tokenImageUrl: null, walletAddress: wallet,
          fromAddress: minute % 2 ? "0x2222222222222222222222222222222222222222" : wallet,
          toAddress: minute % 2 ? wallet : "0x2222222222222222222222222222222222222222",
          direction: minute % 2 ? "incoming" : "outgoing", amountBaseUnits: "1000000", blockNumber: String(2000 - minute),
          blockHash: `0x${"ef".repeat(32)}`, transactionHash: `0x${minute.toString(16).padStart(64, "0")}`,
          logIndex: "1", blockTimestamp: timestamp(minute),
          valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
        };
      }),
      nextCursor: null,
      source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
    });
  });
  const main = page.locator("main[data-app-main-authenticated]");
  const section = main.locator('section[aria-label="Activity"]').last();
  const recent = section.locator("ul").last();
  const anchored = recent.locator("li").filter({ has: page.locator(`time[datetime="${timestamp(7)}"]`) });
  await page.goto("/activity");
  await expect(section.getByRole("heading", { name: "Pending" })).toBeVisible();
  await expect(section.getByRole("list", { name: "Recent" })).toBeVisible();
  await recent.evaluate((list) => {
    const host = list.closest<HTMLElement>("[data-app-main-authenticated]")!;
    host.scrollTop = list.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop + 180;
  });
  await expect(anchored).toBeVisible();
  await expect(anchored).toHaveAttribute("aria-posinset", "7");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const position = () => anchored.evaluate((row) => row.getBoundingClientRect().top);
  const before = await position();
  settled = true;
  await page.clock.fastForward(16_000);
  await expect.poll(() => actionReads).toBeGreaterThan(1);
  await expect(section.getByRole("heading", { name: "Pending" })).toHaveCount(0);
  await expect(anchored).toHaveAttribute("aria-setsize", "25");
  await expect(anchored).toHaveAttribute("aria-posinset", "8");
  await expect.poll(async () => Math.abs((await position()) - before)).toBeLessThanOrEqual(1);
});

test("mobile Activity keeps 300 paginated rows bounded and restores keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const wallet = sessionBody.smartAccount.address;
  const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const timestamp = (index: number) => new Date(FIXED_NOW - (index + 1) * 60_000).toISOString();
  const time = Array.from({ length: 300 }, (_, index) => timestamp(index));
  await page.route("**/api/actions*", (route) => {
    if (new URL(route.request().url()).pathname !== "/api/actions") return route.fallback();
    return json(route, { actions: [] });
  });
  const reads = new Map<number, number>();
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    const pageIndex = Number(url.searchParams.get("cursor") ?? "0");
    const to = url.searchParams.get("to")!;
    const transfers = Array.from({ length: 25 }, (_, position) => {
      const index = pageIndex * 25 + position;
      return {
        id: `8453:${token}:long-${index}`,
        logId: `long-${index}`,
        chainId: 8453,
        assetId: "usdc",
        tokenAddress: token,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        tokenImageUrl: null,
        walletAddress: wallet,
        fromAddress: index % 2 ? wallet : "0x2222222222222222222222222222222222222222",
        toAddress: index % 2 ? "0x2222222222222222222222222222222222222222" : wallet,
        direction: index % 2 ? "outgoing" : "incoming",
        amountBaseUnits: "1000000",
        blockNumber: String(1000 - index),
        blockHash: `0x${"ef".repeat(32)}`,
        transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
        logIndex: "1",
        blockTimestamp: time[index],
        valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
      };
    });
    reads.set(pageIndex, (reads.get(pageIndex) ?? 0) + 1);
    return json(route, {
      version: 1,
      walletAddress: wallet,
      chainId: 8453,
      currency: "USD",
      window: { from: new Date(Date.parse(to) - 24 * 60 * 60_000).toISOString(), to },
      transfers,
      nextCursor: pageIndex === 11 ? null : String(pageIndex + 1),
      source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
    });
  });
  const main = page.locator("main[data-app-main-authenticated]");
  const section = main.locator('section[aria-label="Activity"]').last();
  const rows = section.locator("ul > li[aria-posinset]");
  await page.goto("/activity");
  await expect(rows.first()).toHaveAttribute("aria-setsize", "-1");
  expect(await rows.count()).toBeLessThan(60);
  for (let index = 1; index < 12; index++) {
    await expect.poll(async () => {
      await main.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      return reads.size;
    }, { timeout: 7_000 }).toBeGreaterThan(index);
    expect(await rows.count()).toBeLessThan(70);
  }
  await main.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(section.getByText("End of activity")).toBeVisible();
  await expect(rows.first()).toHaveAttribute("aria-setsize", "300");
  expect(await rows.count()).toBeLessThan(70);
  expect(Object.fromEntries(reads)).toEqual(Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index, 1])));
  await main.evaluate((node) => { node.scrollTop = 0; });
  const opener = section.locator('ul > li[aria-posinset="1"] button');
  await expect(opener).toBeVisible();
  await opener.focus();
  for (let index = 0; index < 25; index++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Number(document.activeElement?.closest("li")?.getAttribute("aria-posinset")))).toBe(26);
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => Number(document.activeElement?.closest("li")?.getAttribute("aria-posinset")))).toBe(25);
  await main.evaluate((node) => { node.scrollTop = 0; });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Received" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close Received details" }).focus();
  await main.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(section.locator('ul > li[aria-posinset="1"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close Received details" }).click();
  await expect(opener).toBeFocused();

  const home = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home" });
  await home.click();
  const homeRows = main.locator('[data-shell-panel]:not([hidden]) [data-activity-feed] ul > li[aria-posinset]');
  await expect(homeRows.first()).toBeVisible();
  await page.addStyleTag({ content: '[data-activity-feed] ul > li[data-index="0"] { min-height: 180px; }' });
  await expect.poll(() => homeRows.first().evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(170);
  await main.evaluate((node) => { node.scrollTop = 8000; });
  const visibleHomeRow = () => main.evaluate((host) => {
    const top = host.getBoundingClientRect().top;
    const row = [...host.querySelectorAll<HTMLElement>('[data-shell-panel]:not([hidden]) [data-activity-feed] ul > li[aria-posinset]')]
      .find((node) => node.getBoundingClientRect().bottom > top);
    return row ? { index: Number(row.dataset.index), top: row.getBoundingClientRect().top - top,
      bottom: row.getBoundingClientRect().bottom - top, scrollTop: host.scrollTop, height: host.clientHeight } : null;
  });
  await expect.poll(async () => (await visibleHomeRow())?.index ?? 0).toBeGreaterThan(60);
  const beforeHome = (await visibleHomeRow())!;
  await page.goBack();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(main.locator('[data-shell-panel][hidden] [data-activity-feed] ul > li[aria-posinset]')).toHaveCount(0);
  await expect(rows.first()).toBeVisible();
  await expect.poll(async () => {
    await main.evaluate((node) => { node.scrollTop = 2200; });
    return rows.first().getAttribute("aria-posinset");
  }).not.toBe("1");
  await page.goForward();
  await expect(page).toHaveURL(/\/home$/);
  await expect(homeRows.first()).toBeVisible();
  await expect.poll(async () => (await visibleHomeRow())?.index ?? 0).toBeGreaterThan(60);
  const visible = (await visibleHomeRow())!;
  expect(Math.abs(visible.scrollTop - beforeHome.scrollTop)).toBeLessThanOrEqual(64);
  expect(Math.abs(visible.index - beforeHome.index)).toBeLessThanOrEqual(1);
  expect(visible.top).toBeLessThan(visible.height);
  expect(visible.bottom).toBeGreaterThan(0);
});

for (const width of [390, 1280]) {
  test(`Activity summary matches a single transfer row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    const wallet = sessionBody.smartAccount.address;
    const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    await page.route("**/api/actions*", (route) =>
      new URL(route.request().url()).pathname === "/api/actions" ? json(route, { actions: [] }) : route.fallback());
    await page.route("**/api/activity*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/activity") return route.fallback();
      const to = url.searchParams.get("to")!;
      return json(route, {
        version: 1, walletAddress: wallet, chainId: 8453, currency: "USD",
        window: { from: new Date(Date.parse(to) - 86400_000).toISOString(), to },
        transfers: [0, 1, 2].map((index) => ({
          id: `8453:${token}:geometry-${index}`, logId: `geometry-${index}`, chainId: 8453,
          assetId: "usdc", tokenAddress: token, tokenSymbol: "USDC", tokenDecimals: 6,
          tokenImageUrl: null, walletAddress: wallet,
          fromAddress: index === 2 ? wallet : "0x2222222222222222222222222222222222222222",
          toAddress: index === 2 ? "0x2222222222222222222222222222222222222222" : wallet,
          direction: index === 2 ? "outgoing" : "incoming", amountBaseUnits: "1000000",
          blockNumber: String(300 - index), blockHash: `0x${"ef".repeat(32)}`,
          transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
          logIndex: "1", blockTimestamp: new Date(Date.parse(to) - (index + 1) * 60000).toISOString(),
          valuation: { status: "priced", currency: "USD", amount: { atoms: "100", scale: 2 }, method: "peg", peg: "USD", close: null, fx: null },
        })), nextCursor: null,
        source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
      });
    });
    await page.goto("/activity");
    const list = page.locator('section[aria-label="Activity"]').last().getByRole("list");
    const summary = list.getByRole("button").filter({ hasText: "×2" });
    const single = list.getByRole("button", { name: /^Sent / });
    await expect(summary).toHaveAccessibleDescription("2 Received USDC transfers");
    await expect(summary).toContainText("Received ×2");
    await expect(summary).toContainText("+2.00 USDC");
    await expect(summary.locator('[data-slot="item-description"]').first()).not.toContainText("transfers");
    const geometry = await Promise.all([summary, single].map((row) => row.evaluate((node) => {
      const title = node.querySelector('[data-slot="item-title"]');
      const date = node.querySelector('[data-slot="item-description"]');
      if (!title || !date) throw new Error("Missing transfer title or date");
      return {
        height: node.getBoundingClientRect().height,
        titleDateGap: date.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
      };
    })));
    expect(Math.abs(geometry[0]!.height - geometry[1]!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry[0]!.titleDateGap - geometry[1]!.titleDateGap)).toBeLessThanOrEqual(1);
    const mark = summary.locator("[data-mark-stack]");
    await expect(mark).toHaveCount(1);
    expect(await mark.evaluate((node) => node.getBoundingClientRect().width)).toBe(32);
  });
}
