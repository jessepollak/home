// Capture the current UI against the same sample-only account boundary used by
// apps/web/tests/browser/fixtures/api.ts. Browser API requests are locally fulfilled,
// while unexpected non-local requests are aborted and reported.
import { chromium, type BrowserContext, type Page, type Route } from "@playwright/test";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedMarketPriceHistorySource } from "../../apps/web/shared/invest/contracts/market-price-history";
import { stockAssets } from "../../apps/web/config/invest-assets";
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
import { ACTIVITY_CONTRACT_VERSION } from "../../apps/web/shared/activity/contract";
import { appearancePreferenceKey } from "../../apps/web/shared/appearance/preference";
import { COUNTRY_PREFERENCE_VERSION } from "../../apps/web/shared/account/contracts/country-preference";
import { borrowOverviewBody, tradeAvailabilityBody } from "../../apps/web/tests/browser/fixtures/bodies";
import { cashoutFixtureAction } from "../../apps/web/tests/browser/feature-map/cashout-fixture";
import type { BorrowOverviewOpportunity, BorrowOverviewResponse } from "../../apps/web/shared/borrowing/contract";
import { BORROW_HEALTH_FLOOR_WAD } from "../../apps/web/shared/borrowing/config";
import {
  borrowCapacityAssets,
  healthFactorWad,
  liquidationPriceRaw,
  minimumCollateralForHealthFactor,
  parseTokenAmount,
  policyMaximumDebtAssets,
} from "../../apps/web/shared/morpho-markets/math";

const captureUrl = new URL(process.env.HOME_CAPTURE_BASE_URL ?? `http://localhost:${process.env.HOME_FIXTURE_PORT || "3199"}`);
if (captureUrl.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(captureUrl.hostname)) {
  throw new Error("HOME_CAPTURE_BASE_URL must be a local HTTP origin.");
}
const BASE_URL = captureUrl.origin;
const LOCAL_WEBSOCKET_ORIGIN = BASE_URL.replace(/^http:/, "ws:");
const OUTPUT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(OUTPUT_DIR, "../..");
const OWNER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2211d1d0020daea8039e46cf1367962070d77da9";
const RECIPIENT_NAME = "example.base.eth";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const PAYMASTER = "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c";
const SEND_ACTION_ID = "22222222-2222-4222-8222-222222222222";
const SEND_BASE_UNITS = BigInt(25_000_000);
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
    ? { ...priced(currency, atoms), asOf: now() }
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
      cbbtc: {
        balance: ready("1200000"),
        value: quoteValue("134976"),
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
    }, "25000000000000000000000", quoteValue("35500"))],
    total: currency
      ? { status: "complete", value: decimal("598508", 2), currency }
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
      vaultCandidate(VAULTS[0]!, "Gauntlet USDC Prime", 0.0385),
      vaultCandidate(VAULTS[1]!, "Spark USDC Vault", 0.041),
      vaultCandidate(VAULTS[2]!, "Steakhouse USDC", 0.0362),
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
        snapshot("amznc", "$231.44", "+0.9%"), snapshot("msftc", "$512.40", "+0.3%"),
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

const HISTORY_PRICES: Record<string, number> = { cbbtc: 112_480, nvdac: 184.32, metac: 782.14, aaplc: 246.91 };
const HISTORY_SPANS_MS: Record<string, number> = {
  "1D": 86_400_000, "1W": 7 * 86_400_000, "1M": 30 * 86_400_000, "3M": 91 * 86_400_000, "1Y": 365 * 86_400_000,
};

function priceHistory(assetId: string, range: string) {
  const fetchedAt = now();
  const end = Date.parse(fetchedAt);
  const span = HISTORY_SPANS_MS[range] ?? HISTORY_SPANS_MS["1W"]!;
  const last = HISTORY_PRICES[assetId] ?? 100;
  const source = expectedMarketPriceHistorySource(assetId);
  const stock = source?.kind === "tokenized-equity-feed";
  const count = stock ? 32 : 60;
  let seed = Array.from(`${assetId}:${range}`).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7);
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 2 ** 32;
  };
  let walk = 0;
  const offsets = Array.from({ length: count }, (_, index) => {
    if (index > 0) walk += (random() - 0.42) * 0.006;
    return walk;
  });
  const finalOffset = offsets.at(-1)!;
  return {
    version: 2, provider: stock ? "chainlink" : "codex", source, assetId, range, currency: "USD", fetchedAt, status: "ready",
    ...(stock ? { coverage: { sampled: count, observed: count, gaps: [] } } : {}),
    points: offsets.map((offset, index) => ({
      time: new Date(end - span * (1 - index / (count - 1))).toISOString(),
      value: (last * (1 + offset - finalOffset)).toPrecision(8),
    })),
  };
}

function marketStats(assetId: string) {
  const stock = stockAssets.some((asset) => asset.id === assetId);
  return stock
    ? { version: 1, provider: "codex", assetId, currency: "USD", fetchedAt: now(), status: "unavailable", stats: {}, unavailableReason: "unsupported-asset" }
    : {
      version: 1, provider: "codex", assetId, currency: "USD", fetchedAt: now(), status: "ready",
      stats: { marketCapUsd: { atoms: "2238000000000", scale: 0 }, volume24hUsd: { atoms: "41600000000", scale: 0 } },
    };
}

const BORROW_WALLET_UNITS = ["0.012", "1200", "0.4", "5000", "2000"];
const BORROW_APR_WADS = ["48700000000000000", "50800000000000000", "44200000000000000", "68700000000000000", "51000000000000000"];
const BORROW_OPEN_INDEX = 2;
const BORROW_OPEN_DEBT = BigInt(1_250_000_000);

function borrowSample(): BorrowOverviewResponse {
  const base = borrowOverviewBody({ openMarketId: null });
  const opportunities = base.opportunities.map((entry, index): BorrowOverviewOpportunity => {
    if (entry.availability.status !== "available") return entry;
    const snapshot = entry.availability.snapshot;
    const price = BigInt(snapshot.state.oraclePriceRaw);
    const lltv = BigInt(snapshot.market.lltvWad);
    const state = {
      ...snapshot.state, borrowAprWad: BORROW_APR_WADS[index]!,
      totalSupplyAssetsRaw: "120000000000000", totalBorrowAssetsRaw: "70000000000000",
      totalBorrowSharesRaw: "70000000000000", liquidityAssetsRaw: "50000000000000",
    };
    const wallet = { ...snapshot.wallet, collateralBalanceRaw: parseTokenAmount(BORROW_WALLET_UNITS[index]!, snapshot.market.collateralToken.decimals).toString() };
    let position = snapshot.position;
    if (index === BORROW_OPEN_INDEX) {
      const collateral = minimumCollateralForHealthFactor(BORROW_OPEN_DEBT, price, lltv, BigInt("2100000000000000000"));
      const rawCapacity = borrowCapacityAssets(collateral, price, lltv);
      const policyCapacity = policyMaximumDebtAssets(rawCapacity, BORROW_HEALTH_FLOOR_WAD);
      const floorCollateral = minimumCollateralForHealthFactor(BORROW_OPEN_DEBT, price, lltv, BORROW_HEALTH_FLOOR_WAD);
      const rawFloorCollateral = minimumCollateralForHealthFactor(BORROW_OPEN_DEBT, price, lltv, BigInt("1000000000000000000"));
      const positive = (value: bigint) => (value > BigInt(0) ? value : BigInt(0)).toString();
      position = {
        collateralRaw: collateral.toString(), borrowSharesRaw: BORROW_OPEN_DEBT.toString(), debtAssetsRaw: BORROW_OPEN_DEBT.toString(),
        rawBorrowCapacityAssetsRaw: positive(rawCapacity - BORROW_OPEN_DEBT),
        borrowCapacityAssetsRaw: positive(policyCapacity - BORROW_OPEN_DEBT),
        rawWithdrawableCollateralRaw: positive(collateral - rawFloorCollateral),
        withdrawableCollateralRaw: positive(collateral - floorCollateral),
        healthFactorWad: healthFactorWad(rawCapacity, BORROW_OPEN_DEBT)!.toString(),
        liquidationPriceRaw: liquidationPriceRaw(BORROW_OPEN_DEBT, collateral, lltv)!.toString(),
      };
    }
    return { ...entry, availability: { ...entry.availability, snapshot: { ...snapshot, state, wallet, position } } };
  });
  const positions = opportunities.flatMap((entry) => entry.availability.status === "available" && BigInt(entry.availability.snapshot.position.debtAssetsRaw) > BigInt(0)
    ? [{
      market: entry.market, source: entry.availability.source,
      collateralRaw: entry.availability.snapshot.position.collateralRaw,
      borrowSharesRaw: entry.availability.snapshot.position.borrowSharesRaw,
      debtAssetsRaw: entry.availability.snapshot.position.debtAssetsRaw,
      healthFactorWad: entry.availability.snapshot.position.healthFactorWad,
    }]
    : []);
  return { ...base, opportunities, positions };
}

function preparedSendAction() {
  const createdAt = now();
  const expiresAt = new Date(Date.parse(createdAt) + 10 * 60_000).toISOString();
  const approve = `0x095ea7b3${PAYMASTER.slice(2).toLowerCase().padStart(64, "0")}${BigInt(20_000).toString(16).padStart(64, "0")}`;
  const transfer = `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${SEND_BASE_UNITS.toString(16).padStart(64, "0")}`;
  return {
    id: SEND_ACTION_ID,
    owner: { subject: "readme-sample-subject", address: OWNER, chainId: 8453, accountProvider: "cdp-embedded" },
    kind: "send",
    title: "Send USDC",
    networkFee: { payment: "usdc", token: USDC, paymaster: PAYMASTER, maxFeeBaseUnits: "20000", decimals: 6 },
    calls: [{ to: USDC, data: approve, value: "0" }, { to: USDC, data: transfer, value: "0" }],
    amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: SEND_BASE_UNITS.toString(), direction: "spend" }],
    warnings: [`Recipient: ${RECIPIENT}`],
    createdAt,
    expiresAt,
  };
}

function activityTransfer(
  to: string,
  id: string,
  minutesAgo: number,
  direction: "incoming" | "outgoing",
  amountBaseUnits: string,
  counterparty: string,
  currency: string,
) {
  const dollars = BigInt(amountBaseUnits) * BigInt(10) ** BigInt(12);
  return {
    id: `8453:${USDC}:${id}`, logId: id, chainId: 8453,
    assetId: "usdc", tokenAddress: USDC, tokenSymbol: "USDC", tokenDecimals: 6,
    walletAddress: OWNER,
    fromAddress: direction === "incoming" ? counterparty : OWNER,
    toAddress: direction === "incoming" ? OWNER : counterparty,
    direction, amountBaseUnits,
    blockNumber: String(35_123_456 - minutesAgo), blockHash: `0x${"ef".repeat(32)}`,
    transactionHash: `0x${String(minutesAgo).padStart(64, "0")}`, logIndex: "1",
    blockTimestamp: new Date(Date.parse(to) - minutesAgo * 60_000).toISOString(),
    valuation: currency === "USD"
      ? { status: "priced", currency, amount: { atoms: dollars.toString(), scale: 18 }, method: "peg", peg: "USD", close: null, fx: null }
      : { status: "unpriced", currency, reason: "fx-unavailable" },
  };
}

function activityOrders() {
  const createdAt = new Date(Date.now() - 42 * 60_000).toISOString();
  const updatedAt = new Date(Date.now() - 38 * 60_000).toISOString();
  return {
    version: 1, owner: { subject: "readme-sample-subject", accountProvider: "cdp-embedded" },
    orders: [{
      kind: "funding", id: "readme-funding-received", status: "confirmed", stage: "received",
      region: "US", providerId: "coinbase", providerName: "Coinbase", paymentMethodLabel: "Debit card",
      instruction: null, resumable: false, fiatAmount: "200.00", fiatCurrency: "USD",
      asset: { id: "usdc", symbol: "USDC", decimals: 6 }, tokenAmountAtomic: "200000000", sandbox: false,
      expiresAt: null, clearableAt: null, transactionHash: null, logIndex: null, createdAt, updatedAt,
    }, {
      kind: "cash-out", id: cashoutFixtureAction.id, orderId: "fixture-escrow-1",
      region: "US", providerId: "peer", providerName: "Peer", platform: "cashapp", platformLabel: "Cash App",
      status: "waiting-provider", state: "awaiting-buyer", decimals: 6, amountAtomic: "50000000", filledAtomic: "0",
      returnedAtomic: "0", remainingAtomic: "50000000", withdrawable: true, settledAt: null,
      createdAt: new Date(Date.now() - 12 * 60_000).toISOString(), updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    }],
  };
}

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

const unexpectedRequests: string[] = [];
let basenameResolverFixtureCount = 0;
let blockedSpeedInsightsLoaderCount = 0;
const borrowOverview = borrowSample();
const sendAction = preparedSendAction();
const FORBIDDEN_WRITE = /^\/api\/(actions\/[^/]+\/(confirm|handle|decline|retry|paymaster)|funding\/orders|trades$)/;

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

    if (requestUrl.origin === "https://va.vercel-scripts.com" && path.startsWith("/v1/speed-insights/")) {
      blockedSpeedInsightsLoaderCount += 1;
      await route.abort("blockedbyclient");
      return;
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

    if (FORBIDDEN_WRITE.test(path) && route.request().method() !== "GET") {
      unexpectedRequests.push(`forbidden write ${route.request().method()} ${requestUrl.href}`);
      await route.abort("blockedbyclient");
      return;
    }

    if (path === "/api/session") return json(route, { user: { subject: "readme-sample-subject" }, smartAccount: { address: OWNER, chainId: 8453 }, accountProvider: "cdp-embedded" });
    if (path === "/api/account/country-preference" && route.request().method() === "GET") {
      return json(route, { version: COUNTRY_PREFERENCE_VERSION, regionId: "US" });
    }
    if (path === "/api/client-performance" && route.request().method() === "POST") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === "/api/funding/providers") return json(route, { providers: [] });
    if (path === "/api/balances") return json(route, balances(requestUrl.searchParams.get("region")));
    if (path === "/api/activity") {
      const to = requestUrl.searchParams.get("to") ?? now();
      const from = new Date(Date.parse(to) - 31 * 24 * 60 * 60 * 1_000).toISOString();
      const currency = requestUrl.searchParams.get("currency") ?? "USD";
      return json(route, {
        version: ACTIVITY_CONTRACT_VERSION,
        walletAddress: OWNER, chainId: 8453, recordedOperations: "available",
        window: { from, to }, currency,
        transfers: [
          activityTransfer(to, "readme-received", 55, "incoming", "25000000", "0x2222222222222222222222222222222222222222", currency),
          activityTransfer(to, "readme-sent", 3 * 60 + 20, "outgoing", "18500000", RECIPIENT, currency),
          activityTransfer(to, "readme-received-2", 26 * 60, "incoming", "120000000", "0x3333333333333333333333333333333333333333", currency),
          activityTransfer(to, "readme-sent-2", 2 * 24 * 60 + 90, "outgoing", "42000000", RECIPIENT, currency),
        ],
        nextCursor: null,
        source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
      });
    }
    if (path === "/api/activity/orders") return json(route, activityOrders());
    if (path === "/api/savings/vaults") return json(route, savingsVaults());
    if (path === "/api/market-prices") return json(route, marketPrices());
    if (path === "/api/market-prices/history") {
      return json(route, priceHistory(requestUrl.searchParams.get("assetId") ?? "", requestUrl.searchParams.get("range") ?? "1W"));
    }
    if (path === "/api/market-prices/stats") return json(route, marketStats(requestUrl.searchParams.get("assetId") ?? ""));
    if (path === "/api/invest/discover") return json(route, investDiscover());
    if (path === "/api/trades" && route.request().method() === "GET") {
      return json(route, tradeAvailabilityBody(requestUrl.searchParams.get("assetId") ?? ""));
    }
    if (path === "/api/trades/stock-eligibility") return json(route, { version: 1, buy: "eligible", sell: "eligible" });
    if (path === "/api/borrow") return json(route, borrowOverview);
    if (path.startsWith("/api/borrow/markets/")) {
      const marketId = path.slice("/api/borrow/markets/".length).toLowerCase();
      const entry = borrowOverview.opportunities.find((candidate) => candidate.market.id.toLowerCase() === marketId);
      if (entry?.availability.status === "available") return json(route, entry.availability.snapshot);
    }
    if (path === "/api/actions") return json(route, { actions: [cashoutFixtureAction] });
    if (path === "/api/actions/network-fee") return json(route, { version: 1, usdcReserveBaseUnits: "20000" });
    if (path === "/api/actions/prepare" && route.request().method() === "POST") return json(route, sendAction);
    if (path === `/api/actions/${SEND_ACTION_ID}` && route.request().method() === "GET") {
      return json(route, {
        id: sendAction.id, kind: sendAction.kind,
        summary: { title: sendAction.title, networkFee: sendAction.networkFee, amounts: sendAction.amounts, warnings: sendAction.warnings, expiresAt: sendAction.expiresAt },
        calls: sendAction.calls, expiresAt: sendAction.expiresAt,
      });
    }
    if (path === "/api/transfers/recent-recipients") return json(route, { version: 1, recipients: [{ address: RECIPIENT, name: RECIPIENT_NAME }] });
    if (path === "/api/transfers/recipient-name") return json(route, { version: 1, name: RECIPIENT_NAME, address: RECIPIENT });

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
await page.addInitScript(() => localStorage.setItem("home.country.v2", "US"));
await installFixtures(context);

try {
  await signIn(page);

  await page.goto(`${BASE_URL}/home`);
  await page.getByText("$5,985.08", { exact: true }).waitFor();
  await page.getByText("$4,381.08", { exact: true }).first().waitFor();
  await page.getByRole("region", { name: "Activity" }).getByText("Received", { exact: true }).first().waitFor({ state: "visible" });
  await page.waitForTimeout(1_000);
  await capture(page, "home.png");

  await page.goto(`${BASE_URL}/cash`);
  await page.getByRole("region", { name: "Cash" }).waitFor();
  await page.getByRole("region", { name: "Savings" }).getByRole("button", { name: /^US dollar/ }).waitFor();
  await page.getByText(/APY/).filter({ visible: true }).first().waitFor();
  await capture(page, "cash.png");

  await page.getByRole("region", { name: "Savings" }).getByRole("button", { name: /^US dollar/ }).click();
  await page.getByRole("heading", { name: "Your savings" }).waitFor();
  await page.getByRole("button", { name: /^Spark USDC Vault/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(1_000);
  await capture(page, "savings.png");

  await page.goto(`${BASE_URL}/invest`);
  await page.getByRole("heading", { name: "Stocks" }).waitFor();
  await page.getByText("$184.32", { exact: true }).waitFor();
  await capture(page, "invest.png");

  await page.getByRole("button", { name: /^Bitcoin/ }).first().click();
  await page.getByRole("heading", { name: "Bitcoin" }).first().waitFor();
  await page.waitForTimeout(2_000);
  await capture(page, "asset.png");

  await page.goto(`${BASE_URL}/activity`);
  await page.getByText("Cash out to Cash App").filter({ visible: true }).first().waitFor();
  await page.waitForTimeout(1_000);
  await capture(page, "activity.png");

  await page.goto(`${BASE_URL}/borrow`);
  await page.getByRole("heading", { name: "Open loans" }).waitFor();
  await page.getByText("$1,250.00").first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, "borrow.png");

  await page.goto(`${BASE_URL}/home`);
  await page.getByText("$5,985.08", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("dialog", { name: "Send" }).waitFor();
  await page.getByRole("combobox", { name: "Asset" }).click();
  await page.getByRole("option", { name: /US dollar|USDC/ }).first().click();
  await page.getByRole("textbox", { name: "Amount" }).pressSequentially("25");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "To" }).fill(RECIPIENT);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send $25.00" }).waitFor();
  await page.waitForTimeout(1_000);
  await capture(page, "send-review.png");

  await page.evaluate((key) => localStorage.setItem(key, "dark"), appearancePreferenceKey);
  await page.goto(`${BASE_URL}/home`);
  await page.getByText("$5,985.08", { exact: true }).waitFor();
  await page.getByRole("region", { name: "Activity" }).getByText("Received", { exact: true }).first().waitFor({ state: "visible" });
  await page.waitForTimeout(1_000);
  await capture(page, "home-dark.png");

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
  `blocked ${blockedSpeedInsightsLoaderCount} Speed Insights loader request(s); ` +
  "observed 0 unexpected browser requests.",
);
