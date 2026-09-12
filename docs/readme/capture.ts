// Capture the current UI against the same sample-only account boundary used by
// apps/web/tests/browser/smoke.pw.ts. Browser API requests are locally fulfilled,
// while unexpected non-local requests are aborted and reported.
import { chromium, type BrowserContext, type Page, type Route } from "@playwright/test";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const captureUrl = new URL(process.env.HOME_CAPTURE_BASE_URL ?? "http://localhost:3199");
if (captureUrl.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(captureUrl.hostname)) {
  throw new Error("HOME_CAPTURE_BASE_URL must be a local HTTP origin.");
}
const BASE_URL = captureUrl.origin;
const LOCAL_WEBSOCKET_ORIGIN = BASE_URL.replace(/^http:/, "ws:");
const OUTPUT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(OUTPUT_DIR, "../..");
const OWNER = "0x1111111111111111111111111111111111111111";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const VAULTS = [
  "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
  "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
  "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183",
];

function now() {
  return new Date().toISOString();
}

function valuation() {
  const fetchedAt = now();
  const usdcKey = `eip155:8453/erc20:${USDC}`;
  const holdings = [
    {
      kind: "direct", id: "eth", assetKey: "eip155:8453/native", name: "Ethereum",
      symbol: "ETH", decimals: 18, assetKind: "native", contractAddress: null,
      cashCurrency: null, balanceBaseUnits: "850000000000000000", readStatus: "ready",
    },
    {
      kind: "direct", id: "usdc", assetKey: usdcKey, name: "US dollar", symbol: "USDC",
      decimals: 6, assetKind: "erc20", contractAddress: USDC, cashCurrency: "USD",
      balanceBaseUnits: "1284000000", readStatus: "ready",
    },
    ...VAULTS.map((address, index) => ({
      kind: "vault-position", id: `vault-${index}`,
      assetKey: `eip155:8453/erc20:${address.toLowerCase()}`,
      name: index === 0 ? "Steakhouse USDC" : index === 1 ? "Gauntlet USDC Prime" : "Re7 USDC",
      symbol: "USDC vault", vaultAddress: address, decimals: 18,
      underlyingAssetKey: usdcKey, underlyingSymbol: "USDC", underlyingDecimals: 6,
      sharesBaseUnits: index === 1 ? "312000000000000000000" : "0",
      underlyingBaseUnits: index === 1 ? "320000000" : "0", readStatus: "ready",
      conversionMethod: "erc4626-convertToAssets",
    })),
  ];
  const source = {
    provider: "Coinbase Exchange Rates", method: "README sample fixture", fetchedAt, asOf: fetchedAt,
    timeBasis: "retrieved-at",
  };
  const values = new Map([
    ["eip155:8453/native", { atoms: "267632", scale: 2 }],
    [usdcKey, { atoms: "1284", scale: 0 }],
    [`eip155:8453/erc20:${VAULTS[1]!.toLowerCase()}`, { atoms: "320", scale: 0 }],
  ]);
  return {
    version: 2, walletAddress: OWNER, chainId: 8453, selectedRegion: "US", quoteCurrency: "USD",
    block: { number: "35123456", hash: `0x${"cd".repeat(32)}`, timestamp: String(Math.floor(Date.now() / 1000)) },
    fetchedAt,
    inventory: { scope: "configured-base-assets-v1", walletDiscoveryComplete: false, holdings, omissions: [] },
    prices: [],
    fx: { baseCurrency: "USD", quoteCurrency: "USD", quoteUnitsPerUsd: { atoms: "1", scale: 0 }, sourceValue: "1", status: "fresh", source },
    nativeEthQuote: { baseCurrency: "USD", assetSymbol: "ETH", assetUnitsPerUsd: { atoms: "3176", scale: 7 }, sourceValue: "0.0003176", status: "fresh", source },
    lines: holdings.map(({ assetKey }) => ({
      holdingAssetKey: assetKey,
      valueCurrency: "USD",
      value: values.get(assetKey) ?? { atoms: "0", scale: 0 },
      status: "priced",
      reason: null,
    })),
    cashBuckets: [{
      id: `cash:${usdcKey}`, roles: ["canonical-usd", "selected-local"], assetKey: usdcKey,
      symbol: "USDC", denominationCurrency: "USD", tokenAmountBaseUnits: "1284000000", tokenDecimals: 6,
      indicativeValue: { atoms: "1284", scale: 0 }, valuationStatus: "priced",
    }],
    total: {
      label: "supported-portfolio-value", status: "all-supported-read-holdings-priced",
      value: { atoms: "428032", scale: 2 }, currency: "USD", unpricedAssetKeys: [], unavailableAssetKeys: [],
    },
  };
}

function portfolio() {
  return {
    walletAddress: OWNER, chainId: 8453, blockNumber: "35123456",
    blockHash: `0x${"cd".repeat(32)}`, blockTimestamp: String(Math.floor(Date.now() / 1000)), fetchedAt: now(),
    assets: [
      { id: "usdc", symbol: "USDC", decimals: 6, kind: "erc20", tokenAddress: USDC, balanceBaseUnits: "1284000000" },
      { id: "eth", symbol: "ETH", decimals: 18, kind: "native", balanceBaseUnits: "850000000000000000" },
    ],
  };
}

function vaultCandidate(vaultAddress: string, name: string, netApy: number) {
  const fetchedAt = now();
  return {
    version: "v1", vaultAddress, name, symbol: "USDC vault", listed: true, chainId: 8453,
    asset: { address: USDC, symbol: "USDC", decimals: 6 }, curatorAddress: null,
    grossApy: netApy + 0.005, netApy, feeRate: 0.1, totalAssetsRaw: "1250000000000",
    liquidityRaw: "640000000000", stateAsOf: fetchedAt, blockNumber: "35123456",
    source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt },
  };
}

function savingsVaults() {
  const fetchedAt = now();
  return {
    version: "v1", chainId: 8453, asset: { address: USDC, symbol: "USDC", decimals: 6 },
    candidates: [
      vaultCandidate(VAULTS[0]!, "Steakhouse USDC", 0.0385),
      vaultCandidate(VAULTS[1]!, "Gauntlet USDC Prime", 0.041),
      vaultCandidate(VAULTS[2]!, "Re7 USDC", 0.0362),
    ],
    source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaults", fetchedAt },
    stale: false,
  };
}

function savingsPositions() {
  return {
    accountAddress: OWNER, fetchedAt: now(),
    vaults: VAULTS.map((vaultAddress, index) => ({
      vaultAddress,
      position: index === 1 ? {
        version: "v1", accountAddress: OWNER, vaultAddress,
        assetsRaw: "320000000", sharesRaw: "312000000000000000000", indexedAt: now(),
        source: { provider: "Morpho GraphQL", endpoint: "https://api.morpho.org/graphql", query: "vaultPosition", fetchedAt: now() },
        withdrawableRaw: null, withdrawableNote: "No maxWithdraw query was made.",
      } : null,
    })),
  };
}

function marketPrices() {
  const asOf = now();
  const snapshot = (assetId: string, displayPrice: string, changeLabel: string) => ({
    assetId, displayPrice, changeLabel, asOf, sourceLabel: "README sample fixture",
  });
  return {
    version: 1, provider: "codex", fetchedAt: asOf,
    markets: {
      stock: { status: "ready", snapshots: [
        snapshot("nvdac", "$184.32", "+1.8%"), snapshot("metac", "$782.14", "+0.7%"),
        snapshot("aaplc", "$246.91", "−0.4%"), snapshot("googlc", "$238.05", "+1.1%"),
      ] },
      crypto: { status: "ready", snapshots: [
        snapshot("cbbtc", "$112,480", "+2.4%"), snapshot("cbxrp", "$3.18", "+1.6%"),
        snapshot("cbdoge", "$0.31", "−0.8%"), snapshot("cbltc", "$124.72", "+0.5%"),
      ] },
      meme: { status: "ready", snapshots: [] },
    },
  };
}

function investDiscover() {
  const asOf = now();
  const address = "0x1111111111111111111111111111111111111112";
  const id = `base:${address}`;
  return {
    version: 1, provider: "codex", fetchedAt: asOf, icons: {},
    memes: {
      status: "ready",
      assets: [{
        id, category: "meme", displayName: "Higher", displaySymbol: "HIGHER", initials: "HI",
        chainId: 8453, contractAddress: address, availability: "informational", descriptor: "Trending on Base",
        representation: { tokenSymbol: "HIGHER", decimals: 18, relationship: "Base ERC-20 token." },
        contractUrl: `https://basescan.org/token/${address}`,
      }],
      snapshots: [{ assetId: id, displayPrice: "$0.0142", changeLabel: "+8.6%", asOf, sourceLabel: "README sample fixture" }],
      nextOffset: null, exhausted: true,
    },
  };
}

function borrowSnapshot() {
  const blockTimestamp = String(Date.parse("2026-09-12T16:00:00.000Z") / 1_000);
  return {
    chainId: 8453, walletAddress: OWNER,
    market: {
      id: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836", morpho: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
      loanToken: { id: "usdc", symbol: "USDC", decimals: 6, address: USDC },
      collateralToken: { id: "cbbtc", symbol: "cbBTC", decimals: 8, address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
      oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9",
      irm: "0x46415998764C29aB2a25CbeA6254146D50D22687", lltvWad: "860000000000000000",
    },
    source: { provider: "README sample fixture", blockNumber: "35123456", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp, fetchedAt: now() },
    state: {
      oraclePriceRaw: "800000000000000000000000000000000000000", borrowRatePerSecondWad: "1000000000",
      borrowAprWad: "31536000000000000", totalSupplyAssetsRaw: "120000000000", totalBorrowAssetsRaw: "64000000000",
      totalBorrowSharesRaw: "64000000000", liquidityAssetsRaw: "56000000000", lastUpdateTimestamp: blockTimestamp,
    },
    wallet: { collateralBalanceRaw: "2000000", loanBalanceRaw: "2750000000", collateralAllowanceRaw: "0", loanAllowanceRaw: "0" },
    position: {
      collateralRaw: "1500000", borrowSharesRaw: "500000000", debtAssetsRaw: "500000000",
      borrowCapacityAssetsRaw: "900000000", withdrawableCollateralRaw: "700000", healthFactorWad: "2400000000000000000",
      liquidationPriceRaw: "333333333333333333333333333333333333333",
    },
  };
}

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

const unexpectedRequests: string[] = [];
let basenameResolverFixtureCount = 0;

async function installFixtures(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;

    if (
      requestUrl.origin === "https://api.ensideas.com" &&
      path === `/ens/resolve/${OWNER}`
    ) {
      basenameResolverFixtureCount += 1;
      return json(route, { name: null, avatar: null });
    }

    if (requestUrl.origin !== BASE_URL) {
      unexpectedRequests.push(`external ${route.request().method()} ${requestUrl.href}`);
      await route.abort("blockedbyclient");
      return;
    }

    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }

    if (path === "/api/session") return json(route, { user: { subject: "readme-sample-subject" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" });
    if (path === "/api/portfolio/valuation") return json(route, valuation());
    if (path === "/api/portfolio") return json(route, portfolio());
    if (path === "/api/activity") {
      const to = requestUrl.searchParams.get("to") ?? now();
      const from = new Date(Date.parse(to) - 31 * 24 * 60 * 60 * 1_000).toISOString();
      return json(route, {
        walletAddress: OWNER, chainId: 8453, recordedOperations: "available",
        window: { from, to }, transfers: [], nextCursor: null,
        source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
      });
    }
    if (path === "/api/savings/vaults") return json(route, savingsVaults());
    if (path === "/api/savings/positions") return json(route, savingsPositions());
    if (path === "/api/market-prices") return json(route, marketPrices());
    if (path === "/api/invest/discover") return json(route, investDiscover());
    if (path === "/api/borrow") return json(route, borrowSnapshot());
    if (path === "/api/actions/operations") {
      const scope = requestUrl.searchParams.get("scope");
      return json(route, scope === "unresolved-send"
        ? { scope: "unresolved-send", operations: [] }
        : { operations: [] });
    }

    unexpectedRequests.push(`local API ${route.request().method()} ${requestUrl.href}`);
    await route.abort("blockedbyclient");
  });

  await context.routeWebSocket(/.*/, async (webSocket) => {
    const requestUrl = new URL(webSocket.url());
    if (requestUrl.origin === LOCAL_WEBSOCKET_ORIGIN) {
      webSocket.connectToServer();
      return;
    }
    unexpectedRequests.push(`external websocket ${requestUrl.href}`);
    await webSocket.close({ code: 1008, reason: "README capture blocks external sockets" });
  });
}

async function assertNoLocalEnvFiles() {
  const forbidden: string[] = [];
  for (const directory of [REPO_ROOT, join(REPO_ROOT, "apps/web")]) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".env") && entry.name !== ".env.example") {
        forbidden.push(join(directory, entry.name));
      }
    }
  }
  if (forbidden.length > 0) {
    throw new Error(
      `Refusing to capture with local environment files present:\n${forbidden.join("\n")}`,
    );
  }
}

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/?account=signin`);
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL(/\/dashboard/);
}

async function capture(page: Page, name: string) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.mouse.move(-10, -10);
  await page.screenshot({ path: join(OUTPUT_DIR, name), animations: "disabled" });
}

await assertNoLocalEnvFiles();
await mkdir(OUTPUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: "no-preference",
  colorScheme: "light",
  serviceWorkers: "block",
});
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem("home.country.v1", "US"));
await installFixtures(context);

try {
  await signIn(page);

  await page.goto(`${BASE_URL}/dashboard`);
  await page.getByText("$4,280.32", { exact: true }).waitFor();
  await page.getByText("$2,676.32", { exact: true }).waitFor();
  await page.waitForTimeout(1_000);
  await capture(page, "home.png");

  await page.goto(`${BASE_URL}/dashboard?panel=save`);
  await page.getByText("$320.00", { exact: true }).first().waitFor();
  await page.getByText("Gauntlet USDC Prime", { exact: true }).first().waitFor();
  await capture(page, "save.png");

  await page.goto(`${BASE_URL}/dashboard?panel=invest`);
  await page.getByRole("heading", { name: "Stocks" }).waitFor();
  await page.getByText("$184.32", { exact: true }).waitFor();
  await capture(page, "invest.png");

  await page.goto(`${BASE_URL}/borrow`);
  await page.getByRole("heading", { name: "Wallet and position" }).waitFor();
  await page.getByText("0.015 cbBTC", { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, "borrow.png");

  await page.goto(`${BASE_URL}/dashboard`);
  await page.getByText("$4,280.32", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("dialog", { name: "Send" }).waitFor();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).waitFor();
  await capture(page, "send.png");

  if (basenameResolverFixtureCount === 0) {
    throw new Error("The expected Basename resolver request was not observed.");
  }
  if (unexpectedRequests.length > 0) {
    throw new Error(`Unexpected browser requests were blocked:\n${unexpectedRequests.join("\n")}`);
  }
} finally {
  await browser.close();
}

console.log(
  `Captured README screenshots from ${BASE_URL} into ${OUTPUT_DIR}; ` +
  `fulfilled ${basenameResolverFixtureCount} Basename resolver request(s); ` +
  "observed 0 unexpected browser requests.",
);
