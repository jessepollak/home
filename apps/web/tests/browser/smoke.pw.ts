import { expect, test, type Page, type Route } from "@playwright/test";
import { parsePortfolioValuationSnapshot } from "../../shared/portfolio/parse-valuation";

const OWNER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const USER_OPERATION_HASH = `0x${"ab".repeat(32)}`;
const CREATED_AT = new Date().toISOString();
const EXPIRES_AT = new Date(Date.now() + 10 * 60_000).toISOString();

type OperationStatus = "prepared" | "submitting" | "submitted";

function action() {
  const amount = "1000000";
  return {
    id: ACTION_ID,
    reviewHash: "a".repeat(64),
    owner: { subject: "playwright-smoke-subject", address: OWNER, chainId: 8453, accountProvider: "cdp-embedded" },
    kind: "send",
    title: "Send USDC",
    calls: [{
      to: USDC,
      data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${BigInt(amount).toString(16).padStart(64, "0")}`,
      value: "0",
    }],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: amount, direction: "spend" }],
    warnings: [`Recipient: ${RECIPIENT}`, "Network fee shown by wallet."],
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  };
}

function operation(status: OperationStatus) {
  const prepared = action();
  return {
    action: prepared,
    status,
    attemptCount: status === "prepared" ? 0 : 1,
    ...(status === "prepared" ? {} : { claimedAt: prepared.createdAt }),
    ...(status === "submitted" ? { userOperationHash: USER_OPERATION_HASH } : {}),
    createdAt: prepared.createdAt,
    updatedAt: prepared.createdAt,
  };
}

function valuation() {
  const usdcKey = `eip155:8453/erc20:${USDC}`;
  const holdings = [
    { kind: "direct", id: "eth", assetKey: "eip155:8453/native", name: "Ethereum", symbol: "ETH", decimals: 18, assetKind: "native", contractAddress: null, cashCurrency: null, balanceBaseUnits: "0", readStatus: "ready" },
    { kind: "direct", id: "usdc", assetKey: usdcKey, name: "US dollar", symbol: "USDC", decimals: 6, assetKind: "erc20", contractAddress: USDC, cashCurrency: "USD", balanceBaseUnits: "12340000", readStatus: "ready" },
    ...["0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61", "0x7bfa7c4f149e7415b73bdedfe609237e29cbf34a", "0xbeef010f9cb27031ad51e3333f9af9c6b1228183"].map((address, index) => ({ kind: "vault-position", id: `vault-${index}`, assetKey: `eip155:8453/erc20:${address}`, name: `Vault ${index}`, symbol: "USDC vault", vaultAddress: address, decimals: 18, underlyingAssetKey: usdcKey, underlyingSymbol: "USDC", underlyingDecimals: 6, sharesBaseUnits: "0", underlyingBaseUnits: "0", readStatus: "ready", conversionMethod: "erc4626-convertToAssets" })),
  ];
  const source = { provider: "Coinbase Exchange Rates", method: "fixture", fetchedAt: new Date().toISOString(), asOf: null, timeBasis: "retrieved-at" };
  return {
    version: 2, walletAddress: OWNER, chainId: 8453, selectedRegion: "US", quoteCurrency: "USD",
    block: { number: "16", hash: `0x${"cd".repeat(32)}`, timestamp: String(Math.floor(Date.now() / 1000)) }, fetchedAt: source.fetchedAt,
    inventory: { scope: "configured-base-assets-v1", walletDiscoveryComplete: false, holdings, omissions: [] }, prices: [],
    fx: { baseCurrency: "USD", quoteCurrency: "USD", quoteUnitsPerUsd: { atoms: "1", scale: 0 }, sourceValue: "1", status: "fresh", source },
    nativeEthQuote: { baseCurrency: "USD", assetSymbol: "ETH", assetUnitsPerUsd: { atoms: "5", scale: 4 }, sourceValue: "0.0005", status: "fresh", source },
    lines: holdings.map(({ assetKey }) => ({ holdingAssetKey: assetKey, valueCurrency: "USD", value: { atoms: assetKey === usdcKey ? "1234" : "0", scale: assetKey === usdcKey ? 2 : 0 }, status: "priced", reason: null })),
    cashBuckets: [{ id: `cash:${usdcKey}`, roles: ["canonical-usd", "selected-local"], assetKey: usdcKey, symbol: "USDC", denominationCurrency: "USD", tokenAmountBaseUnits: "12340000", tokenDecimals: 6, indicativeValue: { atoms: "1234", scale: 2 }, valuationStatus: "priced" }],
    total: { label: "supported-portfolio-value", status: "all-supported-read-holdings-priced", value: { atoms: "1234", scale: 2 }, currency: "USD", unpricedAssetKeys: [], unavailableAssetKeys: [] },
  };
}

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function installApiFixtures(page: Page) {
  let status: OperationStatus = "prepared";
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/session") return json(route, { user: { subject: "playwright-smoke-subject" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" });
    if (path === "/api/portfolio/valuation") return json(route, valuation());
    if (path === "/api/portfolio") return json(route, { walletAddress: OWNER, chainId: 8453, blockNumber: "16", blockHash: `0x${"cd".repeat(32)}`, blockTimestamp: "100", fetchedAt: new Date().toISOString(), assets: [{ id: "usdc", symbol: "USDC", decimals: 6, kind: "erc20", tokenAddress: USDC, balanceBaseUnits: "12340000" }, { id: "eth", symbol: "ETH", decimals: 18, kind: "native", balanceBaseUnits: "0" }] });
    if (path === "/api/actions/operations") return json(route, url.searchParams.get("scope") === "unresolved-send"
      ? { scope: "unresolved-send", operations: status === "prepared" ? [] : [operation(status)] }
      : { operations: status === "prepared" ? [] : [operation(status)] });
    if (path === "/api/actions/send/prepare") { status = "prepared"; return json(route, action()); }
    if (path === `/api/actions/${ACTION_ID}/claim`) { status = "submitting"; return json(route, { action: action(), disposition: "dispatch", operation: operation(status) }); }
    if (path === `/api/actions/${ACTION_ID}/submission`) { status = "submitted"; return json(route, { operation: operation(status) }); }
    if (path === `/api/actions/${ACTION_ID}`) return json(route, { operation: operation(status) });
    if (path === "/api/activity") return json(route, { version: 1, walletAddress: OWNER, chainId: 8453, from: "2026-09-01T00:00:00.000Z", to: new Date().toISOString(), transfers: [], nextCursor: null, source: { provider: "Playwright", method: "fixture", fetchedAt: new Date().toISOString() } });
    if (path === "/api/basename-profile") return json(route, { profile: null });
    return json(route, {});
  });
}

async function signIn(page: Page) {
  await page.goto("/?account=signin");
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function typeAmount(page: Page, value: string) {
  for (const char of value) {
    const name = char === "." ? "Decimal point" : char;
    await page.getByRole("button", { name, exact: true }).click();
  }
}

async function amountMetrics(page: Page) {
  return page.evaluate(() => {
    const node = document.querySelector<HTMLElement>("[data-primary-amount]");
    if (!node) return null;
    const style = getComputedStyle(node);
    const range = document.createRange();
    range.selectNodeContents(node);
    const textWidth = range.getBoundingClientRect().width;
    const padding = (name: "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft") =>
      Number.parseFloat(style[name]) || 0;
    return {
      text: node.textContent,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      fontSize: Number.parseFloat(style.fontSize),
      overflow: style.overflow,
      paddingTop: padding("paddingTop"),
      paddingRight: padding("paddingRight"),
      paddingBottom: padding("paddingBottom"),
      paddingLeft: padding("paddingLeft"),
      textWidth,
    };
  });
}

test("signed-in send survives reload without a second wallet dispatch", async ({ page }) => {
  parsePortfolioValuationSnapshot(valuation(), {
    subject: "playwright-smoke-subject",
    smartAccountAddress: OWNER,
    chainId: 8453,
  }, "US");
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);
  await expect(page.getByText("$12.34", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "To" }).fill(RECIPIENT);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm" })).toBeVisible();
  await page.getByRole("button", { name: "Send $1.00" }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("home:playwright-smoke:dispatch-count"))).toBe("1");

  await page.reload();
  await expect(page.getByText("Send USDC", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check status" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("home:playwright-smoke:dispatch-count"))).toBe("1");

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("$12.34", { exact: true })).toHaveCount(0);
});

test("send modal leaves action-row trigger styling at 390px", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.setViewportSize({ width: 390, height: 720 });
  await signIn(page);

  await expect(page.locator(".action-row [data-action-trigger]")).toHaveCount(2);
  await page.getByRole("button", { name: "Send" }).click();
  const dialog = page.getByRole("dialog", { name: "Send" });
  await expect(dialog).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => Boolean(document.querySelector("dialog")?.closest(".action-row"))),
  ).toBe(false);

  const primary = dialog.getByRole("button", { name: "Continue" });
  await expect(primary).toBeVisible();
  const primaryStyle = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      fontSize: Number.parseFloat(style.fontSize),
    };
  });
  // The action-row trigger rule (white surface, 0.78rem) must not reach the
  // portaled modal footer; the modal keeps its own blue surface and 0.92rem.
  expect(primaryStyle.backgroundColor).toBe("rgb(0, 82, 255)");
  expect(primaryStyle.fontSize).toBeCloseTo(14.72, 1);
});

test("money amount auto-fits the longest local and native values at 320px and 390px", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page);
  await page.getByRole("button", { name: "Send" }).click();

  const amount = page.locator("[data-primary-amount]");
  await typeAmount(page, "123456789012.123456");
  await expect(amount).toHaveText("$123456789012.123456");

  const at320 = await amountMetrics(page);
  expect(at320?.text).toBe("$123456789012.123456");
  expect(at320?.clientWidth).toBeGreaterThanOrEqual(270);
  expect(at320?.clientWidth).toBeLessThanOrEqual(285);
  expect(at320?.scrollWidth).toBeLessThanOrEqual((at320?.clientWidth ?? 0) + 2);
  expect(at320?.fontSize).toBeGreaterThanOrEqual(20);
  expect(at320?.fontSize).toBeLessThan(51.2);
  expect(at320?.overflow).toBe("visible");
  expect(at320?.paddingLeft).toBeGreaterThanOrEqual(16);
  expect(at320?.paddingRight).toBeGreaterThanOrEqual(16);
  expect(at320?.paddingTop).toBeGreaterThanOrEqual(12);
  expect(at320?.textWidth).toBeLessThanOrEqual(
    (at320?.clientWidth ?? 0) - (at320?.paddingLeft ?? 0) - (at320?.paddingRight ?? 0) + 2,
  );

  await page.getByRole("button", { name: /as the primary amount/ }).click();
  await expect(amount).toHaveText("123456789012.123456");
  const native = await amountMetrics(page);
  expect(native?.text).toBe("123456789012.123456");
  expect(native?.scrollWidth).toBeLessThanOrEqual((native?.clientWidth ?? 0) + 2);
  expect(native?.fontSize).toBeGreaterThanOrEqual(20);
  expect(native?.fontSize).toBeLessThan(51.2);
  expect(native?.paddingLeft).toBeGreaterThanOrEqual(16);
  expect(native?.textWidth).toBeLessThanOrEqual(
    (native?.clientWidth ?? 0) - (native?.paddingLeft ?? 0) - (native?.paddingRight ?? 0) + 2,
  );

  await page.setViewportSize({ width: 390, height: 720 });
  await expect.poll(async () => (await amountMetrics(page))?.fontSize)
    .toBeGreaterThan((native?.fontSize ?? 0) + 1);
  const at390 = await amountMetrics(page);
  expect(at390?.clientWidth).toBeGreaterThanOrEqual(340);
  expect(at390?.clientWidth).toBeLessThanOrEqual(355);
  expect(at390?.scrollWidth).toBeLessThanOrEqual((at390?.clientWidth ?? 0) + 2);
  expect(at390?.fontSize).toBeGreaterThanOrEqual(20);
  expect(at390?.fontSize).toBeLessThan(57.6);
  expect(at390?.paddingLeft).toBeGreaterThanOrEqual(16);
  expect(at390?.textWidth).toBeLessThanOrEqual(
    (at390?.clientWidth ?? 0) - (at390?.paddingLeft ?? 0) - (at390?.paddingRight ?? 0) + 2,
  );
});

test("money amount recomputes for text scaling", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page);
  await page.getByRole("button", { name: "Send" }).click();

  const amount = page.locator("[data-primary-amount]");
  await typeAmount(page, "5");
  await expect(amount).toHaveText("$5");

  const before = await amountMetrics(page);
  expect(before?.fontSize).toBeGreaterThanOrEqual(44);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect.poll(async () => (await amountMetrics(page))?.fontSize).toBeGreaterThan((before?.fontSize ?? 0) + 5);
  await expect(amount).toHaveText("$5");
});


test("account sign-in and settings stay reachable at 390px, 320px, and 200% text", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?account=signin");

  const dialog = page.locator("dialog");
  const close = page.getByRole("button", { name: "Close sign in" });
  const email = page.getByLabel("Email address");
  const continueWithEmail = page.getByRole("button", { name: "Continue with email" });
  const signInWithBase = page.getByRole("button", { name: "Sign in with Base Account" });
  const expectAlignedHeader = async (name: string) => {
    const heading = page.getByRole("heading", { level: 2, name });
    const [headingBox, closeBox, iconBox] = await Promise.all([
      heading.boundingBox(),
      close.boundingBox(),
      close.locator("svg").boundingBox(),
    ]);
    if (!headingBox || !closeBox || !iconBox) {
      throw new Error("Account modal header is not measurable");
    }
    expect(
      Math.abs(
        headingBox.y + headingBox.height / 2
        - (closeBox.y + closeBox.height / 2),
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        iconBox.y + iconBox.height / 2
        - (closeBox.y + closeBox.height / 2),
      ),
    ).toBeLessThanOrEqual(1);
  };

  await expect(page.getByRole("dialog", { name: "Sign in to Home" })).toBeVisible();
  await expect(signInWithBase).toBeVisible();
  await expectAlignedHeader("Sign in to Home");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expectAlignedHeader("Sign in to Home");

  for (const control of [close, email, continueWithEmail, signInWithBase]) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(signInWithBase).toBeVisible();
  await expectAlignedHeader("Sign in to Home");
  expect(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await email.fill("fixture@example.test");
  await email.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Check your email" })).toBeVisible();
  await expectAlignedHeader("Check your email");

  await page.setViewportSize({ width: 320, height: 720 });
  await expectAlignedHeader("Check your email");
  expect(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Preferences" })).toBeVisible();
  const country = page.getByRole("combobox", { name: "Country" });
  const signOut = page.getByRole("button", { name: "Sign out" });
  for (const control of [country, signOut]) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await country.click();
  await page.getByRole("option", { name: /United Kingdom/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(country).toBeVisible();
  await expect(signOut).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

type MoneySheetMotionSample = {
  t: number;
  y: number;
  height: number;
  owner: string;
  state: string;
};

function compactMotionOwners(samples: MoneySheetMotionSample[]) {
  return samples.reduce<string[]>((owners, sample) => {
    if (owners.at(-1) !== sample.owner) owners.push(sample.owner);
    return owners;
  }, []);
}

function expectMonotonic(values: number[], direction: "up" | "down") {
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (direction === "up") expect(delta).toBeLessThanOrEqual(0.75);
    else expect(delta).toBeGreaterThanOrEqual(-0.75);
  }
}

test.describe("MoneyModal painted motion", () => {
  test("opens, throws up, reverses, and closes with one position owner", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
    await installApiFixtures(page);
    await signIn(page);

    const beginTrace = async () => page.evaluate(() => {
      const debug = globalThis as typeof globalThis & {
        moneySheetDebug?: { samples: MoneySheetMotionSample[]; stop: boolean };
      };
      const trace = { samples: [] as MoneySheetMotionSample[], stop: false };
      debug.moneySheetDebug = trace;
      const started = performance.now();
      const sample = () => {
        const sheet = document.querySelector<HTMLElement>("dialog[open] [data-money-sheet]");
        if (sheet) {
          const rect = sheet.getBoundingClientRect();
          trace.samples.push({
            t: performance.now() - started,
            y: rect.y,
            height: rect.height,
            owner: sheet.dataset.positionOwner ?? "missing",
            state: sheet.dataset.state ?? "missing",
          });
        }
        if (!trace.stop) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const endTrace = async () => page.evaluate(() => {
      const debug = globalThis as typeof globalThis & {
        moneySheetDebug?: { samples: MoneySheetMotionSample[]; stop: boolean };
      };
      if (!debug.moneySheetDebug) return [];
      debug.moneySheetDebug.stop = true;
      return debug.moneySheetDebug.samples;
    });
    const waitForIdle = async () => expect.poll(() => page.locator(
      "dialog[open] [data-money-sheet]",
    ).getAttribute("data-position-owner")).toBe("idle");
    const gesture = async (moves: Array<{ distance: number; pause: number }>) => {
      const box = await page.locator("dialog[open] [data-money-sheet-grabber]").boundingBox();
      if (!box) throw new Error("MoneyModal grabber is not measurable");
      const x = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(x, startY);
      await page.mouse.down();
      for (const move of moves) {
        await page.mouse.move(x, startY + move.distance, { steps: 3 });
        if (move.pause) await page.waitForTimeout(move.pause);
      }
      await page.mouse.up();
    };

    await beginTrace();
    await page.getByRole("button", { name: "Send" }).click();
    await waitForIdle();
    await page.waitForTimeout(200);
    const openSamples = await endTrace();

    const openGrabber = page.locator("dialog[open] [data-money-sheet-grabber]");
    const hitBox = await openGrabber.boundingBox();
    const visibleGrabberBox = await openGrabber.locator(":scope > span").boundingBox();
    expect(hitBox?.width).toBeGreaterThanOrEqual(44);
    expect(hitBox?.height).toBeGreaterThanOrEqual(44);
    expect(visibleGrabberBox?.height).toBe(4);
    expect((visibleGrabberBox?.y ?? 0) - (hitBox?.y ?? 0)).toBeCloseTo(8, 1);

    await beginTrace();
    await gesture([{ distance: 120, pause: 40 }, { distance: -20, pause: 0 }]);
    await waitForIdle();
    await page.waitForTimeout(200);
    const throwSamples = await endTrace();

    await beginTrace();
    await gesture([{ distance: 220, pause: 160 }, { distance: 190, pause: 0 }]);
    await waitForIdle();
    await page.waitForTimeout(200);
    const reverseSamples = await endTrace();
    await expect(page.getByRole("dialog", { name: "Send" })).toBeVisible();

    await beginTrace();
    await page.getByRole("button", { name: "Close send dialog" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const closeSamples = await endTrace();

    expect(compactMotionOwners(openSamples)).toEqual(["opening", "idle"]);
    expect(compactMotionOwners(throwSamples)).toEqual(["idle", "drag", "idle"]);
    expect(compactMotionOwners(reverseSamples)).toEqual(["idle", "drag", "returning", "idle"]);
    expect(compactMotionOwners(closeSamples)).toEqual(["idle", "closing"]);

    const openStart = openSamples.find(({ owner }) => owner === "opening")!;
    const openEnd = openSamples.find(({ owner }) => owner === "idle")!;
    const openDuration = openEnd.t - openStart.t;
    expect(openDuration).toBeGreaterThanOrEqual(300);
    expect(openDuration).toBeLessThanOrEqual(450);
    const visibleOpen = openSamples.filter(({ t, y }) => t >= openStart.t && y < 843);
    expectMonotonic(visibleOpen.map(({ y }) => y), "up");
    expect(
      Math.max(...visibleOpen.map(({ height }) => height))
      - Math.min(...visibleOpen.map(({ height }) => height)),
    ).toBeLessThanOrEqual(1);

    const throwDragEnd = throwSamples.findLast(({ owner }) => owner === "drag")!.t;
    const throwSettled = throwSamples.filter(({ t }) => t > throwDragEnd);
    const openY = throwSettled.at(-1)!.y;
    expect(Math.max(...throwSettled.map(({ y }) => Math.abs(y - openY))))
      .toBeLessThanOrEqual(0.75);

    const returning = reverseSamples.filter(({ owner }) => owner === "returning");
    expectMonotonic(returning.map(({ y }) => y), "up");
    expect(Math.min(...returning.map(({ y }) => y))).toBeGreaterThanOrEqual(openY - 0.75);

    const closing = closeSamples.filter(({ owner }) => owner === "closing");
    const closeDuration = closing.at(-1)!.t - closing[0].t + 16;
    expectMonotonic(closing.map(({ y }) => y), "down");
    expect(Math.max(...closing.map(({ y }) => y))).toBeLessThanOrEqual(844.5);
    expect(closeDuration).toBeGreaterThanOrEqual(300);
    expect(closeDuration).toBeLessThanOrEqual(450);

    const measurements = {
      viewport: "390x844",
      openDurationMs: Math.round(openDuration),
      closeDurationMs: Math.round(closeDuration),
      openHeightPx: Math.round(openSamples.at(-1)!.height),
      owners: {
        open: compactMotionOwners(openSamples),
        throwUp: compactMotionOwners(throwSamples),
        dragPauseReverse: compactMotionOwners(reverseSamples),
        close: compactMotionOwners(closeSamples),
      },
    };
    console.log(`MONEY_MODAL_MOTION ${JSON.stringify(measurements)}`);
    await testInfo.attach("money-modal-motion-measurements", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
  });
});
