// Capture the current UI against the same sample-only account boundary used by
// apps/web/tests/browser/smoke.pw.ts. Browser API requests are locally fulfilled,
// while unexpected non-local requests are aborted and reported.
import { chromium, type BrowserContext, type Page, type Route } from "@playwright/test";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { portfolioVaults } from "../../apps/web/config/portfolio-assets";
import { isRegionId, presentationRegions, type FiatCurrencyCode } from "../../apps/web/config/regions";
import {
  buildBalancesSnapshotFixture,
  catalogHolding,
  decimal,
  priced,
  pricedCash,
  ready,
} from "../../apps/web/shared/balances/fixtures";

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

function balances(regionValue: string | null) {
  const region = isRegionId(regionValue) ? regionValue : "US";
  const currency = presentationRegions[region].currency.code as FiatCurrencyCode | null;
  const quoteValue = (atoms: string) => currency
    ? priced(currency, atoms)
    : { status: "unpriced" as const, reason: "no-quote-currency" as const };

  return buildBalancesSnapshotFixture({
    region,
    owner: OWNER,
    fetchedAt: now(),
    registry: {
      usdc: {
        balance: ready("1284000000"),
        value: quoteValue("128400"),
        cashValue: pricedCash("USD", "128400"),
      },
      eth: {
        balance: ready("850000000000000000"),
        value: quoteValue("267632"),
      },
      [portfolioVaults[1].id]: {
        balance: ready("312000000000000000000"),
        underlyingBalance: ready("320000000"),
        value: quoteValue("32000"),
      },
    },
    catalog: [catalogHolding({
      address: "0x1111111111111111111111111111111111111112",
      name: "Higher",
      symbol: "HIGHER",
      decimals: 18,
    }, "12500000000000000000", {
      status: "unpriced",
      reason: currency ? "below-market-gate" : "no-quote-currency",
    })],
    total: currency
      ? { status: "complete", value: decimal("428032", 2), currency }
      : { status: "no-quote-currency", value: null, currency: null },
  });
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
    if (path === "/api/balances") return json(route, balances(requestUrl.searchParams.get("region")));
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
    if (path === "/api/market-prices") return json(route, marketPrices());
    if (path === "/api/invest/discover") return json(route, investDiscover());
    if (path === "/api/borrow") return json(route, borrowSnapshot());
    if (path === "/api/actions") return json(route, { actions: [] });

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
  await page.waitForURL(/\/home/);
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

  await page.goto(`${BASE_URL}/home`);
  await page.getByText("$4,280.32", { exact: true }).waitFor();
  await page.getByText("$2,676.32", { exact: true }).waitFor();
  await page.waitForTimeout(1_000);
  await capture(page, "home.png");

  await page.goto(`${BASE_URL}/save`);
  await page.getByText("$320.00", { exact: true }).first().waitFor();
  await page.getByText("Gauntlet USDC Prime", { exact: true }).first().waitFor();
  await capture(page, "save.png");

  await page.goto(`${BASE_URL}/invest`);
  await page.getByRole("heading", { name: "Stocks" }).waitFor();
  await page.getByText("$184.32", { exact: true }).waitFor();
  await capture(page, "invest.png");

  await page.goto(`${BASE_URL}/borrow`);
  await page.getByRole("heading", { name: "Wallet and position" }).waitFor();
  await page.getByText("0.015 cbBTC", { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, "borrow.png");

  await page.goto(`${BASE_URL}/home`);
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
