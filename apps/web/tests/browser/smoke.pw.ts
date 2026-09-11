import { expect, test, type Page, type Route } from "@playwright/test";
import { parsePortfolioValuationSnapshot } from "../../features/portfolio-valuation/parse";

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

test("signed-in send survives reload without a second wallet dispatch", async ({ page }) => {
  parsePortfolioValuationSnapshot(valuation(), {
    subject: "playwright-smoke-subject",
    smartAccountAddress: OWNER,
    chainId: 8453,
  }, "US");
  await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
  await installApiFixtures(page);
  await page.goto("/?account=signin");
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
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
