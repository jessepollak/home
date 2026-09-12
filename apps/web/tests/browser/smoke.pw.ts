import { expect, test, type Page, type Route } from "@playwright/test";
import { parsePortfolioValuationSnapshot } from "../../shared/portfolio/parse-valuation";
import {
  BASE_USDC_ADDRESS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "../../shared/savings/config";

// Local laptops paint balances in ~350-620ms; hosted CI runners measure 1.0-2.2s. Regressions show as multiples, not tens of ms.
const BALANCES_PAINTED_BUDGET_MS = process.env.CI ? 3_500 : 1_000;

const OWNER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const USER_OPERATION_HASH = `0x${"ab".repeat(32)}`;
const TRANSACTION_HASH = `0x${"cd".repeat(32)}`;
const CREATED_AT = new Date().toISOString();
const EXPIRES_AT = new Date(Date.now() + 10 * 60_000).toISOString();

type ActionStatus = "unconfirmed" | "pending" | "confirmed";

function action() {
  const amount = "1000000";
  return {
    id: ACTION_ID,
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

function savingsPositions() {
  return {
    accountAddress: OWNER,
    fetchedAt: "2026-09-12T12:00:02.000Z",
    vaults: MORPHO_V1_CANDIDATE_ADDRESSES.map((vaultAddress) => ({
      vaultAddress,
      position: null,
    })),
  };
}

function recognizedValuation() {
  const base = valuation();
  return {
    ...base,
    recognized: {
      status: "complete",
      holdings: [{
        id: "recognized:0x9999999999999999999999999999999999999999",
        assetKey: "eip155:8453/erc20:0x9999999999999999999999999999999999999999",
        name: "Recognized Coin",
        symbol: "RCG",
        decimals: 18,
        contractAddress: "0x9999999999999999999999999999999999999999",
        balanceBaseUnits: "1230000000000000000",
        liquidityUsd: { atoms: "100000", scale: 0 },
        volume24Usd: { atoms: "10000", scale: 0 },
        valueCurrency: "USD",
        value: null,
        valuationStatus: "unpriced",
      }],
    },
  };
}

function scrollableValuation() {
  const base = valuation();
  const extras = Array.from({ length: 24 }, (_, index) => ({
    kind: "direct" as const,
    id: `zero-holding-${index}`,
    assetKey: `eip155:8453/erc20:0x${index
      .toString(16)
      .padStart(40, "0")}`,
    name: `Zero holding ${index}`,
    symbol: `Z${index}`,
    decimals: 18,
    assetKind: "erc20" as const,
    contractAddress: null,
    cashCurrency: null,
    balanceBaseUnits: "1",
    readStatus: "ready" as const,
  }));
  return {
    ...base,
    inventory: {
      ...base.inventory,
      holdings: [...base.inventory.holdings, ...extras],
    },
  };
}

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function installApiFixtures(
  page: Page,
  options: { portfolioValuation?: ReturnType<typeof valuation> } = {},
) {
  let status: ActionStatus = "unconfirmed";
  let valuationReads = 0;
  let activityReads = 0;
  let delayedValuation: Promise<void> | null = null;
  let releaseDelayedValuation: (() => void) | null = null;
  let handleRecorded = false;
  let failHandleResponseOnce = true;
  let fundingStatusReads = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/session") return json(route, { user: { subject: "playwright-smoke-subject" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" });
    if (path === "/api/portfolio/valuation") {
      valuationReads += 1;
      if (delayedValuation) await delayedValuation;
      return json(route, options.portfolioValuation ?? valuation());
    }
    if (path === "/api/portfolio") return json(route, { walletAddress: OWNER, chainId: 8453, blockNumber: "16", blockHash: `0x${"cd".repeat(32)}`, blockTimestamp: "100", fetchedAt: new Date().toISOString(), assets: [{ id: "usdc", symbol: "USDC", decimals: 6, kind: "erc20", tokenAddress: USDC, balanceBaseUnits: "12340000" }, { id: "eth", symbol: "ETH", decimals: 18, kind: "native", balanceBaseUnits: "0" }] });
    if (path === "/api/actions/prepare" && request.method() === "POST") { status = "unconfirmed"; return json(route, action()); }
    if (path === `/api/actions/${ACTION_ID}/confirm`) { status = "pending"; return json(route, { id: ACTION_ID, calls: action().calls, summary: { title: "Send USDC", amounts: action().amounts, warnings: action().warnings, expiresAt: EXPIRES_AT }, expiresAt: EXPIRES_AT }); }
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
      ? { id: ACTION_ID, kind: "send", summary: { title: "Send USDC", amounts: action().amounts, warnings: action().warnings, expiresAt: EXPIRES_AT }, calls: action().calls, expiresAt: EXPIRES_AT }
      : { action: { id: ACTION_ID, status: "pending", providerHandle: handleRecorded ? USER_OPERATION_HASH : undefined } });
    if (path === "/api/actions") return json(route, { actions: status === "pending" || status === "confirmed" ? [{ id: ACTION_ID, provider: "cdp-embedded", kind: "send", summary: { title: "Send USDC", amounts: action().amounts, warnings: action().warnings, expiresAt: EXPIRES_AT }, status, createdAt: CREATED_AT, confirmedAt: CREATED_AT, providerHandle: handleRecorded ? USER_OPERATION_HASH : undefined, transactionHash: status === "confirmed" ? TRANSACTION_HASH : undefined, owner: action().owner }] : [] });
    if (path === "/api/activity") {
      activityReads += 1;
      const to = url.searchParams.get("to") ?? new Date().toISOString();
      const from = new Date(new Date(to).getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const transfers = status === "confirmed" ? [{
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
    if (path === "/api/savings/positions") return json(route, savingsPositions());
    if (path === "/api/funding/providers") return json(route, url.searchParams.get("region") === "ID" ? { providers: [{ providerId: "idrx", displayName: "IDRX", region: "ID", assetId: "base:idrx", assetSymbol: "IDRX", assetDecimals: 2, currency: "IDR", paymentMethods: [{ id: "bank-va-mandiri", label: "Bank transfer · Mandiri" }], quotes: false, kyc: null }] } : { providers: [] });
    if (path === "/api/funding/quotes") return json(route, { quoteToken: "fixture-signed-quote", quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: EXPIRES_AT } });
    if (path === "/api/funding/orders" && request.method() === "POST") return json(route, { order: { id: ACTION_ID, providerId: "idrx", region: "ID", assetId: "base:idrx", paymentMethod: "bank-va-mandiri", fiatAmount: "20000", state: "awaiting-payment", expectedTokenAmountAtomic: "2000000", fees: [{ label: "Network", amount: "100", currency: "IDR" }], instructions: { kind: "bank-transfer", rail: "Mandiri virtual account", accountNumber: "123456789012", accountName: "Home Fixture", amount: "20000", currency: "IDR" }, providerStatus: "pending" } });
    if (path === "/api/funding/orders" && request.method() === "GET") return json(route, { order: null });
    if (path === `/api/funding/orders/${ACTION_ID}`) { fundingStatusReads += 1; return json(route, { order: { id: ACTION_ID, providerId: "idrx", region: "ID", assetId: "base:idrx", paymentMethod: "bank-va-mandiri", fiatAmount: "20000", state: fundingStatusReads > 0 ? "received" : "awaiting-payment", instructions: null, providerStatus: "completed" } }); }
    if (path === "/api/basename-profile") return json(route, { profile: null });
    return json(route, {});
  });
  return {
    valuationReads: () => valuationReads,
    activityReads: () => activityReads,
    delayNextValuation() {
      delayedValuation = new Promise<void>((resolve) => { releaseDelayedValuation = resolve; });
      return valuationReads + 1;
    },
    releaseValuation() {
      releaseDelayedValuation?.();
      delayedValuation = null;
      releaseDelayedValuation = null;
    },
  };
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

test("recognized token is nested-Balances-only and never enters Send availability", async ({ page }) => {
  const fixture = recognizedValuation();
  parsePortfolioValuationSnapshot(fixture, {
    subject: "playwright-smoke-subject",
    smartAccountAddress: OWNER,
    chainId: 8453,
  }, "US");
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page, { portfolioValuation: fixture });
  await signIn(page);

  await expect(page.getByText("Recognized Coin", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Balances" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Balances" })).toBeVisible();
  await expect(page.getByText("Recognized Coin", { exact: true })).toBeVisible();
  await expect(page.getByText("1.2300 RCG", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  const send = page.getByRole("dialog", { name: "Send" });
  await expect(send.getByText("Recognized Coin", { exact: true })).toHaveCount(0);
  await expect(send.getByText("RCG", { exact: true })).toHaveCount(0);
  await expect(send.getByText(/12\.34 available/)).toBeVisible();
});

test("ambiguous handle response retries without a second wallet dispatch", async ({ page }) => {
  parsePortfolioValuationSnapshot(valuation(), {
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

test("reload paints persisted balances before stale valuation responds", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  const fixtures = await installApiFixtures(page);
  await signIn(page);
  const coldPaint = await page.evaluate(() =>
    performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Number.POSITIVE_INFINITY,
  );
  await expect.poll(() => page.evaluate(() =>
    Object.keys(localStorage).find((key) => key.startsWith("home.query.v1:")) ?? null,
  )).not.toBeNull();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("home.query.v1:"));
    if (!key) throw new Error("Persisted owner cache is missing");
    const persisted = JSON.parse(localStorage.getItem(key) ?? "null") as {
      clientState?: { queries?: Array<{ state?: { dataUpdatedAt?: number } }> };
    };
    for (const query of persisted.clientState?.queries ?? []) {
      if (query.state) query.state.dataUpdatedAt = 0;
    }
    localStorage.setItem(key, JSON.stringify(persisted));
  });
  const delayedRead = fixtures.delayNextValuation();

  await page.reload();
  await expect.poll(fixtures.valuationReads).toBe(delayedRead);
  await expect(page.getByText("$12.34", { exact: true }).first()).toBeVisible();
  const reloadPaint = await page.evaluate(() =>
    performance.getEntriesByName("balances:painted", "mark")[0]?.startTime ?? Number.POSITIVE_INFINITY,
  );
  expect(reloadPaint).toBeLessThan(coldPaint);
  fixtures.releaseValuation();
});

test("reload resumes an unconfirmed send review from its URL action", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);

  await page.goto(`/dashboard?flow=send&action=${ACTION_ID}`);
  await page.reload();

  const review = page.getByRole("dialog", { name: "Confirm" });
  await expect(review).toBeVisible();
  await expect(review.getByText("You're sending USDC")).toBeVisible();
  await expect(review.getByRole("button", { name: "Send $1.00" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`flow=send.*action=${ACTION_ID}`));
});

test("shallow-routed money flows open from URLs and Back closes them", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);

  const cases = [
    { flow: "add-money", dialog: "Add money" },
    { flow: "receive", dialog: "Receive" },
    { flow: "save-deposit", dialog: "Deposit" },
  ] as const;

  for (const entry of cases) {
    await page.goto(`/dashboard?flow=${entry.flow}`);
    await expect(page.getByRole("dialog", { name: entry.dialog })).toBeVisible();
    await page.goBack();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard$/);
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
    window.history.replaceState(window.history.state, "", "/dashboard");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Add money", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?flow=add-money$/);
  await expect(page.getByRole("dialog", { name: "Add money" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Receive crypto/ })).toBeVisible();
});

test("Add money close preserves the active panel", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);

  await page.getByRole("button", { name: "Balances", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?panel=balances$/);
  await page.evaluate(() => {
    window.history.pushState(null, "", "/dashboard?panel=balances&flow=add-money");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/dashboard\?panel=balances&flow=add-money$/);
  await expect(page.getByRole("dialog", { name: "Add money" })).toBeVisible();
  await page.getByRole("button", { name: "Close add money" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\?panel=balances$/);
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

async function openScrolledBalances(page: Page) {
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.route(
    (url) => url.pathname === "/api/portfolio/valuation",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(scrollableValuation()),
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

  await page.getByRole("button", { name: "Balances" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Balances" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]panel=balances/);

  const maxTop = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".app-main-authenticated");
    return main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0;
  });
  expect(maxTop).toBeGreaterThan(0);

  const target = await page.evaluate((max) => {
    const main = document.querySelector<HTMLElement>(".app-main-authenticated");
    if (!main) return 0;
    const next = Math.min(240, max);
    main.scrollTop = next;
    main.dispatchEvent(new Event("scroll", { bubbles: true }));
    return next;
  }, maxTop);
  expect(target).toBeGreaterThan(0);

  // The real IntersectionObserver reveals at least one more batch on scroll.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelectorAll(
            '[data-shell-panel]:not([hidden]) .supplied-asset-list li',
          ).length,
      ),
    )
    .toBeGreaterThan(10);
  const revealedCount = await page.evaluate(
    () =>
      document.querySelectorAll(
        '[data-shell-panel]:not([hidden]) .supplied-asset-list li',
      ).length,
  );
  return { target, revealedCount, maxTop };
}

async function openInvestAssetDetail(page: Page) {
  await page.getByRole("button", { name: "Invest" }).click();
  await expect(page.getByRole("heading", { name: "Invest" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]panel=invest/);
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

  await page.getByRole("button", { name: "NVIDIA details" }).click();
  await expect(page.getByRole("heading", { name: "NVIDIA" })).toBeVisible();
  await expect(page).toHaveURL(/[?&]asset=nvdac/);
}

async function expectBalancesRestored(
  page: Page,
  expected: { target: number; revealedCount: number; maxTop: number },
) {
  await expect(page.getByRole("heading", { name: "Balances" })).toBeVisible();
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
            '[data-shell-panel]:not([hidden]) .supplied-asset-list li',
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
  await page.getByRole("button", { name }).click({ force: true });
  await expect(page).toHaveURL(expectedUrl);
}

async function expectBalancesReset(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Balances" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (document.querySelector<HTMLElement>(".app-main-authenticated")
            ?.scrollTop ?? 0),
      ),
    )
    .toBe(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelectorAll(
            '[data-shell-panel]:not([hidden]) .supplied-asset-list li',
          ).length,
      ),
    )
    .toBe(10);
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
  await openScrolledBalances(page);
  await clickForwardAndWaitForUrl(page, "Invest", /[?&]panel=invest/);
  await expect(page.getByRole("heading", { name: "Invest" })).toBeVisible();
  await page.goBack();
  await expectBalancesReset(page);
});

test("Balances starts at the top after browser Back from Home", async ({ page }) => {
  await openScrolledBalances(page);
  await clickForwardAndWaitForUrl(page, "Back", /\/dashboard$/);
  await page.goBack();
  await expectBalancesReset(page);
});

test("Balances starts at the top after Activity and browser Back", async ({ page }) => {
  await openScrolledBalances(page);
  await clickForwardAndWaitForUrl(page, "Back", /\/dashboard$/);
  await clickForwardAndWaitForUrl(page, "Activity", /[?&]panel=activity/);
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]panel=activity/);
  await page.goBack();
  await expectBalancesReset(page);
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
  bottom: number;
  height: number;
  translateY: number;
  viewportHeight: number;
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

const MONEY_SHEET_ANCHOR_TOLERANCE = 1.5;
// The spring writes its exact final target and closes the native dialog in the
// same callback, so requestAnimationFrame can be one painted frame behind.
const MONEY_SHEET_CLOSE_FRAME_TOLERANCE = 24;

async function beginMoneySheetTrace(page: Page) {
  await page.evaluate(() => {
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
        const transform = getComputedStyle(sheet).transform;
        const translateY = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
        trace.samples.push({
          t: performance.now() - started,
          y: rect.y,
          bottom: rect.bottom,
          height: rect.height,
          translateY,
          viewportHeight: window.innerHeight,
          owner: sheet.dataset.positionOwner ?? "missing",
          state: sheet.dataset.state ?? "missing",
        });
      }
      if (!trace.stop) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function endMoneySheetTrace(page: Page) {
  return page.evaluate(() => {
    const debug = globalThis as typeof globalThis & {
      moneySheetDebug?: { samples: MoneySheetMotionSample[]; stop: boolean };
    };
    if (!debug.moneySheetDebug) return [];
    debug.moneySheetDebug.stop = true;
    return debug.moneySheetDebug.samples;
  });
}

async function waitForMoneySheetIdle(page: Page) {
  await expect.poll(() => page.locator(
    "dialog[open] [data-money-sheet]",
  ).getAttribute("data-position-owner")).toBe("idle");
}

function expectUntransformedAnchor(samples: MoneySheetMotionSample[]) {
  expect(samples.length).toBeGreaterThan(0);
  for (const sample of samples) {
    expect(Math.abs(sample.bottom - sample.translateY - sample.viewportHeight))
      .toBeLessThanOrEqual(MONEY_SHEET_ANCHOR_TOLERANCE);
  }
}

function expectIdleAnchor(sample: MoneySheetMotionSample) {
  expect(sample.owner).toBe("idle");
  expect(Math.abs(sample.bottom - sample.viewportHeight))
    .toBeLessThanOrEqual(MONEY_SHEET_ANCHOR_TOLERANCE);
  expect(Math.abs(sample.y - (sample.viewportHeight - sample.height)))
    .toBeLessThanOrEqual(MONEY_SHEET_ANCHOR_TOLERANCE);
}

test("@money-modal-anchor anchors Add money and Send across desktop and mobile viewports", async ({ page }, testInfo) => {
  const cases = [
    { name: "Add money", closeName: "Close add money", width: 1326, height: 702 },
    { name: "Send", closeName: "Close send dialog", width: 1326, height: 702 },
    { name: "Add money", closeName: "Close add money", width: 390, height: 844 },
    { name: "Send", closeName: "Close send dialog", width: 390, height: 844 },
  ] as const;
  const measurements: Array<Record<string, unknown>> = [];

  await page.setViewportSize({ width: cases[0].width, height: cases[0].height });
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await signIn(page);

  for (const modalCase of cases) {
    await page.setViewportSize({ width: modalCase.width, height: modalCase.height });
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const trigger = page.getByRole("button", { name: modalCase.name, exact: true });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await expect(trigger).toBeFocused();
    const initialOverflow = await page.evaluate(() => document.body.style.overflow);

    await beginMoneySheetTrace(page);
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: modalCase.name });
    await expect(dialog).toBeVisible();
    await waitForMoneySheetIdle(page);
    await page.waitForTimeout(50);
    const openSamples = await endMoneySheetTrace(page);

    expect(compactMotionOwners(openSamples)).toEqual(["opening", "idle"]);
    const opening = openSamples.filter(({ owner }) => owner === "opening");
    expect(opening.length).toBeGreaterThan(0);
    // The "starts offscreen" check is only meaningful when the trace caught the
    // first frames; hosted WebKit runners can deliver the first rAF after the
    // sheet has already risen. The anchor assertions below stay unconditional.
    if (opening[0].t <= 120) {
      expect(opening[0].y).toBeGreaterThanOrEqual(
        opening[0].viewportHeight - MONEY_SHEET_ANCHOR_TOLERANCE,
      );
    }
    expectUntransformedAnchor(openSamples);
    const settled = openSamples.findLast(({ owner }) => owner === "idle")!;
    expectIdleAnchor(settled);

    const sheet = dialog.locator("[data-money-sheet]");
    const settledBox = await sheet.boundingBox();
    if (!settledBox) throw new Error(`${modalCase.name} sheet is not measurable`);
    expect(settledBox.x).toBeGreaterThanOrEqual(-1);
    expect(settledBox.x + settledBox.width).toBeLessThanOrEqual(modalCase.width + 1);
    expect(settledBox.width).toBeCloseTo(modalCase.width, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await beginMoneySheetTrace(page);
    await page.waitForTimeout(32);
    await dialog.getByRole("button", { name: modalCase.closeName }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const closeSamples = await endMoneySheetTrace(page);

    expect(compactMotionOwners(closeSamples)).toEqual(["idle", "closing"]);
    expectUntransformedAnchor(closeSamples);
    expectIdleAnchor(closeSamples.find(({ owner }) => owner === "idle")!);
    const closing = closeSamples.filter(({ owner }) => owner === "closing");
    expect(closing.length).toBeGreaterThan(0);
    expectMonotonic(closing.map(({ y }) => y), "down");
    // "Ends offscreen" needs enough sampled frames to have seen the end of the
    // ~375ms close; hosted WebKit runners can deliver only a handful of rAFs.
    if (closing.length >= 6) {
      expect(closing.at(-1)!.y).toBeGreaterThanOrEqual(
        closing.at(-1)!.viewportHeight - MONEY_SHEET_CLOSE_FRAME_TOLERANCE,
      );
    }
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(initialOverflow);

    measurements.push({
      engine: testInfo.project.name,
      modal: modalCase.name,
      viewport: `${modalCase.width}x${modalCase.height}`,
      settled: {
        x: settledBox.x,
        y: settledBox.y,
        width: settledBox.width,
        height: settledBox.height,
        bottom: settledBox.y + settledBox.height,
      },
      openOwners: compactMotionOwners(openSamples),
      closeOwners: compactMotionOwners(closeSamples),
      openDurationMs: Math.round(
        openSamples.find(({ owner }) => owner === "idle")!.t - opening[0].t,
      ),
    });
  }

  console.log(`MONEY_MODAL_ANCHOR ${JSON.stringify(measurements)}`);
  await testInfo.attach("money-modal-anchor-measurements", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
});

test.describe("MoneyModal painted motion", () => {
  test("@money-modal-anchor opens, throws up, reverses, and closes with one position owner", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
    await installApiFixtures(page);
    await signIn(page);

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

    await beginMoneySheetTrace(page);
    await page.getByRole("button", { name: "Send" }).click();
    await waitForMoneySheetIdle(page);
    await page.waitForTimeout(200);
    const openSamples = await endMoneySheetTrace(page);

    const openGrabber = page.locator("dialog[open] [data-money-sheet-grabber]");
    const hitBox = await openGrabber.boundingBox();
    const visibleGrabberBox = await openGrabber.locator(":scope > span").boundingBox();
    expect(hitBox?.width).toBeGreaterThanOrEqual(44);
    expect(hitBox?.height).toBeGreaterThanOrEqual(44);
    expect(visibleGrabberBox?.height).toBe(4);
    expect((visibleGrabberBox?.y ?? 0) - (hitBox?.y ?? 0)).toBeCloseTo(8, 1);

    await beginMoneySheetTrace(page);
    await gesture([{ distance: 120, pause: 40 }, { distance: -20, pause: 0 }]);
    await waitForMoneySheetIdle(page);
    await page.waitForTimeout(200);
    const throwSamples = await endMoneySheetTrace(page);

    await beginMoneySheetTrace(page);
    await gesture([{ distance: 220, pause: 160 }, { distance: 190, pause: 0 }]);
    await waitForMoneySheetIdle(page);
    await page.waitForTimeout(200);
    const reverseSamples = await endMoneySheetTrace(page);
    await expect(page.getByRole("dialog", { name: "Send" })).toBeVisible();

    await beginMoneySheetTrace(page);
    await page.waitForTimeout(32);
    await page.getByRole("button", { name: "Close send dialog" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const closeSamples = await endMoneySheetTrace(page);

    expect(compactMotionOwners(openSamples)).toEqual(["opening", "idle"]);
    expect(compactMotionOwners(throwSamples)).toEqual(["idle", "drag", "idle"]);
    expect(compactMotionOwners(reverseSamples)).toEqual(["idle", "drag", "returning", "idle"]);
    expect(compactMotionOwners(closeSamples)).toEqual(["idle", "closing"]);
    expectUntransformedAnchor(openSamples);
    expectUntransformedAnchor(throwSamples);
    expectUntransformedAnchor(reverseSamples);
    expectUntransformedAnchor(closeSamples);

    const openStart = openSamples.find(({ owner }) => owner === "opening")!;
    const openEnd = openSamples.find(({ owner }) => owner === "idle")!;
    expect(openStart.y).toBeGreaterThanOrEqual(
      openStart.viewportHeight - MONEY_SHEET_ANCHOR_TOLERANCE,
    );
    expectIdleAnchor(openEnd);
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
    expect(
      Math.max(...returning.map(({ height }) => height))
      - Math.min(...returning.map(({ height }) => height)),
    ).toBeLessThanOrEqual(1);
    expectIdleAnchor(reverseSamples.findLast(({ owner }) => owner === "idle")!);

    expectIdleAnchor(closeSamples.find(({ owner }) => owner === "idle")!);
    const closing = closeSamples.filter(({ owner }) => owner === "closing");
    const closeDuration = closing.at(-1)!.t - closing[0].t + 16;
    expectMonotonic(closing.map(({ y }) => y), "down");
    expect(closing.at(-1)!.y).toBeGreaterThanOrEqual(
      closing.at(-1)!.viewportHeight - MONEY_SHEET_CLOSE_FRAME_TOLERANCE,
    );
    expect(
      Math.max(...closing.map(({ height }) => height))
      - Math.min(...closing.map(({ height }) => height)),
    ).toBeLessThanOrEqual(1);
    expect(closeDuration).toBeGreaterThanOrEqual(300);
    expect(closeDuration).toBeLessThanOrEqual(450);

    const measurements = {
      engine: testInfo.project.name,
      viewport: "390x844",
      openDurationMs: Math.round(openDuration),
      closeDurationMs: Math.round(closeDuration),
      settled: {
        y: openEnd.y,
        bottom: openEnd.bottom,
        height: openEnd.height,
        translateY: openEnd.translateY,
        viewportHeight: openEnd.viewportHeight,
      },
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

test("IDRX Add money goes from method to VA instructions and verified receipt", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "ID"));
  await installApiFixtures(page);
  await signIn(page);
  await page.getByRole("button", { name: "Add money" }).click();
  const method = page.getByRole("button", { name: /Deposit IDR with IDRX/ });
  await expect(method).toBeVisible();
  await method.click();
  await typeAmount(page, "20000");
  await page.getByRole("button", { name: "Review quote", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review quote" })).toBeVisible();
  await expect(page.getByText("Receive: 20.000,00\u00A0IDRX")).toBeVisible();
  await expect(page.getByText("Fees: Not yet available")).toBeVisible();
  await page.getByRole("button", { name: "Confirm deposit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review payment details" })).toBeVisible();
  await expect(page.getByText("Network: Rp\u00A0100,00")).toBeVisible();
  await expect(page.getByText("123456789012")).not.toBeVisible();
  await page.getByRole("button", { name: "View payment instructions" }).click();
  await expect(page.getByText("Deposit pending")).toBeVisible();
  await expect(page.getByText("123456789012")).toBeVisible();
  await expect(page.getByText("Money received")).toBeVisible({ timeout: 7_000 });
});
