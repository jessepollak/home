import { createHash, createHmac } from "node:crypto";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type { RegionId } from "../../config/regions";
import { parseBalancesSnapshot } from "../../shared/balances/contract";
import type { BalancesSnapshot } from "../../shared/balances/types";
import {
  BORROW_COLLATERAL_TOKEN,
  BORROW_IRM_ADDRESS,
  BORROW_LLTV_WAD,
  BORROW_LOAN_TOKEN,
  BORROW_MARKET_ID,
  BORROW_ORACLE_ADDRESS,
  MORPHO_BLUE_ADDRESS,
} from "../../shared/borrowing/config";
import {
  BASE_USDC_ADDRESS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "../../shared/savings/config";
import {
  balancesSnapshot,
  CBBTC_IMAGE_URL,
  RECOGNIZED_IMAGE_URL,
  rowAnatomySnapshot,
  scrollableBalancesSnapshot,
} from "./balances-fixtures";

// Local laptops paint balances in ~350-620ms; hosted CI runners measure 1.0-2.2s. Regressions show as multiples, not tens of ms.
const BALANCES_PAINTED_BUDGET_MS = process.env.CI ? 3_500 : 1_000;

const OWNER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const CBBTC = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const USER_OPERATION_HASH = `0x${"ab".repeat(32)}`;
const TRANSACTION_HASH = `0x${"cd".repeat(32)}`;
const CREATED_AT = new Date().toISOString();
const EXPIRES_AT = new Date(Date.now() + 10 * 60_000).toISOString();

type ActionStatus = "unconfirmed" | "pending" | "confirmed";

function action(transfer: { assetId: "usdc" | "cbbtc"; amountBaseUnits: string } = { assetId: "usdc", amountBaseUnits: "1000000" }) {
  const asset = transfer.assetId === "cbbtc"
    ? { symbol: "cbBTC", decimals: 8, token: CBBTC }
    : { symbol: "USDC", decimals: 6, token: USDC };
  const amount = transfer.amountBaseUnits;
  return {
    id: ACTION_ID,
    owner: { subject: "playwright-smoke-subject", address: OWNER, chainId: 8453, accountProvider: "cdp-embedded" },
    kind: "send",
    title: `Send ${asset.symbol}`,
    calls: [{
      to: asset.token,
      data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${BigInt(amount).toString(16).padStart(64, "0")}`,
      value: "0",
    }],
    amounts: [{ assetId: transfer.assetId, symbol: asset.symbol, decimals: asset.decimals, amountBaseUnits: amount, direction: "spend" }],
    warnings: [`Recipient: ${RECIPIENT}`, "Network fee shown by wallet."],
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  };
}

function borrowDetail() {
  return {
    version: "1",
    chainId: 8453,
    walletAddress: OWNER,
    market: { id: BORROW_MARKET_ID, morpho: MORPHO_BLUE_ADDRESS, loanToken: BORROW_LOAN_TOKEN, collateralToken: BORROW_COLLATERAL_TOKEN, oracle: BORROW_ORACLE_ADDRESS, irm: BORROW_IRM_ADDRESS, lltvWad: BORROW_LLTV_WAD.toString(), rank: 1 },
    eligibility: { mode: "enabled", newRisk: true, reason: null },
    source: { provider: "Base JSON-RPC", blockNumber: "100", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1788897600", fetchedAt: "2026-09-13T12:00:00.000Z" },
    state: { oraclePriceRaw: "800000000000000000000000000000000000000", borrowRatePerSecondWad: "1000000000", borrowAprWad: "31536000000000000", totalSupplyAssetsRaw: "1000000000", totalBorrowAssetsRaw: "500000000", totalBorrowSharesRaw: "500000000", liquidityAssetsRaw: "500000000", lastUpdateTimestamp: "1788897500" },
    wallet: { collateralBalanceRaw: "100000000", loanBalanceRaw: "200000000", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: { collateralRaw: "0", borrowSharesRaw: "0", debtAssetsRaw: "0", rawBorrowCapacityAssetsRaw: "0", borrowCapacityAssetsRaw: "0", rawWithdrawableCollateralRaw: "0", withdrawableCollateralRaw: "0", healthFactorWad: null, liquidationPriceRaw: null },
  };
}

function savingsVaults() {
  const candidates = MORPHO_V1_CANDIDATE_ADDRESSES.slice(0, 2).map((vaultAddress, index) => ({
    version: "v1",
    vaultAddress,
    name: index === 0 ? "Steakhouse USDC" : "Gauntlet USDC Prime",
    symbol: "USDC vault",
    listed: true,
    chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    curatorAddress: null,
    grossApy: index === 0 ? 0.0435 : 0.046,
    netApy: index === 0 ? 0.0385 : 0.041,
    feeRate: 0.1,
    totalAssetsRaw: "100000000",
    liquidityRaw: "50000000",
    stateAsOf: "2026-09-12T12:00:00.000Z",
    blockNumber: "51026404",
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: "2026-09-12T12:00:01.000Z",
    },
  }));
  return {
    version: "v1",
    chainId: 8453,
    asset: { address: BASE_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
    candidates,
    source: {
      provider: "Morpho GraphQL",
      endpoint: "https://api.morpho.org/graphql",
      query: "vaults",
      fetchedAt: "2026-09-12T12:00:01.000Z",
    },
    stale: false,
  };
}

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function installApiFixtures(
  page: Page,
  options: {
    balances?: BalancesSnapshot | ((region: RegionId) => BalancesSnapshot);
    initialActionStatus?: ActionStatus;
    activityTransfers?: boolean;
    failHandleOnce?: boolean;
  } = {},
) {
  let status: ActionStatus = options.initialActionStatus ?? "unconfirmed";
  let currentAction = action();
  let sessionReads = 0;
  let balancesReads = 0;
  let activityReads = 0;
  const balancesReadsByRegion = new Map<RegionId, number>();
  let delayedSession: Promise<void> | null = null;
  let releaseDelayedSession: (() => void) | null = null;
  let delayedBalances: Promise<void> | null = null;
  let releaseDelayedBalances: (() => void) | null = null;
  let handleRecorded = false;
  let failHandleResponseOnce = options.failHandleOnce ?? true;
  let fundingStatusReads = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/session") {
      sessionReads += 1;
      if (delayedSession) await delayedSession;
      return json(route, { user: { subject: "playwright-smoke-subject" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" });
    }
    if (path === "/api/balances") {
      const region = (url.searchParams.get("region") ?? "US") as RegionId;
      balancesReads += 1;
      balancesReadsByRegion.set(region, (balancesReadsByRegion.get(region) ?? 0) + 1);
      if (delayedBalances) await delayedBalances;
      const fixture = typeof options.balances === "function"
        ? options.balances(region)
        : options.balances ?? balancesSnapshot(region);
      return json(route, fixture);
    }
    if (path === "/api/actions/prepare" && request.method() === "POST") {
      const body = request.postDataJSON() as { kind?: string; params?: { assetId?: string; amountBaseUnits?: string } };
      if (body.kind === "send" && (body.params?.assetId === "usdc" || body.params?.assetId === "cbbtc") && typeof body.params.amountBaseUnits === "string") {
        currentAction = action({ assetId: body.params.assetId, amountBaseUnits: body.params.amountBaseUnits });
      }
      status = "unconfirmed";
      return json(route, currentAction);
    }
    if (path === `/api/actions/${ACTION_ID}/confirm`) { status = "pending"; return json(route, { id: ACTION_ID, calls: currentAction.calls, summary: { title: currentAction.title, amounts: currentAction.amounts, warnings: currentAction.warnings, expiresAt: EXPIRES_AT }, expiresAt: EXPIRES_AT }); }
    if (path === `/api/actions/${ACTION_ID}/handle`) {
      const body = request.postDataJSON() as { providerHandle?: string; transactionHash?: string };
      if (body.transactionHash) {
        status = "confirmed";
        return json(route, { action: { id: ACTION_ID, status, providerHandle: USER_OPERATION_HASH, transactionHash: body.transactionHash } });
      }
      handleRecorded = true;
      if (failHandleResponseOnce) { failHandleResponseOnce = false; return route.abort("failed"); }
      return json(route, { action: { id: ACTION_ID, status: "pending", providerHandle: USER_OPERATION_HASH } });
    }
    if (path === `/api/actions/${ACTION_ID}`) return json(route, status === "unconfirmed"
      ? { id: ACTION_ID, kind: "send", summary: { title: currentAction.title, amounts: currentAction.amounts, warnings: currentAction.warnings, expiresAt: EXPIRES_AT }, calls: currentAction.calls, expiresAt: EXPIRES_AT }
      : { action: { id: ACTION_ID, status: "pending", providerHandle: handleRecorded ? USER_OPERATION_HASH : undefined } });
    if (path === "/api/actions") return json(route, { actions: status === "pending" || status === "confirmed" ? [{ id: ACTION_ID, provider: "cdp-embedded", kind: "send", summary: { title: currentAction.title, amounts: currentAction.amounts, warnings: currentAction.warnings, expiresAt: EXPIRES_AT }, status, createdAt: CREATED_AT, confirmedAt: CREATED_AT, providerHandle: handleRecorded ? USER_OPERATION_HASH : undefined, transactionHash: status === "confirmed" ? TRANSACTION_HASH : undefined, owner: currentAction.owner }] : [] });
    if (path === "/api/activity") {
      activityReads += 1;
      const to = url.searchParams.get("to") ?? new Date().toISOString();
      const from = new Date(new Date(to).getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const transfers = (options.activityTransfers ?? status === "confirmed") ? [{
        id: `8453:${USDC}:${ACTION_ID}`,
        logId: ACTION_ID,
        chainId: 8453,
        assetId: "usdc",
        tokenAddress: USDC,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        walletAddress: OWNER,
        fromAddress: OWNER,
        toAddress: RECIPIENT,
        direction: "outgoing",
        amountBaseUnits: "1000000",
        blockNumber: "20",
        blockHash: `0x${"ef".repeat(32)}`,
        transactionHash: TRANSACTION_HASH,
        logIndex: "1",
        blockTimestamp: new Date(new Date(to).getTime() - 1_000).toISOString(),
      }] : [];
      return json(route, { walletAddress: OWNER, chainId: 8453, window: { from, to }, transfers, nextCursor: null, source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to } });
    }
    if (path === "/api/savings/vaults") return json(route, savingsVaults());
    if (path === `/api/borrow/markets/${BORROW_MARKET_ID}`) return json(route, borrowDetail());
    if (path === "/api/funding/providers") {
      if (url.searchParams.get("direction") === "offramp" && url.searchParams.get("region") === "US") return json(route, {
        version: 2,
        direction: "offramp",
        providers: [{
          direction: "offramp", providerId: "peer", displayName: "Peer", region: "US", assetId: "base:usdc",
          assetSymbol: "USDC", assetDecimals: 6, currency: "USD", quotes: false, kyc: null,
          paymentMethods: [
            { id: "cashapp", label: "Cash App", platform: "cashapp", handleHint: "Cashtag", minimumAmountAtomic: "10000", maximumAmountAtomic: null, estimateSemantics: "approximate", etaSemantics: "historical-not-guaranteed", corridorConfirmedBy: "pending" },
            { id: "zelle", label: "Zelle", platform: "zelle", handleHint: "Email or phone", minimumAmountAtomic: "10000", maximumAmountAtomic: null, estimateSemantics: "approximate", etaSemantics: "historical-not-guaranteed", corridorConfirmedBy: "pending" },
          ],
        }],
      });
      return json(route, url.searchParams.get("region") === "ID" ? { providers: [{ providerId: "idrx", displayName: "IDRX", region: "ID", assetId: "base:idrx", assetSymbol: "IDRX", assetDecimals: 2, currency: "IDR", paymentMethods: [{ id: "bank-va-mandiri", label: "Bank transfer · Mandiri" }], quotes: false, kyc: null }] } : { providers: [] });
    }
    if (path === "/api/funding/offramp/orders") return json(route, { version: 3, recoveryEligible: false, orders: [] });
    if (path === "/api/funding/quotes") return json(route, { quoteToken: "fixture-signed-quote", quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: EXPIRES_AT } });
    if (path === "/api/funding/orders" && request.method() === "POST") return json(route, { order: { id: ACTION_ID, providerId: "idrx", region: "ID", assetId: "base:idrx", paymentMethod: "bank-va-mandiri", fiatAmount: "20000", state: "awaiting-payment", expectedTokenAmountAtomic: "2000000", fees: [{ label: "Network", amount: "100", currency: "IDR" }], instructions: { kind: "bank-transfer", rail: "Mandiri virtual account", accountNumber: "123456789012", accountName: "Home Fixture", amount: "20000", currency: "IDR" }, providerStatus: "pending" } });
    if (path === "/api/funding/orders" && request.method() === "GET") return json(route, { order: null });
    if (path === `/api/funding/orders/${ACTION_ID}`) { fundingStatusReads += 1; return json(route, { order: { id: ACTION_ID, providerId: "idrx", region: "ID", assetId: "base:idrx", paymentMethod: "bank-va-mandiri", fiatAmount: "20000", state: fundingStatusReads > 0 ? "received" : "awaiting-payment", instructions: null, providerStatus: "completed" } }); }
    if (path === "/api/basename-profile") return json(route, { profile: null });
    return json(route, {});
  });
  return {
    sessionReads: () => sessionReads,
    balancesReads: () => balancesReads,
    balancesReadsForRegion: (region: RegionId) => balancesReadsByRegion.get(region) ?? 0,
    balanceReadRegions: () => [...balancesReadsByRegion.entries()],
    activityReads: () => activityReads,
    delayNextSession() {
      delayedSession = new Promise<void>((resolve) => { releaseDelayedSession = resolve; });
      return sessionReads + 1;
    },
    releaseSession() {
      releaseDelayedSession?.();
      delayedSession = null;
      releaseDelayedSession = null;
    },
    delayNextBalances() {
      delayedBalances = new Promise<void>((resolve) => { releaseDelayedBalances = resolve; });
      return balancesReads + 1;
    },
    releaseBalances() {
      releaseDelayedBalances?.();
      delayedBalances = null;
      releaseDelayedBalances = null;
    },
  };
}

async function signIn(page: Page) {
  await page.goto("/?account=signin");
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/home/);
}

async function typeAmount(page: Page, value: string) {
  for (const char of value) {
    const name = char === "." ? "Decimal point" : char;
    await page.getByRole("button", { name, exact: true }).click();
  }
}

async function expectReachableMoneyFooter(page: Page, dialog: Locator) {
  const lastKey = dialog.getByRole("button", { name: "0", exact: true });
  const footer = dialog.locator('[data-slot="drawer-footer"]');
  await lastKey.scrollIntoViewIfNeeded();
  await expect(lastKey).toBeVisible();
  await expect(footer).toBeVisible();
  const [keyBox, footerBox] = await Promise.all([lastKey.boundingBox(), footer.boundingBox()]);
  expect(keyBox ? keyBox.y + keyBox.height : Number.POSITIVE_INFINITY).toBeLessThanOrEqual((footerBox?.y ?? 0) + 1);
  expect(footerBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function amountMetrics(page: Page) {
  return page.evaluate(() => {
    const node = document.querySelector<HTMLElement>("[data-primary-amount]");
    const ticker = node?.querySelector<HTMLElement>("[role='img']");
    if (!node || !ticker) return null;
    const style = getComputedStyle(node);
    const containerBounds = node.getBoundingClientRect();
    const tickerBounds = ticker.getBoundingClientRect();
    const textWidth = tickerBounds.width;
    const padding = (name: "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft") =>
      Number.parseFloat(style[name]) || 0;
    return {
      text: ticker.getAttribute("aria-label"),
      containerLeft: containerBounds.left,
      containerRight: containerBounds.right,
      tickerLeft: tickerBounds.left,
      tickerRight: tickerBounds.right,
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

test("coverage fixture keeps public chrome and automatic GET filters usable", async ({ page }) => {
  await page.goto("/coverage");
  await expect(page.getByRole("heading", { name: "Local money coverage" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(page.getByTitle("Start feedback mode")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reset" })).toHaveCount(0);

  const globe = page.getByRole("group", { name: "Interactive globe of local-money coverage research" });
  await expect(globe).toBeVisible();
  await globe.focus();
  await globe.press("Space");
  const marker = page.locator("circle[data-country='US']");
  const initialMarker = await marker.evaluate((node) => ({ x: node.getAttribute("cx"), y: node.getAttribute("cy") }));
  const globeBox = await globe.boundingBox();
  expect(globeBox).not.toBeNull();
  await page.mouse.move(globeBox!.x + globeBox!.width / 2, globeBox!.y + globeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(globeBox!.x + globeBox!.width * .65, globeBox!.y + globeBox!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => marker.getAttribute("cx")).not.toBe(initialMarker.x);
  const horizontalY = await marker.getAttribute("cy");
  await page.mouse.move(globeBox!.x + globeBox!.width / 2, globeBox!.y + globeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(globeBox!.x + globeBox!.width / 2, globeBox!.y + globeBox!.height * .65, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => marker.getAttribute("cy")).not.toBe(horizontalY);

  const search = page.getByRole("textbox", { name: "Search" });
  await search.scrollIntoViewIfNeeded();
  await search.pressSequentially("Indonesia", { delay: 300 });
  await expect(page).toHaveURL(/q=Indonesia/);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Indonesia");
  await expect(page.getByText("Showing 1 of 250 countries and territories.")).toBeVisible();
  const searchTop = await search.evaluate((input) => input.getBoundingClientRect().top);
  expect(searchTop).toBeGreaterThanOrEqual(0);
  expect(searchTop).toBeLessThan(752);

  await page.getByRole("combobox", { name: "Issuer route" }).selectOption("documented");
  await expect(page).toHaveURL(/issuer=documented/);
  await page.goBack();
  await expect(page).not.toHaveURL(/issuer=documented/);
  await expect(search).toHaveValue("Indonesia");
  await expect(page.getByText("Showing 1 of 250 countries and territories.")).toBeVisible();

  await page.setViewportSize({ width: 1374, height: 752 });
  const filterMetrics = await page.locator("form[action='/coverage']").evaluate((form) => ({
    bottom: form.getBoundingClientRect().bottom,
    selects: [...form.querySelectorAll("select")].map((select) => ({
      clientWidth: select.clientWidth,
      scrollWidth: select.scrollWidth,
    })),
  }));
  expect(filterMetrics.selects.every(({ clientWidth, scrollWidth }) => clientWidth >= scrollWidth)).toBe(true);
  const statusLayout = await page.locator("#country-ID").evaluate((row) => {
    const statusCells = [...row.querySelectorAll("td")].slice(-2);
    return statusCells.map((cell) => {
      const trigger = cell.querySelector("button")!.getBoundingClientRect();
      const bounds = cell.getBoundingClientRect();
      return { triggerWidth: trigger.width, centerDelta: Math.abs(trigger.x + trigger.width / 2 - (bounds.x + bounds.width / 2)), rowHeight: row.getBoundingClientRect().height };
    });
  });
  expect(statusLayout.every(({ triggerWidth, centerDelta, rowHeight }) => triggerWidth >= 36 && centerDelta < 2 && rowHeight <= 38)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1374);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("combobox", { name: "Sort" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("a valid Home session redirects the landing route before rendering", async ({ context }) => {
  const address = "0x1111111111111111111111111111111111111111";
  const key = "playwright-smoke-home-session-secret-32-bytes!!";
  const issuedAt = new Date();
  const subject = `base-${createHash("sha256").update(address).digest("hex").slice(0, 32)}`;
  const payload = JSON.stringify({
    version: 1,
    session: {
      user: { subject },
      smartAccount: { address, chainId: 8453 },
      accountProvider: "base-account",
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const input = `v1.${encoded}`;
  const signature = createHmac("sha256", Buffer.from(key, "utf8"))
    .update(input)
    .digest("base64url");

  await context.addCookies([{
    name: "home-session",
    value: `${input}.${signature}`,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);

  const redirected = await context.request.get("/", { maxRedirects: 0 });
  expect(redirected.status()).toBe(307);
  expect(redirected.headers().location).toBe("/home");

  const signIn = await context.request.get("/?account=signin", { maxRedirects: 0 });
  expect(signIn.status()).toBe(200);

  // Obsolete dashboard query routing has no authority: the legacy page falls
  // back to /home and translates nothing.
  const legacy = await context.request.get("/dashboard?panel=balances&group=investments", { maxRedirects: 0 });
  expect(legacy.status()).toBe(307);
  expect(legacy.headers().location).toBe("/home");
  // The verified root redirect keeps only allowlisted ephemeral overlay intent.
  const overlays = await context.request.get("/?flow=send&panel=balances&group=investments", { maxRedirects: 0 });
  expect(overlays.status()).toBe(307);
  expect(overlays.headers().location).toBe("/home?flow=send");
});

function trackHydrationErrors(page: Page): string[] {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) hydrationErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (/hydrat/i.test(error.message)) hydrationErrors.push(error.message);
  });
  return hydrationErrors;
}

function expectTickerInsideAmount(metrics: NonNullable<Awaited<ReturnType<typeof amountMetrics>>>) {
  expect(metrics.tickerLeft).toBeGreaterThanOrEqual(metrics.containerLeft - 0.5);
  expect(metrics.tickerRight).toBeLessThanOrEqual(metrics.containerRight + 0.5);
}

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

test("holding icons and hidden dust stay consistent across Home, Balances, and Send", async ({ page }) => {
  const fixture = balancesSnapshot();
  parseBalancesSnapshot(fixture, {
    subject: "playwright-smoke-subject",
    smartAccountAddress: OWNER,
    chainId: 8453,
  }, "US");
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await page.route("https://images.example.test/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0052ff"/></svg>',
    }),
  );
  await installApiFixtures(page, { balances: fixture });
  await signIn(page);

  const homeCatalogRow = page.locator(
    '[data-shell-panel]:not([hidden]) [data-balance-list] [data-kind="balance"]',
    { hasText: "Recognized Coin" },
  );
  await expect(homeCatalogRow).toBeVisible();
  await expect(homeCatalogRow.getByText("1 RCG", { exact: true })).toBeVisible();
  await expect(homeCatalogRow.locator(`img[src="${RECOGNIZED_IMAGE_URL}"]`)).toBeVisible();
  await expect(homeCatalogRow.locator('[data-mark="image"]')).toBeVisible();
  await expect(page.getByText("Dust Coin", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Your money" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  const balancesCatalogRow = page.locator('[data-shell-panel]:not([hidden]) li', {
    hasText: "Recognized Coin",
  });
  await expect(balancesCatalogRow).toBeVisible();
  await expect(balancesCatalogRow.getByText("1 RCG", { exact: true })).toBeVisible();
  await expect(balancesCatalogRow.locator(`img[src="${RECOGNIZED_IMAGE_URL}"]`)).toBeVisible();
  const balancesCbbtcRow = page.locator('[data-shell-panel]:not([hidden]) li', {
    hasText: "Bitcoin",
  });
  await expect(balancesCbbtcRow.locator(`img[src="${CBBTC_IMAGE_URL}"]`)).toBeVisible();
  await expect(balancesCbbtcRow.locator('[data-shimmer="mark"]')).toHaveCount(0);
  await expect(page.getByText("1 small balance hidden", { exact: false })).toBeVisible();
  await expect(page.getByText("Dust Coin", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page.getByText("Dust Coin", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide small balances" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await expect(page.getByText("Dust Coin", { exact: true })).toHaveCount(0);
  await expect(page.getByText("1 small balance hidden", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
  await page.getByRole("switch", { name: "Show small balances" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Dust Coin", { exact: true })).toBeVisible();
  await expect(page.getByText("1 small balance hidden", { exact: false })).toHaveCount(0);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(
    '[data-shell-panel]:not([hidden]) [data-balance-list] li',
    { hasText: "Dust Coin" },
  )).toHaveCount(0);
  await page.getByRole("button", { name: "Send" }).click();
  const send = page.getByRole("dialog", { name: "Send" });
  await expect(send.getByText("Recognized Coin", { exact: true })).toHaveCount(0);
  await expect(send.getByText("RCG", { exact: true })).toHaveCount(0);
  await expect(send.getByText(/12\.34 available/)).toBeVisible();
});

test("Home More opens Your money at the requested group", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page, { balances: scrollableBalancesSnapshot() });
  await signIn(page);

  const investments = page.locator('[data-money-group="investments"]');
  await expect(investments.locator('[data-kind="balance"]')).toHaveCount(3);
  await investments.getByRole("button", { name: "More Investments" }).click();

  await expect(page).toHaveURL(/\/balances\/investments$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await expect(page.locator('#investments[data-money-group="investments"]')).toBeVisible();
});

test("Home, Save, Your money, and Home reuse one balances request per region", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  const fixtures = await installApiFixtures(page);
  const startedAt = Date.now();
  await signIn(page);
  await expect.poll(() => fixtures.balancesReadsForRegion("US")).toBe(1);

  await page.locator('section[aria-labelledby="save-heading"]').getByRole("button").click();
  await expect(page.getByRole("region", { name: "Save" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Your money", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add money", exact: true })).toBeVisible();

  expect(Date.now() - startedAt).toBeLessThan(15_000);
  const readsByRegion = fixtures.balanceReadRegions();
  expect(readsByRegion.length).toBeGreaterThan(0);
  expect(readsByRegion.every(([, reads]) => reads === 1)).toBe(true);
  expect(fixtures.balancesReads()).toBe(readsByRegion.length);
});

test("cash, priced catalog, and unpriced registry balances share one row anatomy", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  const fixtures = await installApiFixtures(page, { balances: rowAnatomySnapshot() });
  fixtures.delayNextBalances();
  await signIn(page);
  expect(await page.evaluate(() =>
    performance.getEntriesByName("balances:painted", "mark").length,
  )).toBe(0);
  fixtures.releaseBalances();

  await page.getByRole("button", { name: "Your money", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName("balances:painted", "mark").length,
  )).toBe(1);

  const activePanel = page.locator('[data-shell-panel]:not([hidden])');
  const cash = activePanel.locator("li", { hasText: "US dollar" });
  const catalog = activePanel.locator("li", { hasText: "Recognized Coin" });
  const unpriced = activePanel.locator("li", { hasText: "Toshi" });
  for (const row of [cash, catalog, unpriced]) {
    await expect(row.locator('[data-kind="balance"]')).toHaveCount(1);
    await expect(row.locator('[data-slot="item-media"]')).toHaveCount(1);
    await expect(row.locator('[data-slot="item-content"]')).toHaveCount(2);
  }

  await expect(cash.locator('[data-slot="item-content"]').first().locator('[data-slot="item-title"]'))
    .toHaveText("US dollar");
  await expect(cash.locator('[data-slot="item-description"]')).toHaveCount(0);
  await expect(cash.locator('[data-slot="item-content"]').nth(1).getByRole("img", { name: "Unavailable" }))
    .toBeVisible();

  const catalogContent = catalog.locator('[data-slot="item-content"]');
  await expect(catalogContent.first().locator('[data-slot="item-title"]')).toHaveText("Recognized Coin");
  await expect(catalogContent.first().locator('[data-slot="item-description"]')).toHaveText("1 RCG");
  await expect(catalogContent.nth(1).getByRole("img", { name: "$18.20" })).toBeVisible();

  const unpricedContent = unpriced.locator('[data-slot="item-content"]');
  await expect(unpricedContent.first().locator('[data-slot="item-title"]')).toHaveText("Toshi");
  await expect(unpricedContent.first().locator('[data-slot="item-description"]')).toHaveCount(0);
  await expect(unpricedContent.nth(1).getByRole("img", { name: /TOSHI$/ })).toBeVisible();
  await expect(activePanel.getByText("Ethereum", { exact: true })).toHaveCount(0);
});

test("Activity transaction details keep labels on one line and link to the explorer", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page, { activityTransfers: true });
  await page.setViewportSize({ width: 390, height: 720 });
  await signIn(page);

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: /^Sent / }).click();
  const dialog = page.getByRole("dialog", { name: "Sent USDC" });
  const explorer = dialog.getByRole("link", { name: "View on explorer" });
  await expect(explorer).toBeVisible();
  await expect(explorer).toHaveAttribute("href", `https://basescan.org/tx/${TRANSACTION_HASH}`);
  await expect(explorer).toHaveAttribute("rel", "noopener noreferrer");

  expect(await dialog.locator("dt").evaluateAll((labels) => {
    const oneLineHeight = labels.find((label) => label.textContent === "Status")
      ?.getBoundingClientRect().height;
    return oneLineHeight !== undefined && labels.every(
      (label) => label.getBoundingClientRect().height <= oneLineHeight + 0.5,
    );
  })).toBe(true);

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }

  // Copy rows wrap a 44px min-height control; the decorative divider must not add
  // layout height, so copy rows and text rows share one 44px rhythm (#484).
  const rowHeights = await dialog.locator("dl > div").evaluateAll((rows) =>
    rows.map((row) => ({
      copy: row.querySelector(".lucide-copy") !== null,
      height: row.getBoundingClientRect().height,
    })),
  );
  expect(rowHeights.length).toBeGreaterThanOrEqual(2);
  expect(rowHeights.some((row) => row.copy)).toBe(true);
  expect(rowHeights.some((row) => !row.copy)).toBe(true);
  const heights = rowHeights.map((row) => row.height);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  expect(Math.max(...heights)).toBeLessThan(Math.min(...heights) + 1);

  // The overlay divider covers the bottom pixel of copy controls, so it must
  // stay out of hit testing there (#487).
  const copyControl = dialog.locator("dl").getByRole("button", { name: /^Copy / }).first();
  await expect(copyControl).toBeVisible();
  expect(
    await copyControl.evaluate((button) =>
      getComputedStyle(button.closest("dl > div")!, "::after").pointerEvents),
  ).toBe("none");
  await page.context().grantPermissions(["clipboard-write"]);
  const copyBox = (await copyControl.boundingBox())!;
  // The drawer keeps a live transform spring, so skip actionability checks and
  // rely on the real input dispatch itself for hit testing: pre-fix, the row's
  // divider pseudo-element receives this pixel and the copy never activates.
  await copyControl.click({ position: { x: copyBox.width / 2, y: copyBox.height - 1 }, force: true });
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
});

test("recent operations open transaction details", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page, { initialActionStatus: "confirmed", activityTransfers: false });
  await signIn(page);

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: /^Send USDC / }).click();
  const dialog = page.getByRole("dialog", { name: "Send USDC" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "View on explorer" })).toBeVisible();
});

test("shows the integrated Peer destination at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);

  await page.getByRole("button", { name: "Send" }).click();
  const send = page.getByRole("dialog", { name: "Send" });
  await typeAmount(page, "1");
  await send.getByRole("button", { name: "Continue" }).click();

  await expect(send.getByRole("textbox", { name: "To" })).toBeVisible();
  await expect(send.getByText("Or", { exact: true })).toBeVisible();
  await expect(send.getByRole("button", { name: /Available payout apps: Cash App, Zelle.*Send to Zelle, Venmo, Cash App and more.*Use Peer to send via app/ })).toBeVisible();
  await expect(send.getByText("Use Peer to send via app", { exact: true })).toBeVisible();
  await expect(send.getByRole("img", { name: "Available payout apps: Cash App, Zelle" })).toBeVisible();
  await send.getByRole("textbox", { name: "To" }).fill(RECIPIENT);
  await send.getByRole("button", { name: "Continue" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm" });
  await expect(confirm.getByRole("button", { name: "Send $1.00" })).toBeVisible();
  await confirm.getByText("Back", { exact: true }).click();
  const returnedAddress = send.getByRole("textbox", { name: "To" });
  await returnedAddress.click();
  await expect(returnedAddress).toHaveValue(RECIPIENT);
});

test("sends a held catalog cbBTC balance with one asset selector indicator", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = balancesSnapshot();
  parseBalancesSnapshot(fixture, {
    subject: "playwright-smoke-subject",
    smartAccountAddress: OWNER,
    chainId: 8453,
  }, "US");
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page, { balances: fixture, failHandleOnce: false });
  await signIn(page);

  await page.getByRole("button", { name: "Send" }).click();
  const send = page.getByRole("dialog", { name: "Send" });
  const selector = send.getByRole("combobox", { name: "Asset" });
  await expect(selector).toBeVisible();
  await expect(send.getByRole("button", { name: "Close send dialog" })).toBeFocused();
  await expect(selector).toHaveValue("USD");
  await expect(send.locator('[data-slot="input-group-button"]')).toHaveCount(1);
  await selector.click();
  await expect(page.getByRole("option", { name: "USD USDC" })).toBeVisible();
  const selectorGroup = selector.locator("xpath=ancestor::*[@data-slot='input-group']");
  const popup = page.locator('[data-slot="combobox-content"]');
  const [selectorWidth, popupWidth, popupBox] = await Promise.all([
    selectorGroup.evaluate((element) => (element as HTMLElement).offsetWidth),
    popup.evaluate((element) => (element as HTMLElement).offsetWidth),
    popup.boundingBox(),
  ]);
  expect(selectorWidth).toBeLessThanOrEqual(116);
  expect(popupWidth).toBeGreaterThanOrEqual(280);
  expect(popupWidth).toBeLessThanOrEqual(358);
  expect(popupBox?.x ?? -1).toBeGreaterThanOrEqual(16);
  const mark = selectorGroup.locator("[data-presentation='selector']").first();
  const innerMark = mark.locator("[data-mark-inner]");
  await expect(mark).toHaveCSS("width", "32px");
  await expect(innerMark).toHaveCSS("width", "16px");
  await selector.fill("cbBTC");
  const cbBtcOption = page.getByRole("option", { name: "Bitcoin cbBTC" });
  await expect(cbBtcOption).toBeVisible();
  await selector.press("Enter");
  await expect(selector).toHaveValue("Bitcoin");
  await expect(send.getByRole("img", { name: "0.001 cbBTC available" })).toBeVisible();
  await typeAmount(page, "0.001");
  await send.getByRole("button", { name: "Continue" }).click();
  await expect(send.getByRole("combobox", { name: "Asset" })).toHaveCount(0);
  await expect(send.getByRole("textbox", { name: "To" })).toBeVisible();
  await page.getByRole("textbox", { name: "To" }).fill(RECIPIENT);
  await send.getByRole("button", { name: "Continue" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm" });
  await expect(confirm.getByText("You're sending cbBTC", { exact: true })).toBeVisible();
  await confirm.getByRole("button", { name: "Send 0.001 cbBTC" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText("Sent 0.001 cbBTC to 0x2222…222222", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("home:playwright-smoke:dispatch-count"))).toBe("1");
});

test("locked Save amount keeps its keypad and footer visible at 320 by 720", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);
  await page.goto("/save?flow=save-deposit");

  const dialog = page.getByRole("dialog", { name: "Deposit" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("group", { name: "USDC" })).toHaveCount(1);
  await expect(dialog.getByRole("combobox", { name: "Asset" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Close deposit dialog" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeVisible();
  await expectReachableMoneyFooter(page, dialog);
});

test("Borrow amount remains reachable at 320 by 568 and 200% text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);
  await page.goto(`/borrow/${BORROW_MARKET_ID}`);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });

  const dialog = page.getByRole("dialog", { name: "Borrow" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("group", { name: "USDC" })).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Close Borrow action" })).toBeFocused();
  await expect(dialog.getByTestId("borrow-collateral-preview")).toBeVisible();
  await expectReachableMoneyFooter(page, dialog);
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeVisible();
});

test("ambiguous handle response retries without a second wallet dispatch", async ({ page }) => {
  parseBalancesSnapshot(balancesSnapshot(), {
    subject: "playwright-smoke-subject",
    smartAccountAddress: OWNER,
    chainId: 8453,
  }, "US");
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);
  expect(await page.evaluate(() =>
    performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Number.POSITIVE_INFINITY,
  )).toBeLessThan(BALANCES_PAINTED_BUDGET_MS);
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("textbox", { name: "To" })).toBeVisible();
  await page.getByRole("textbox", { name: "To" }).fill(RECIPIENT);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send $1.00" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Confirm" });
  // Scope to the dialog: the persistent Activity panel can show its own retry control.
  await expect(confirmDialog.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("home:playwright-smoke:dispatch-count"))).toBe("1");

  await confirmDialog.getByRole("button", { name: "Try again" }).click();
  await confirmDialog.getByRole("button", { name: "Send $1.00" }).click();
  await expect(confirmDialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("home:playwright-smoke:dispatch-count"))).toBe("1");
  await expect(page.getByText("Sent $1.00 to 0x2222…222222", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activity" }).click();
  await expect(
    page
      .locator('[data-shell-panel]:not([hidden])')
      .getByText("Sent", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Send USDC", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Pending/)).toHaveCount(0);
});

test("reload paints persisted balances before stale balances respond without shifting rows", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  const fixtures = await installApiFixtures(page);
  await signIn(page);
  const coldPaint = await page.evaluate(() =>
    performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Number.POSITIVE_INFINITY,
  );
  expect(coldPaint).toBeLessThan(BALANCES_PAINTED_BUDGET_MS);
  await expect.poll(() => page.evaluate(() =>
    Object.keys(localStorage).find((key) => key.startsWith("home.query.v1:")) ?? null,
  )).not.toBeNull();
  // Let the persister's trailing throttled writes flush before zeroing, so
  // the staleness edit survives into the reload instead of being overwritten.
  await page.waitForTimeout(600);
  const persistedFacts = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("home.query.v1:"));
    if (!key) throw new Error("Persisted owner cache is missing");
    const persisted = JSON.parse(localStorage.getItem(key) ?? "null") as {
      buster?: string;
      clientState?: {
        queries?: Array<{
          queryKey?: unknown[];
          state?: { data?: { holdings?: Array<{ id?: string }> }; dataUpdatedAt?: number };
        }>;
      };
    };
    const balancesQuery = persisted.clientState?.queries?.find(
      (query) => query.queryKey?.[1] === "balances",
    );
    for (const query of persisted.clientState?.queries ?? []) {
      // Stale (older than the 15s staleTime) but still hydratable: a zeroed
      // dataUpdatedAt would make hydrate skip the pending query entirely.
      if (query.state) query.state.dataUpdatedAt = Date.now() - 60_000;
    }
    localStorage.setItem(key, JSON.stringify(persisted));
    return {
      buster: persisted.buster,
      queryKey: balancesQuery?.queryKey,
      hasCatalog: balancesQuery?.state?.data?.holdings?.some(
        (holding) => holding.id === "catalog:0x9999999999999999999999999999999999999999",
      ) ?? false,
    };
  });
  expect(persistedFacts.buster).toBe("home-query-v2");
  expect(persistedFacts.queryKey).toEqual([
    expect.any(String),
    "balances",
    "US",
  ]);
  expect(persistedFacts.hasCatalog).toBe(true);
  const hydrationErrors = trackHydrationErrors(page);

  const delayedSessionRead = fixtures.delayNextSession();
  const delayedBalancesRead = fixtures.delayNextBalances();
  const balancesReadsBeforeReload = fixtures.balancesReads();

  await page.reload();
  await expect.poll(fixtures.sessionReads, { timeout: 15_000 }).toBeGreaterThanOrEqual(delayedSessionRead);
  await expect(page.getByText("$12.34", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Recognized Coin", { exact: true }).first()).toBeVisible();
  expect(fixtures.balancesReads()).toBe(balancesReadsBeforeReload);
  const provisionalLayout = await visibleBalanceRowLayout(page);
  const provisionalPaint = await page.evaluate(() => ({
    balances: performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Number.POSITIVE_INFINITY,
    verified: performance.getEntriesByName("session:verified", "mark")[0]?.startTime ?? Number.POSITIVE_INFINITY,
  }));
  expect(provisionalPaint.balances).toBeLessThan(coldPaint);
  expect(provisionalPaint.balances).toBeLessThan(provisionalPaint.verified);

  fixtures.releaseSession();
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName("session:verified", "mark")[0]?.startTime ?? Number.POSITIVE_INFINITY,
  ), { timeout: 15_000 }).toBeLessThan(Number.POSITIVE_INFINITY);

  const verifiedPaint = await page.evaluate(() =>
    performance.getEntriesByName("session:verified", "mark")[0]?.startTime ?? Number.POSITIVE_INFINITY,
  );
  expect(provisionalPaint.balances).toBeLessThan(verifiedPaint);
  await expect.poll(fixtures.balancesReads, { timeout: 15_000 }).toBeGreaterThanOrEqual(delayedBalancesRead);
  await expect(page.getByText("Recognized Coin", { exact: true }).first()).toBeVisible();

  fixtures.releaseBalances();
  await expect(page.locator('[data-shell-panel]:not([hidden]) [aria-label="Total balance"]')).not.toHaveAttribute("aria-busy", "true");
  const settledLayout = await visibleBalanceRowLayout(page);
  expect(settledLayout).toEqual(provisionalLayout);
  // Zero hydration errors only once the delayed verification and balances
  // settle: the restored cache paints after hydration, never during render.
  expect(hydrationErrors).toEqual([]);
});

test("reload resumes an unconfirmed send review from its URL action", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);

  await page.goto(`/home?flow=send&action=${ACTION_ID}`);
  await page.reload();

  const review = page.getByRole("dialog", { name: "Confirm" });
  // A full reload re-verifies the session and hydrates before the resume fetch.
  await expect(review).toBeVisible({ timeout: 15_000 });
  await expect(review.getByText("You're sending USDC")).toBeVisible();
  await expect(review.getByRole("button", { name: "Send $1.00" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`flow=send.*action=${ACTION_ID}`));
});

test("shallow-routed money flows open from URLs and Back closes them", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);

  const cases = [
    { flow: "add-money", path: "/home", dialog: "Add money" },
    { flow: "receive", path: "/home", dialog: "Receive" },
    // Save flows keep their canonical parent: /save?flow=save-deposit.
    { flow: "save-deposit", path: "/save", dialog: "Deposit" },
  ] as const;

  for (const entry of cases) {
    await page.goto(`${entry.path}?flow=${entry.flow}`);
    await expect(page.getByRole("dialog", { name: entry.dialog })).toBeVisible();
    await page.goBack();
    await expect(page.locator('[role="dialog"][data-open]')).toHaveCount(0);
    // Back returns to the shell entry the visit started from.
    await expect(page).toHaveURL(/\/home$/);
  }
});

test("Add money routes Receive, handles the Back state, and reopens the method list", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);

  await page.getByRole("button", { name: "Add money", exact: true }).click();
  await expect(page).toHaveURL(/[?&]flow=add-money/);
  await page.getByRole("button", { name: /^Receive crypto/ }).click();
  await expect(page.getByRole("dialog", { name: "Receive" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]flow=receive/);
  await page.evaluate(() => {
    window.history.replaceState(window.history.state, "", "/home");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator('[role="dialog"][data-open]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/home$/);

  await page.getByRole("button", { name: "Add money", exact: true }).click();
  await expect(page).toHaveURL(/\/home\?flow=add-money$/);
  await expect(page.getByRole("dialog", { name: "Add money" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Receive crypto/ })).toBeVisible();
});

test("Add money close preserves the active panel", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);

  await page.getByRole("button", { name: "Your money", exact: true }).click();
  await expect(page).toHaveURL(/\/balances$/);
  await page.evaluate(() => {
    window.history.pushState(null, "", "/balances?flow=add-money");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/balances\?flow=add-money$/);
  await expect(page.getByRole("dialog", { name: "Add money" })).toBeVisible();
  await page.getByRole("button", { name: "Close add money" }).click();
  await expect(page.locator('[role="dialog"][data-open]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/balances$/);
});

test("Invest discovery navigation preserves category and asset Back behavior", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);

  await page.getByRole("button", { name: "Invest", exact: true }).click();
  const stocksHeading = page.getByRole("heading", { name: "Stocks" });
  await stocksHeading.locator("..").getByRole("button", { name: "See all ›" }).click();
  await expect(page).toHaveURL(/\/invest\/stocks$/);
  await page.getByRole("button", { name: /^NVIDIA/ }).click();
  await expect(page.getByRole("heading", { name: "NVIDIA" })).toBeVisible();
  await expect(page).toHaveURL(/\/invest\/nvdac$/);
  await expect(page.getByRole("note")).toHaveText("Stocks aren't available yet.");

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stocks" })).toBeVisible();
  await expect(page).toHaveURL(/\/invest\/stocks$/);
  await page.getByRole("button", { name: "Back to Invest", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invest" })).toBeVisible();
  await expect(page).toHaveURL(/\/invest$/);
});

test("visited Invest and Activity panels stay mounted across tab changes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  const fixtures = await installApiFixtures(page);
  await signIn(page);

  await openInvestAssetDetail(page);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add money", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page.getByRole("heading", { name: "NVIDIA" })).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect.poll(fixtures.activityReads).toBeGreaterThan(0);
  const readsAfterFirstVisit = fixtures.activityReads();

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  expect(fixtures.activityReads()).toBe(readsAfterFirstVisit);
});

test("money amount auto-fits the longest local and native values at 320px and 390px", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page);
  await page.getByRole("button", { name: "Send" }).click();

  const sendDialog = page.getByRole("dialog", { name: "Send" });
  await expect(sendDialog.getByRole("combobox", { name: "Asset" })).toHaveCount(1);
  await expect(sendDialog.getByRole("button", { name: "Close send dialog" })).toBeFocused();
  await expect(sendDialog.getByRole("button", { name: "0", exact: true })).toBeInViewport();
  await expect(sendDialog.getByRole("button", { name: "Continue" })).toBeInViewport();
  await expectReachableMoneyFooter(page, sendDialog);

  const amount = page.locator("[data-primary-amount]");
  await expect(amount.getByRole("img")).toHaveAttribute("aria-label", "$0");
  const zeroAt320 = await amountMetrics(page);
  expectTickerInsideAmount(zeroAt320!);

  await typeAmount(page, "258");
  await expect(amount.getByRole("img")).toHaveAttribute("aria-label", "$258");
  const twoFiftyEightAt320 = await amountMetrics(page);
  expectTickerInsideAmount(twoFiftyEightAt320!);
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Delete last digit", exact: true }).click();
  }

  await typeAmount(page, "123456789012.123456");
  await expect(amount.getByRole("img")).toHaveAttribute("aria-label", "$123456789012.123456");

  const at320 = await amountMetrics(page);
  expect(at320?.text).toBe("$123456789012.123456");
  expectTickerInsideAmount(at320!);
  expect(at320?.scrollWidth).toBeLessThanOrEqual((at320?.clientWidth ?? 0) + 2);
  expect(at320?.fontSize).toBeGreaterThanOrEqual(20);
  expect(at320?.fontSize).toBeLessThan(51.2);
  expect(at320?.overflow).toBe("visible");
  expect(at320?.textWidth).toBeLessThanOrEqual(
    (at320?.clientWidth ?? 0) - (at320?.paddingLeft ?? 0) - (at320?.paddingRight ?? 0) + 2,
  );

  await page.getByRole("button", { name: /as the primary amount/ }).click();
  await expect(amount.getByRole("img")).toHaveAttribute("aria-label", "123456789012.123456");
  const native = await amountMetrics(page);
  expect(native?.text).toBe("123456789012.123456");
  expectTickerInsideAmount(native!);
  expect(native?.scrollWidth).toBeLessThanOrEqual((native?.clientWidth ?? 0) + 2);
  expect(native?.fontSize).toBeGreaterThanOrEqual(20);
  expect(native?.fontSize).toBeLessThan(51.2);
  expect(native?.textWidth).toBeLessThanOrEqual(
    (native?.clientWidth ?? 0) - (native?.paddingLeft ?? 0) - (native?.paddingRight ?? 0) + 2,
  );

  await page.setViewportSize({ width: 390, height: 720 });
  await expect.poll(async () => (await amountMetrics(page))?.fontSize)
    .toBeGreaterThan((native?.fontSize ?? 0) + 1);
  const at390 = await amountMetrics(page);
  expectTickerInsideAmount(at390!);
  expect(at390?.scrollWidth).toBeLessThanOrEqual((at390?.clientWidth ?? 0) + 2);
  expect(at390?.fontSize).toBeGreaterThanOrEqual(20);
  expect(at390?.fontSize).toBeLessThan(57.6);
  expect(at390?.textWidth).toBeLessThanOrEqual(
    (at390?.clientWidth ?? 0) - (at390?.paddingLeft ?? 0) - (at390?.paddingRight ?? 0) + 2,
  );

  await page.getByRole("button", { name: /as the primary amount/ }).click();
  await expect(amount.getByRole("img")).toHaveAttribute("aria-label", "$123456789012.123456");
  for (let index = 0; index < 20; index += 1) {
    await page.getByRole("button", { name: "Delete last digit", exact: true }).click();
  }
  await expect(amount.getByRole("img")).toHaveAttribute("aria-label", "$0");
  expectTickerInsideAmount((await amountMetrics(page))!);
  await typeAmount(page, "258");
  await expect(amount.getByRole("img")).toHaveAttribute("aria-label", "$258");
  expectTickerInsideAmount((await amountMetrics(page))!);
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Delete last digit", exact: true }).click();
  }
  await typeAmount(page, "123456789012.123456");
  await expect(amount.getByRole("img")).toHaveAttribute("aria-label", "$123456789012.123456");
  const regrownAt390 = await amountMetrics(page);
  expectTickerInsideAmount(regrownAt390!);

  // Deleting back to a short amount must grow the type back without remounting
  // the ticker or pinning the shrunken size.
  const shrunk = regrownAt390?.fontSize ?? 0;
  for (let index = 0; index < 17; index += 1) {
    await page.getByRole("button", { name: "Delete last digit", exact: true }).click();
  }
  await expect.poll(async () => (await amountMetrics(page))?.fontSize).toBeGreaterThan(shrunk + 10);
});

test("money amount recomputes for text scaling", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page);
  await page.getByRole("button", { name: "Send" }).click();

  const amount = page.locator("[data-primary-amount]");
  await typeAmount(page, "5");
  await expect(amount.getByRole("img")).toHaveAttribute("aria-label", "$5");

  const before = await amountMetrics(page);
  expect(before?.fontSize).toBeGreaterThanOrEqual(44);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect.poll(async () => (await amountMetrics(page))?.fontSize).toBeGreaterThan((before?.fontSize ?? 0) + 5);
  await expect(amount.getByRole("img")).toHaveAttribute("aria-label", "$5");
});

async function openScrolledBalances(page: Page) {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.route(
    (url) => url.pathname === "/api/balances",
    async (route) => {
      const region = (new URL(route.request().url()).searchParams.get("region") ?? "US") as RegionId;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(scrollableBalancesSnapshot(region)),
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/api/market-prices/history",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 1,
          provider: "codex",
          assetId: null,
          range: null,
          currency: "USD",
          fetchedAt: null,
          status: "empty",
          points: [],
        }),
      });
    },
  );
  await page.setViewportSize({ width: 390, height: 440 });
  await signIn(page);

  await page.getByRole("button", { name: "Your money" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await expect(page).toHaveURL(/\/balances$/);

  // A fresh open reveals the first batch plus whatever the observer can already see at this
  // viewport (dense rows may not fill it). Capture that count: "reset" means returning to it.
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBeGreaterThanOrEqual(10);
  await page.waitForTimeout(150);
  const freshCount = await page.evaluate(countVisibleBalanceRows);

  const maxTop = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".app-main-authenticated");
    return main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0;
  });
  expect(maxTop).toBeGreaterThan(0);

  // A real user scroll — a good way down the current range, not to the sentinel itself.
  const target = await page.evaluate((max) => {
    const main = document.querySelector<HTMLElement>(".app-main-authenticated");
    if (!main) return 0;
    const next = Math.min(max, Math.max(240, Math.round(max * 0.6)));
    main.scrollTop = next;
    main.dispatchEvent(new Event("scroll", { bubbles: true }));
    return next;
  }, maxTop);
  expect(target).toBeGreaterThan(0);

  // The real IntersectionObserver reveals at least one more batch on scroll.
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBeGreaterThan(freshCount);
  const revealedCount = await page.evaluate(
    () =>
      document.querySelectorAll(
        '[data-shell-panel]:not([hidden]) [data-balance-list] [data-kind="balance"]',
      ).length,
  );
  return { target, revealedCount, maxTop, freshCount };
}

async function openInvestAssetDetail(page: Page) {
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invest" })).toBeVisible();
  await expect(page).toHaveURL(/\/invest$/);
  // Forward Invest entry clears the saved offset before any asset opens.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (document.querySelector<HTMLElement>(".app-main-authenticated")
            ?.scrollTop ?? 0),
      ),
    )
    .toBe(0);

  await page.getByRole("button", { name: /^NVIDIA/ }).click();
  await expect(page.getByRole("heading", { name: "NVIDIA" })).toBeVisible();
  await expect(page).toHaveURL(/\/invest\/nvdac$/);
}

async function expectBalancesRestored(
  page: Page,
  expected: { target: number; revealedCount: number; maxTop: number },
) {
  await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (document.querySelector<HTMLElement>(".app-main-authenticated")
            ?.scrollTop ?? 0),
      ),
    )
    .toBe(expected.target);
  // The restored offset stays within the current scrollable range.
  expect(expected.target).toBeLessThanOrEqual(expected.maxTop);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelectorAll(
            '[data-shell-panel]:not([hidden]) [data-balance-list] [data-kind="balance"]',
          ).length,
      ),
    )
    .toBe(expected.revealedCount);
}

async function clickForwardAndWaitForUrl(
  page: Page,
  name: string,
  expectedUrl: RegExp,
) {
  // A pre-existing Next dev hydration overlay can intercept pointer hit-testing
  // in CI; force still dispatches the real button click and route transition.
  // Right after a route change the button can render before its handler is
  // hydrated, so a click that produced no navigation is retried (#383).
  await expect(async () => {
    await page.getByRole("button", { name, exact: true }).click({ force: true });
    await expect(page).toHaveURL(expectedUrl, { timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
}

function countVisibleBalanceRows(): number {
  return document.querySelectorAll(
    '[data-shell-panel]:not([hidden]) [data-balance-list] [data-kind="balance"]',
  ).length;
}

async function expectBalancesReset(page: Page, freshCount: number) {
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (document.querySelector<HTMLElement>(".app-main-authenticated")
            ?.scrollTop ?? 0),
      ),
    )
    .toBe(0);
  await expect.poll(() => page.evaluate(countVisibleBalanceRows)).toBe(freshCount);
}

test("Balances restores scroll and reveal after app Back from an opened asset", async ({ page }) => {
  const state = await openScrolledBalances(page);
  await openInvestAssetDetail(page);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Invest" })).toBeVisible();
  await page.goBack();

  await expectBalancesRestored(page, state);
});

test("Balances restores scroll and reveal after browser Back from an opened asset", async ({ page }) => {
  const state = await openScrolledBalances(page);
  await openInvestAssetDetail(page);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Invest" })).toBeVisible();
  await page.goBack();

  await expectBalancesRestored(page, state);
});

test("Balances restores scroll and reveal after Account Done", async ({ page }) => {
  const state = await openScrolledBalances(page);
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expectBalancesRestored(page, state);
});

test("Balances starts at the top after browser Back from generic Invest", async ({ page }) => {
  const state = await openScrolledBalances(page);
  await clickForwardAndWaitForUrl(page, "Invest", /\/invest$/);
  await expect(page.getByRole("heading", { name: "Invest" })).toBeVisible();
  await page.goBack();
  await expectBalancesReset(page, state.freshCount);
});

test("Balances starts at the top after browser Back from Home", async ({ page }) => {
  const state = await openScrolledBalances(page);
  await clickForwardAndWaitForUrl(page, "Back", /\/home$/);
  await page.goBack();
  await expectBalancesReset(page, state.freshCount);
});

test("Balances starts at the top after Activity and browser Back", async ({ page }) => {
  const state = await openScrolledBalances(page);
  await clickForwardAndWaitForUrl(page, "Back", /\/home$/);
  await clickForwardAndWaitForUrl(page, "Activity", /\/activity$/);
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/\/activity/);
  await page.goBack();
  await expectBalancesReset(page, state.freshCount);
});

test("account sign-in and settings stay reachable at 390px, 320px, and 200% text", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?account=signin");

  const dialog = page.locator('[role="dialog"][data-open]');
  const close = page.getByRole("button", { name: "Close sign in" });
  const email = page.getByLabel("Email address");
  const continueWithEmail = page.getByRole("button", { name: "Continue with email" });
  const signInWithBase = page.getByRole("button", { name: "Sign in with Base Account" });
  const expectAlignedHeader = async (name: string) => {
    const heading = page.getByRole("heading", { level: 2, name });
    // Sub-3px is invisible; hosted Linux font metrics round differently than macOS.
    // Poll: the sheet may still be laying out after a viewport or text-size change.
    const alignmentTolerance = process.env.CI ? 2.5 : 1;
    const misalignment = async () => {
      const [headingBox, closeBox, iconBox] = await Promise.all([
        heading.boundingBox(),
        close.boundingBox(),
        close.locator("svg").boundingBox(),
      ]);
      if (!headingBox || !closeBox || !iconBox) return Number.POSITIVE_INFINITY;
      const closeCenter = closeBox.y + closeBox.height / 2;
      return Math.max(
        Math.abs(headingBox.y + headingBox.height / 2 - closeCenter),
        Math.abs(iconBox.y + iconBox.height / 2 - closeCenter),
      );
    };
    await expect.poll(misalignment, { timeout: 10_000 }).toBeLessThanOrEqual(alignmentTolerance);
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
  await expect(page).toHaveURL(/\/home/);

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
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("IDRX Add money goes from method to VA instructions and verified receipt", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "ID"));
  await installApiFixtures(page);
  await signIn(page);
  await page.getByRole("button", { name: "Add money" }).click();
  // The row title is "Deposit IDR"; the provider and rail live in its description.
  const method = page.getByRole("button", { name: /Deposit IDR/ });
  await expect(method).toBeVisible();
  await expect(method).toContainText("IDRX · Bank transfer · Mandiri");
  await method.click();
  const orderDialog = page.getByRole("dialog", { name: "Deposit IDR" });
  await expect(orderDialog.getByRole("group", { name: "IDR" })).toHaveCount(1);
  await expect(orderDialog.getByLabel("Asset")).toHaveCount(0);
  await expect(orderDialog.getByRole("button", { name: "Close add money" })).toBeFocused();
  await typeAmount(page, "20000");
  await page.getByRole("button", { name: "Review quote", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review quote" })).toBeVisible();
  await expect(orderDialog.getByRole("group", { name: "IDR" })).toHaveCount(0);
  await expect(orderDialog.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(
    page.getByText("Receive", { exact: true }).locator(".."),
  ).toContainText("20.000,00\u00A0IDRX");
  await expect(page.getByText("Fees", { exact: true }).locator("..")).toContainText(
    "Not yet available",
  );
  await page.getByRole("button", { name: "Confirm deposit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review payment details" })).toBeVisible();
  await expect(
    page.getByText("Network", { exact: true }).locator(".."),
  ).toContainText("Rp\u00A0100,00");
  await expect(page.getByText("123456789012", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "View payment instructions" }).click();
  await expect(page.getByText("Deposit pending")).toBeVisible();
  await expect(page.getByText("123456789012", { exact: true })).toBeVisible();
  await expect(page.getByText("Money received")).toBeVisible({ timeout: 7_000 });
});

// --- #460 direct routes and Invest loading ---

// Direct routes must hydrate cold: the persisted owner cache restores in the
// first passive effect — after hydration, never during render — so a warm
// cache cannot diverge from the server's loading shell. Clearing it makes the
// measured renders genuinely cold.
function coldDirectLoad(page: Page, country: string) {
  return page.addInitScript((country) => {
    localStorage.setItem("home.country.v1", country);
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("home.query.v1:")) localStorage.removeItem(key);
    }
  }, country);
}

test("every canonical L1 and representative L2 route SSRs and first-paints cold on a persisted non-USD country (#460, #462)", async ({ page }) => {
  // GB is non-USD: the presentation region resolves on the client only and must
  // not diverge from the server-selected panel or Invest view at hydration.
  await coldDirectLoad(page, "GB");
  await installApiFixtures(page);
  await signIn(page);
  const hydrationErrors = trackHydrationErrors(page);
  const routes = [
    ["/home", ">Total balance<", "Home"],
    ["/balances", "aria-label=\"Your money\"", "Your money"],
    ["/balances/investments", "aria-label=\"Your money\"", "Your money"],
    ["/activity", "aria-label=\"Activity\"", "Activity"],
    ["/save", "aria-label=\"Savings\"", "Save"],
    ["/borrow", "aria-label=\"Borrow\"", "Borrow"],
    ["/invest", "aria-label=\"Invest\"", "Invest"],
    ["/invest/stocks", "aria-label=\"Stocks\"", "Stocks"],
    ["/invest/nvdac", "aria-label=\"NVIDIA\"", "NVIDIA"],
  ] as const;
  for (const [url, ssrMarker, title] of routes) {
    // The catch-all SSRs the validated target: exactly one visible panel.
    const html = await page.request.get(url).then((response) => response.text());
    expect(html).toContain(ssrMarker);
    expect((html.match(/<div data-shell-panel=""[^>]*>/g) ?? []).filter((tag) => !tag.includes("hidden")))
      .toHaveLength(1);
    await page.goto(url);
    // The shell header title is derived from the same active-panel state that
    // selects the visible panel, so it proves the target first-painted.
    await expect(page.locator("[data-shell-header-title]").first()).toHaveText(title);
    if (url === "/home") expect(await page.evaluate(
      () => document.querySelector<HTMLElement>(".app-main-authenticated")?.scrollTop ?? 0,
    )).toBe(0);
  }
  // Obsolete dashboard query routing has no authority on a canonical path.
  await page.goto("/home?panel=balances&group=investments");
  await expect(page.locator('[aria-label="Total balance"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toHaveCount(0);
  // Every hydration error fails — SSR and the initial hydration render the
  // loading shell and the owner cache restores after hydration, so the first
  // render must never diverge from the server HTML.
  expect(hydrationErrors).toEqual([]);
});

function anchoredGroupOffset(page: Page) {
  // The cold anchor puts the group at the top of the scrollport (respecting
  // its scroll margin) and never reports a reset-to-top scroll as anchored.
  return page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".app-main-authenticated");
    const group = document.getElementById("investments");
    return main && group && main.scrollTop > 0
      ? group.getBoundingClientRect().top - main.getBoundingClientRect().top
      : null;
  });
}

test("cold reload of a balances group URL anchors the requested group (#460)", async ({ page }) => {
  await coldDirectLoad(page, "US");
  await installApiFixtures(page, { balances: scrollableBalancesSnapshot() });
  await signIn(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/balances/investments");
  await expect.poll(() => anchoredGroupOffset(page)).toBeGreaterThanOrEqual(14);
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName("session:verified", "mark").length,
  )).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  // A fresh server-verified settled load consumes the anchor. Show/Hide changes
  // rendered topology without owning scroll, and a second change after a manual
  // reset proves the consumed cold anchor never refires (#462, #485).
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide small balances" })).toBeVisible();
  // Native scroll anchoring may move the numeric offset as rows appear above,
  // but the shell must not force the refreshed list back to zero.
  await expect.poll(() => page.evaluate(() =>
    document.querySelector<HTMLElement>(".app-main-authenticated")?.scrollTop ?? 0,
  )).toBeGreaterThan(0);
  await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".app-main-authenticated");
    if (main) {
      main.style.overflowAnchor = "none";
      main.scrollTop = 0;
    }
  });
  await page.getByRole("button", { name: "Hide small balances" }).evaluate(
    (button: HTMLButtonElement) => button.click(),
  );
  await expect(page.getByRole("button", { name: "Hide small balances" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    document.querySelector<HTMLElement>(".app-main-authenticated")?.scrollTop ?? 0,
  )).toBe(0);
  // Back still completes and re-anchors through the #452 history path; the cold anchor never refires.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/balances\/investments$/);
  await expect.poll(() => anchoredGroupOffset(page)).toBeGreaterThanOrEqual(14);
});

test("background revalidation of cached-ready balances keeps the cold group anchored (#462)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  // The first read seeds the persisted owner cache; once the reload is on its
  // way, the refetch returns changed rows so the settled list identity differs
  // from the cached list the anchor first saw.
  let serveRevalidated = false;
  let revalidatedReads = 0;
  await page.route((url) => url.pathname === "/api/balances", async (route) => {
    const region = (new URL(route.request().url()).searchParams.get("region") ?? "US") as RegionId;
    if (!serveRevalidated) return json(route, scrollableBalancesSnapshot(region));
    revalidatedReads += 1;
    return json(route, {
      ...scrollableBalancesSnapshot(region),
      holdings: scrollableBalancesSnapshot(region).holdings.map((holding) =>
        holding.symbol === "USDC"
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
  await signIn(page);
  await expect.poll(() => page.evaluate(() =>
    Object.keys(localStorage).find((key) => key.startsWith("home.query.v1:")) ?? null,
  )).not.toBeNull();
  // Let the persister's trailing throttled writes flush before mutating, so
  // the staleness edit survives until the reload.
  await page.waitForTimeout(600);
  // Force the persisted query stale so the reload first paints cached-ready
  // rows while a background refetch is in flight.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("home.query.v1:"));
    if (!key) throw new Error("Persisted owner cache is missing");
    const persisted = JSON.parse(localStorage.getItem(key) ?? "null") as {
      clientState?: { queries?: Array<{ state?: { dataUpdatedAt?: number } }> };
    };
    for (const query of persisted.clientState?.queries ?? []) {
      // Stale so the reload revalidates, but hydratable so the cached rows
      // paint first (a zeroed dataUpdatedAt makes hydrate skip the query).
      if (query.state) query.state.dataUpdatedAt = Date.now() - 60_000;
    }
    localStorage.setItem(key, JSON.stringify(persisted));
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  serveRevalidated = true;
  await page.goto("/balances/investments");
  // The cached-ready list anchors immediately...
  await expect.poll(() => anchoredGroupOffset(page)).toBeGreaterThanOrEqual(14);
  // ...and the anchor survives the revalidation settling on changed rows.
  await expect.poll(() => revalidatedReads, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await expect(
    page.locator('[data-shell-panel]:not([hidden]) li', { hasText: "$12.35" }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => anchoredGroupOffset(page)).toBeGreaterThanOrEqual(14);
});

test("cross-canonical-route Back/Forward keeps one persistent shell without remount (#462)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);
  const hydrationErrors = trackHydrationErrors(page);

  // Cross canonical routes through in-app optimistic navigation only.
  await page.getByRole("button", { name: "Your money", exact: true }).click();
  await expect(page).toHaveURL(/\/balances$/);
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page).toHaveURL(/\/invest$/);

  // A shell remount (a stale page-module tree) would replace these nodes; the
  // probe must survive two Back and two Forward crossings across /home,
  // /balances, and /invest within the single catch-all route tree.
  await page.evaluate(() => {
    const nodes = [
      document.querySelector<HTMLElement>(".app-main-authenticated"),
      document.querySelector<HTMLElement>("header"),
    ];
    for (const node of nodes) {
      if (node) (node as HTMLElement & { __shellProbe?: boolean }).__shellProbe = true;
    }
  });

  await page.goBack();
  await expect(page).toHaveURL(/\/balances$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your money" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/balances$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/invest$/);
  await expect(page.getByRole("heading", { name: "Invest" })).toBeVisible();

  const probeSurvived = await page.evaluate(() => {
    const nodes = [
      document.querySelector<HTMLElement>(".app-main-authenticated"),
      document.querySelector<HTMLElement>("header"),
    ];
    return nodes.every((node) => node && (node as HTMLElement & { __shellProbe?: boolean }).__shellProbe === true);
  });
  expect(probeSurvived).toBe(true);
  expect(hydrationErrors).toEqual([]);
});

test("Invest loading pulses and gain/loss colors respond to theme (#460)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.route("**/api/market-prices", (route) => json(route, {
    version: 1, provider: "codex", fetchedAt: CREATED_AT, markets: { stock: { status: "ready", snapshots: [
      { assetId: "nvdac", displayPrice: "$170.30", asOf: CREATED_AT, sourceLabel: "Fixture", changeLabel: "+2.5%" },
      { assetId: "metac", displayPrice: "$12.10", asOf: CREATED_AT, sourceLabel: "Fixture", changeLabel: "-1.25%" },
    ] } },
  }));
  await signIn(page);
  await page.goto("/invest/stocks");
  const gain = page.locator('[data-money-change="positive"]').first();
  const loss = page.locator('[data-money-change="negative"]').first();
  await expect(gain).toBeVisible();
  await expect(loss).toBeVisible();
  const colors = () => page.evaluate(() => ["positive", "negative"].map((kind) =>
    getComputedStyle(document.querySelector(`[data-money-change="${kind}"]`)!).color));
  const light = await colors();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const dark = await colors();
  expect(light).toEqual(["rgb(19, 115, 51)", "rgb(180, 35, 24)"]);
  expect(dark).not.toEqual(light);
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.unroute("**/api/market-prices");
  await page.route("**/api/market-prices", () => {});
  await page.goto("/invest/stocks");
  const row = page.locator('[data-shell-panel]:not([hidden]) section[aria-label="Stocks"] li', { hasText: "NVIDIA" });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("—");
  await expect(row.locator('[data-slot="skeleton"]')).toHaveCount(2);
  expect(await row.locator('[data-slot="skeleton"]').evaluateAll((bars) => bars.every((bar) =>
    getComputedStyle(bar).animationName !== "none" && bar.getBoundingClientRect().height > 0))).toBe(true);
});
