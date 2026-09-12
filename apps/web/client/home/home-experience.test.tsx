import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import type { AccountWalletSdkBoundary } from "@/client/account/cdp-client";
import type {
  BaseAccountConnector,
  ConnectedBaseAccount,
} from "@/client/account/base-account-connector";
import type {
  SessionFetch,
  VerifiedAccountSession,
} from "@/client/account/session-client";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { anonymousCountryPreferenceKey } from "@/config/country-preference";
import {
  investPortfolioAssets,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import { presentationRegions, type RegionId } from "@/config/regions";
import type { HomeAssetBalancesPresentation } from "@/client/portfolio";

const replaceCalls: string[] = [];
const pushCalls: string[] = [];
let backCalls = 0;
let autoPopRouterBack = true;
let autoCommitRouterPush = true;
let pendingRouterPush: string | null = null;

// History-aware App Router double. `push`/`replace` keep a real call ledger
// AND advance an in-test history stack, syncing `window.location` so the
// components under test read the URL they just navigated to. `back` pops the
// stack and emits a real `popstate`, so a broken `router.back` fails here.
let historyEntries: string[] = ["/"];
let historyCursor = 0;

function syncHistoryLocation(href: string) {
  window.history.replaceState({}, "", href);
}

function commitHistoryPush(href: string) {
  historyEntries = historyEntries.slice(0, historyCursor + 1);
  historyEntries.push(href);
  historyCursor = historyEntries.length - 1;
  syncHistoryLocation(href);
}

function pushHistory(href: string) {
  pushCalls.push(href);
  if (autoCommitRouterPush) {
    commitHistoryPush(href);
  } else {
    pendingRouterPush = href;
  }
}

function commitPendingRouterPush() {
  expect(pendingRouterPush).toBeTruthy();
  commitHistoryPush(pendingRouterPush as string);
  pendingRouterPush = null;
}

function replaceHistory(href: string) {
  replaceCalls.push(href);
  historyEntries[historyCursor] = href;
  syncHistoryLocation(href);
}

function popHistory() {
  if (historyCursor > 0) {
    historyCursor -= 1;
    syncHistoryLocation(historyEntries[historyCursor]);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function resetHistory() {
  replaceCalls.length = 0;
  pushCalls.length = 0;
  backCalls = 0;
  autoPopRouterBack = true;
  autoCommitRouterPush = true;
  pendingRouterPush = null;
  historyEntries = ["/"];
  historyCursor = 0;
  syncHistoryLocation("/");
}

mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => replaceHistory(href),
    push: (href: string) => pushHistory(href),
    back: () => {
      backCalls += 1;
      if (autoPopRouterBack) popHistory();
    },
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const {
  AccountWalletClientProvider,
  AccountWalletSessionOwner,
  CdpAccountProvider,
  createBlockedAccountWalletClient,
} = await import("@/client/account/cdp-client");
const { BASE_CHAIN_ID } = await import("@/client/account/session-client");
const {
  HomeExperience,
  PortfolioHomeExperience,
  clampHomeScrollTop,
  homeBalancesRestoreScope,
} = await import("./home-experience");
const {
  homeBalancesPresentationCachePrefix,
  readHomeBalancesPresentation,
  writeHomeBalancesPresentation,
} = await import("@/client/portfolio/presentation-cache");

const OWNER = "home-user";
const OWNER_B = "home-user-b";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";

function page() {
  return within(document.body);
}

async function enabledAccountButton() {
  return waitFor(() => {
    const button = page().getByRole("button", { name: "Account" });
    expect(button.hasAttribute("disabled")).toBe(false);
    return button;
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function sdk(
  overrides: Partial<AccountWalletSdkBoundary> = {},
): AccountWalletSdkBoundary {
  return {
    isInitialized: true,
    isSignedIn: false,
    ownerKey: null,
    signInWithEmail: async () => ({ flowId: "flow-1" }),
    verifyEmailOTP: async () => {},
    signInWithSiwe: async () => ({
      flowId: "siwe-flow-1",
      message: "fixture SIWE message",
    }),
    verifySiweSignature: async () => {},
    getAccessToken: async () => "fixture-token",
    signOut: async () => {},
    ...overrides,
  };
}

function session(
  smartAccount: VerifiedAccountSession["smartAccount"] = {
    address: ADDRESS,
    chainId: BASE_CHAIN_ID,
  },
  accountProvider: VerifiedAccountSession["accountProvider"] = "cdp-embedded",
  subject = "subject-home",
): VerifiedAccountSession {
  return {
    user: { subject },
    smartAccount,
    accountProvider,
  };
}

function portfolioSnapshot({
  address = ADDRESS,
  usdc = "0",
  eth = "0",
}: {
  address?: typeof ADDRESS | typeof ADDRESS_B;
  usdc?: string;
  eth?: string;
} = {}) {
  return {
    walletAddress: address,
    chainId: BASE_CHAIN_ID,
    blockNumber: "16",
    blockHash: `0x${"ab".repeat(32)}`,
    blockTimestamp: "100",
    fetchedAt: "2026-09-07T20:30:00.000Z",
    assets: [
      {
        id: "usdc",
        symbol: "USDC",
        decimals: 6,
        kind: "erc20",
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        balanceBaseUnits: usdc,
      },
      {
        id: "eth",
        symbol: "ETH",
        decimals: 18,
        kind: "native",
        balanceBaseUnits: eth,
      },
    ],
  };
}

function valuationSnapshot({
  region,
  address = ADDRESS,
  usdc = "0",
  eth = "0",
  idrx = "0",
  eurc = "0",
}: {
  region: RegionId;
  address?: typeof ADDRESS | typeof ADDRESS_B;
  usdc?: string;
  eth?: string;
  idrx?: string;
  eurc?: string;
}) {
  const currency = presentationRegions[region].currency.code;
  const usdcKey =
    "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const holdings = [
    {
      kind: "direct",
      id: "eth",
      assetKey: "eip155:8453/native",
      name: "Ethereum",
      symbol: "ETH",
      decimals: 18,
      assetKind: "native",
      contractAddress: null,
      cashCurrency: null,
      balanceBaseUnits: eth,
      readStatus: "ready",
    },
    {
      kind: "direct",
      id: "usdc",
      assetKey: usdcKey,
      name: "US dollar",
      symbol: "USDC",
      decimals: 6,
      assetKind: "erc20",
      contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      cashCurrency: "USD",
      balanceBaseUnits: usdc,
      readStatus: "ready",
    },
    {
      kind: "direct",
      id: verifiedLocalCashAssets.EUR.id,
      assetKey: verifiedLocalCashAssets.EUR.assetKey,
      name: verifiedLocalCashAssets.EUR.name,
      symbol: verifiedLocalCashAssets.EUR.symbol,
      decimals: verifiedLocalCashAssets.EUR.decimals,
      assetKind: "erc20",
      contractAddress: verifiedLocalCashAssets.EUR.contractAddress,
      cashCurrency: "EUR",
      balanceBaseUnits: eurc,
      readStatus: "ready",
    },
    {
      kind: "direct",
      id: verifiedLocalCashAssets.IDR.id,
      assetKey: verifiedLocalCashAssets.IDR.assetKey,
      name: verifiedLocalCashAssets.IDR.name,
      symbol: verifiedLocalCashAssets.IDR.symbol,
      decimals: verifiedLocalCashAssets.IDR.decimals,
      assetKind: "erc20",
      contractAddress: verifiedLocalCashAssets.IDR.contractAddress,
      cashCurrency: "IDR",
      balanceBaseUnits: idrx,
      readStatus: "ready",
    },
    ...[
      "0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61",
      "0x7bfa7c4f149e7415b73bdedfe609237e29cbf34a",
      "0xbeef010f9cb27031ad51e3333f9af9c6b1228183",
    ].map((vaultAddress, index) => ({
      kind: "vault-position",
      id: `vault-${index}`,
      assetKey: `eip155:8453/erc20:${vaultAddress}`,
      name: `Vault ${index}`,
      symbol: "USDC vault",
      vaultAddress,
      decimals: 18,
      underlyingAssetKey: usdcKey,
      underlyingSymbol: "USDC",
      underlyingDecimals: 6,
      sharesBaseUnits: "0",
      underlyingBaseUnits: "0",
      readStatus: "ready",
      conversionMethod: "erc4626-convertToAssets",
    })),
  ];
  const fetchedAt = "2026-09-08T12:00:00.000Z";
  const source = {
    provider: "Coinbase Exchange Rates",
    method: "fixture",
    fetchedAt,
    asOf: null,
    timeBasis: "retrieved-at",
  };
  const codexSource = {
    provider: "Codex",
    method: "fixture",
    fetchedAt,
    asOf: fetchedAt,
    timeBasis: "provider-as-of",
  };
  const nativeCashFixtures = [
    {
      assetKey: usdcKey,
      contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      currency: "USD",
      amount: usdc,
      decimals: 6,
      price: { atoms: "1", scale: 0 },
    },
    {
      assetKey: verifiedLocalCashAssets.EUR.assetKey,
      contractAddress: verifiedLocalCashAssets.EUR.contractAddress,
      symbol: verifiedLocalCashAssets.EUR.symbol,
      currency: "EUR",
      amount: eurc,
      decimals: verifiedLocalCashAssets.EUR.decimals,
      price: { atoms: "12", scale: 1 },
    },
    {
      assetKey: verifiedLocalCashAssets.IDR.assetKey,
      contractAddress: verifiedLocalCashAssets.IDR.contractAddress,
      symbol: verifiedLocalCashAssets.IDR.symbol,
      currency: "IDR",
      amount: idrx,
      decimals: verifiedLocalCashAssets.IDR.decimals,
      price: { atoms: "1", scale: 0 },
    },
  ] as const;
  const prices = nativeCashFixtures.map((asset) => ({
    assetKey: asset.assetKey,
    contractAddress: asset.contractAddress,
    quoteCurrency: "USD",
    unitPrice: asset.price,
    sourceValue:
      asset.price.scale === 0 ? asset.price.atoms : "1.2",
    status: "fresh",
    source: codexSource,
  }));
  const nativeCashValuations = nativeCashFixtures.map((asset) => {
    const scaleDelta = 18 - asset.decimals - asset.price.scale;
    const atoms = (
      BigInt(asset.amount) *
      BigInt(asset.price.atoms) *
      BigInt(10) ** BigInt(scaleDelta)
    ).toString();
    return {
      holdingAssetKey: asset.assetKey,
      denominationCurrency: asset.currency,
      value: { atoms, scale: 18 },
      status: "priced",
      reason: null,
      exactContractUsdPrice: prices.find(
        ({ assetKey }) => assetKey === asset.assetKey,
      ),
      denominationFx: {
        baseCurrency: "USD",
        quoteCurrency: asset.currency,
        quoteUnitsPerUsd: { atoms: "1", scale: 0 },
        sourceValue: "1",
        status: "fresh",
        source,
      },
    };
  });
  const cashBuckets = [
    {
      id: `cash:${usdcKey}`,
      roles:
        currency === "USD"
          ? ["canonical-usd", "selected-local"]
          : ["canonical-usd"],
      assetKey: usdcKey,
      symbol: "USDC",
      denominationCurrency: "USD",
      tokenAmountBaseUnits: usdc,
      tokenDecimals: 6,
      indicativeValue: nativeCashValuations[0]?.value ?? null,
      valuationStatus: "priced",
    },
  ];
  if (currency && currency !== "USD") {
    const selected = nativeCashFixtures.find(
      (asset) => asset.currency === currency,
    );
    if (selected) {
      cashBuckets.push({
        id: `cash:${selected.assetKey}`,
        roles: ["selected-local"],
        assetKey: selected.assetKey,
        symbol: selected.symbol,
        denominationCurrency: selected.currency,
        tokenAmountBaseUnits: selected.amount,
        tokenDecimals: selected.decimals,
        indicativeValue:
          nativeCashValuations.find(
            ({ holdingAssetKey }) => holdingAssetKey === selected.assetKey,
          )?.value ?? null,
        valuationStatus: "priced",
      } as never);
    } else {
      cashBuckets.push({
        id: `cash:unsupported:${currency}`,
        roles: ["selected-local"],
        assetKey: null,
        symbol: presentationRegions[region].candidateAsset?.symbol ?? currency,
        denominationCurrency: currency,
        tokenAmountBaseUnits: null,
        tokenDecimals: null,
        indicativeValue: null,
        valuationStatus: "unsupported",
      } as never);
    }
  }
  return {
    version: 2,
    walletAddress: address,
    chainId: 8453,
    selectedRegion: region,
    quoteCurrency: currency,
    block: { number: "16", hash: `0x${"ab".repeat(32)}`, timestamp: "100" },
    fetchedAt,
    inventory: {
      scope: "configured-base-assets-v1",
      walletDiscoveryComplete: false,
      holdings,
      omissions: [],
    },
    prices,
    fx: currency
      ? {
          baseCurrency: "USD",
          quoteCurrency: currency,
          quoteUnitsPerUsd: { atoms: "1", scale: 0 },
          sourceValue: "1",
          status: "fresh",
          source,
        }
      : null,
    nativeEthQuote: {
      baseCurrency: "USD",
      assetSymbol: "ETH",
      assetUnitsPerUsd: { atoms: "5", scale: 4 },
      sourceValue: "0.0005",
      status: "fresh",
      source,
    },
    lines: currency
      ? holdings.map((holding) => ({
          holdingAssetKey: holding.assetKey,
          valueCurrency: currency,
          value: { atoms: "0", scale: 18 },
          status: "priced",
          reason: null,
        }))
      : [],
    nativeCashValuations,
    cashBuckets,
    total: {
      label: "supported-portfolio-value",
      status: currency
        ? "all-supported-read-holdings-priced"
        : "unavailable-no-quote-currency",
      value: currency ? { atoms: usdc, scale: 6 } : null,
      currency,
      unpricedAssetKeys: [],
      unavailableAssetKeys: [],
    },
  };
}

function valuationResponse(
  input: RequestInfo | URL,
  options: {
    address?: typeof ADDRESS | typeof ADDRESS_B;
    usdc?: string;
    eth?: string;
    idrx?: string;
    eurc?: string;
  } = {},
) {
  const region = new URL(String(input), "http://localhost").searchParams.get(
    "region",
  );
  if (!region || !(region in presentationRegions)) {
    throw new Error("Valuation request is missing a region.");
  }
  return Response.json(
    valuationSnapshot({ region: region as RegionId, ...options }),
  );
}

function activityPage(
  input: RequestInfo | URL,
  walletAddress: typeof ADDRESS | typeof ADDRESS_B = ADDRESS,
) {
  const url = new URL(String(input), "http://localhost");
  const to = url.searchParams.get("to");
  if (!to) throw new Error("Activity request is missing its window end.");
  const toTime = new Date(to).getTime();
  return {
    walletAddress,
    chainId: BASE_CHAIN_ID,
    recordedOperations: "available",
    window: {
      from: new Date(toTime - 31 * 24 * 60 * 60 * 1000).toISOString(),
      to,
    },
    transfers: [],
    nextCursor: null,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: new Date(toTime - 1_000).toISOString(),
      executionTimeMs: 2,
      fetchedAt: to,
    },
  };
}

function connectedBaseAccount(): ConnectedBaseAccount {
  return {
    address: ADDRESS,
    assertUnchanged: async () => {},
    signMessage: async () => "0x1234",
    signTypedData: async () => `0x${"cd".repeat(65)}`,
    disconnect: async () => {},
  };
}

function seedBalancesCache({
  ownerKey = OWNER,
  subject = "subject-home",
  smartAccount = ADDRESS,
  region = "GLOBAL",
  displayTotal = "$12.34",
  totalStatus = "complete",
  statusLabel,
}: {
  ownerKey?: string;
  subject?: string;
  smartAccount?: `0x${string}`;
  region?: RegionId;
  displayTotal?: string;
  totalStatus?: NonNullable<HomeAssetBalancesPresentation["totalStatus"]>;
  statusLabel?: string;
} = {}) {
  writeHomeBalancesPresentation(
    () => window.localStorage,
    { ownerKey, subject, smartAccount, region },
    {
      status: "ready",
      displayTotal,
      totalStatus,
      ...(statusLabel ? { statusLabel } : {}),
      items: [
        {
          id: "usdc",
          group: "cash",
          name: "US dollar",
          displayBalance: displayTotal,
          currencyCode: "USD",
        },
      ],
    },
  );
}

function HomeHarness({
  accountSdk,
  sessionFetch = async () => Response.json(session()),
  initialAccountOpen = false,
  initialPanel,
  initialAccountSettingsOpen = false,
  detectedCountry = null,
  routeMode = "dashboard",
  savingsContent = <section aria-label="Savings module">Savings fixture</section>,
  investContent = <section aria-label="Invest module">Invest fixture</section>,
  assetBalances,
  assetMarkResolution,
}: {
  accountSdk: AccountWalletSdkBoundary;
  sessionFetch?: SessionFetch;
  initialAccountOpen?: boolean;
  initialPanel?: "home" | "invest" | "save" | "balances" | "activity";
  initialAccountSettingsOpen?: boolean;
  detectedCountry?: string | null;
  routeMode?: "landing" | "dashboard";
  savingsContent?: ReactNode;
  investContent?: ReactNode;
  assetBalances?: ComponentProps<typeof HomeExperience>["assetBalances"];
  assetMarkResolution?: ComponentProps<typeof HomeExperience>["assetMarkResolution"];
}) {
  return (
    <AccountWalletSessionOwner sdk={accountSdk} sessionFetch={sessionFetch}>
      <HomeExperience
        detectedCountry={detectedCountry}
        initialAccountOpen={initialAccountOpen}
        initialPanel={initialPanel}
        initialAccountSettingsOpen={initialAccountSettingsOpen}
        routeMode={routeMode}
        savingsContent={savingsContent}
        investContent={investContent}
        assetMarkResolution={assetMarkResolution}
        assetBalances={
          assetBalances ?? {
            status: "ready",
            displayTotal: "$12.34",
            totalStatus: "complete",
            items: [
              {
                id: "usdc",
                group: "cash",
                name: "US dollar",
                displayBalance: "$12.34",
                currencyCode: "USD",
              },
            ],
          }
        }
      />
    </AccountWalletSessionOwner>
  );
}

function PortfolioHomeHarness({
  accountSdk,
  sessionFetch,
  detectedCountry = null,
  baseAccountEnabled = false,
  baseAccountConnector,
  routeMode = "dashboard",
}: {
  accountSdk: AccountWalletSdkBoundary;
  sessionFetch: SessionFetch;
  detectedCountry?: string | null;
  baseAccountEnabled?: boolean;
  baseAccountConnector?: BaseAccountConnector;
  routeMode?: "landing" | "dashboard";
}) {
  return (
    <AccountWalletSessionOwner
      sdk={accountSdk}
      sessionFetch={sessionFetch}
      baseAccountEnabled={baseAccountEnabled}
      baseAccountConnector={baseAccountConnector}
    >
      <PortfolioHomeExperience detectedCountry={detectedCountry} routeMode={routeMode} />
    </AccountWalletSessionOwner>
  );
}

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: () => ({
    matches: true,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }),
});
HTMLElement.prototype.scrollIntoView = () => {};

type TestIntersectionEntry = { isIntersecting: boolean };
type TestIntersectionCallback = (
  entries: TestIntersectionEntry[],
  observer: unknown,
) => void;

const intersectionObserverInstances: TestIntersectionObserver[] = [];
let autoIntersectOnObserve = false;

class TestIntersectionObserver {
  connected = true;
  callback: TestIntersectionCallback;

  constructor(callback: TestIntersectionCallback) {
    this.callback = callback;
    intersectionObserverInstances.push(this);
  }

  observe() {
    if (autoIntersectOnObserve) {
      queueMicrotask(() => {
        if (this.connected) {
          this.callback([{ isIntersecting: true }], this);
        }
      });
    }
  }
  unobserve() {}
  disconnect() {
    this.connected = false;
  }

  trigger(entries: TestIntersectionEntry[] = [{ isIntersecting: true }]) {
    this.callback(entries, this);
  }
}

Object.defineProperty(window, "IntersectionObserver", {
  configurable: true,
  writable: true,
  value: TestIntersectionObserver,
});

function activeIntersectionObserver(): TestIntersectionObserver | undefined {
  return [...intersectionObserverInstances]
    .reverse()
    .find((observer) => observer.connected);
}

function revealNextBalancesBatch() {
  const observer = activeIntersectionObserver();
  expect(observer).toBeTruthy();
  act(() => {
    observer!.trigger();
  });
}

function stubInvestHistory() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/market-prices/history") {
      return Response.json({
        version: 1,
        provider: "codex",
        assetId: url.searchParams.get("assetId") ?? "",
        range: url.searchParams.get("range") ?? "1D",
        currency: "USD",
        fetchedAt: null,
        status: "empty",
        points: [],
      });
    }
    return original(input);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.body.style.overflow = "";
  resetHistory();
  intersectionObserverInstances.length = 0;
  autoIntersectOnObserve = false;
});

describe("login-state home experience", () => {
  test("renders Sign in and Create account as the same CDP email flow while signed out", async () => {
    render(<HomeHarness accountSdk={sdk()} routeMode="landing" />);

    await page().findByRole("heading", {
      name: "One home for your money.",
    });
    const main = page().getByRole("main");
    expect(within(main).queryByText("Wallet & savings value")).toBeNull();
    expect(within(main).queryByText("Assets")).toBeNull();
    expect(within(main).queryByText("Activity")).toBeNull();
    expect(page().queryByRole("navigation", { name: "Main navigation" })).toBeNull();
    expect(page().queryByRole("button", { name: "Add money" })).toBeNull();
    expect(page().queryByRole("button", { name: "Send" })).toBeNull();

    const createAccount = within(main).getByRole("button", {
      name: "Create account",
    });
    createAccount.focus();
    fireEvent.click(createAccount);

    const dialog = await page().findByRole("dialog", { name: "Sign in to Home" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(page().getByRole("textbox", { name: "Email address" })).toBeTruthy();
    expect(page().queryByText("Sign-in is not configured")).toBeNull();
    expect(pushCalls).toEqual(["/?account=signin"]);
  });

  test("hides Create account when CDP is unconfigured and Sign in explains setup", async () => {
    render(
      <CdpAccountProvider projectId={null}>
        <HomeExperience routeMode="landing" />
      </CdpAccountProvider>,
    );

    await page().findByRole("heading", {
      name: "One home for your money.",
    });
    const main = page().getByRole("main");
    expect(within(main).queryByRole("button", { name: "Create account" })).toBeNull();
    fireEvent.click(within(main).getByRole("button", { name: "Sign in" }));

    const dialog = await page().findByRole("dialog", { name: "Sign in to Home" });
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(page().getByText("Sign-in is not configured")).toBeTruthy();
    expect(page().getByRole("link", { name: "docs/cdp-setup.md" })).toBeTruthy();
    expect(page().queryByRole("textbox", { name: "Email address" })).toBeNull();
  });

  test("hides Create account when the configured sign-in provider is unavailable", async () => {
    render(
      <AccountWalletClientProvider
        client={createBlockedAccountWalletClient("provider-unavailable")}
      >
        <HomeExperience routeMode="landing" />
      </AccountWalletClientProvider>,
    );

    await page().findByRole("heading", {
      name: "One home for your money.",
    });
    const main = page().getByRole("main");
    expect(within(main).queryByRole("button", { name: "Create account" })).toBeNull();
    fireEvent.click(within(main).getByRole("button", { name: "Sign in" }));
    expect(await page().findByText("Sign-in is unavailable")).toBeTruthy();
    expect(page().queryByText("Sign-in is not configured")).toBeNull();
    expect(page().queryByRole("textbox", { name: "Email address" })).toBeNull();
  });

  test("keeps email OTP open and routes only after the current server-verified login", async () => {
    const signedOutSdk = sdk({
      signInWithEmail: async () => ({ flowId: "email-flow" }),
      verifyEmailOTP: async () => {},
    });
    const view = render(
      <HomeHarness
        accountSdk={signedOutSdk}
        sessionFetch={async () => Response.json(session())}
        routeMode="landing"
      />,
    );

    fireEvent.click(within(page().getByRole("main")).getByRole("button", { name: "Sign in" }));
    const email = await page().findByRole("textbox", { name: "Email address" });
    fireEvent.input(email, { target: { value: "fixture@example.test" } });
    fireEvent.click(page().getByRole("button", { name: "Continue with email" }), {
      detail: 0,
      clientX: 0,
      clientY: 0,
    });
    const otp = await page().findByRole("textbox", { name: "Verification code" });
    expect((page().getByRole("dialog") as HTMLDialogElement).open).toBe(true);
    fireEvent.input(otp, { target: { value: "123456" } });
    fireEvent.click(page().getByRole("button", { name: "Verify and continue" }));

    expect(replaceCalls).not.toContain("/dashboard");
    view.rerender(
      <HomeHarness
        accountSdk={{ ...signedOutSdk, isSignedIn: true, ownerKey: OWNER }}
        sessionFetch={async () => Response.json(session())}
        routeMode="landing"
      />,
    );
    await waitFor(() => expect(replaceCalls).toContain("/dashboard"));
  });

  test("shows the Home shell while session is checking, then the dense verified dashboard", async () => {
    const pendingSession = deferred<Response>();
    render(
      <HomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
        })}
        sessionFetch={() => pendingSession.promise}
      />,
    );

    const checkingAccount = page().getByRole("button", { name: "Account" });
    expect(checkingAccount).toBeTruthy();
    expect(checkingAccount.hasAttribute("disabled")).toBe(true);
    expect(page().queryByRole("button", { name: "Checking…" })).toBeNull();
    expect(page().queryByText("Checking…")).toBeNull();
    expect(page().queryByText("Checking your account…")).toBeNull();
    expect(page().getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Save" })).toBeTruthy();
    expect(page().getByText("Updating…")).toBeTruthy();
    expect(document.querySelector("[data-shimmer='hero']")).toBeTruthy();
    expect(document.querySelectorAll("[data-shimmer='row']").length).toBe(4);
    expect(document.querySelectorAll("[data-shimmer='mark']").length).toBe(4);
    expect(page().queryByText("$12.34")).toBeNull();
    expect(page().queryByText("—")).toBeNull();
    expect(page().queryByText("No balances yet")).toBeNull();
    expect(page().queryByText("No activity yet")).toBeNull();
    expect(document.body.textContent).not.toContain(ADDRESS);

    await act(async () => {
      pendingSession.resolve(Response.json(session()));
      await pendingSession.promise;
    });

    await enabledAccountButton();
    expect(page().queryByText("Wallet & savings value")).toBeNull();
    expect(page().queryByText("Wallet & savings")).toBeNull();
    expect(page().getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(page().getAllByText("$12.34").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(page().getByRole("button", { name: "Account" }));
    expect(page().getByTitle(ADDRESS).textContent).toBe("0x1111…111111");
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    fireEvent.click(page().getByRole("button", { name: "Add money" }));
    const addMoney = page().getByRole("dialog", { name: "Add money" });
    expect(addMoney).toBeTruthy();
    expect(addMoney.closest(".action-row")).toBeNull();
    expect(page().queryByText("Fund this Base account")).toBeNull();
    expect(page().getByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    expect(page().queryByRole("button", { name: /Use Coinbase/ })).toBeNull();
    expect(page().getByRole("button", { name: "Use another onramp" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: /Receive crypto/ }));
    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    expect(page().getByText("Receive on Base")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Copy address" })).toBeNull();
    expect(page().queryByRole("button", { name: "Check received" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Close add money" }));
    expect(page().queryByRole("button", { name: /Receive crypto/ })).toBeNull();
    expect(page().getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Send" }));
    const send = page().getByRole("dialog", { name: "Send" });
    expect(send).toBeTruthy();
    expect(send.closest(".action-row")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
    expect(page().queryByText("One home for your money.")).toBeNull();
  });

  test("paints last-known balances while Checking when the owner cache matches", async () => {
    seedBalancesCache();
    const pendingSession = deferred<Response>();
    render(
      <HomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
        })}
        sessionFetch={() => pendingSession.promise}
      />,
    );

    expect((await page().findAllByText("$12.34")).length).toBeGreaterThanOrEqual(1);
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(page().getByText("US dollar")).toBeTruthy();
    expect(page().getByText("Updating…")).toBeTruthy();
    expect(document.querySelector("[data-shimmer='hero']")).toBeNull();
    expect(document.querySelectorAll("[data-shimmer='row']").length).toBe(2);
    expect(page().queryByText("No activity yet")).toBeNull();
    expect(document.body.textContent).not.toContain(ADDRESS);
    expect(page().queryByRole("button", { name: "Checking…" })).toBeNull();

    await act(async () => {
      pendingSession.resolve(Response.json(session()));
      await pendingSession.promise;
    });
    await enabledAccountButton();
    expect(page().getAllByText("$12.34").length).toBeGreaterThanOrEqual(1);
  });

  test("keeps cached partial-total truth visible while the account revalidates", async () => {
    seedBalancesCache({
      totalStatus: "partial",
      statusLabel: "Unavailable",
    });
    const pendingSession = deferred<Response>();
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={() => pendingSession.promise}
      />,
    );

    const status = await page().findByText("Unavailable");
    expect(status.getAttribute("data-total-status")).toBe("partial");
    expect(page().getByText("US dollar")).toBeTruthy();
    expect(document.querySelector("[data-shimmer='hero']")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(page().getByText("Unavailable")).toBeTruthy();

    await act(async () => {
      pendingSession.resolve(Response.json(session()));
      await pendingSession.promise;
    });
  });

  test("does not paint another owner's or signed-out cache during Checking", async () => {
    seedBalancesCache({ ownerKey: OWNER_B, displayTotal: "$99.00" });
    const pendingSession = deferred<Response>();
    render(
      <HomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
        })}
        sessionFetch={() => pendingSession.promise}
      />,
    );

    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(document.querySelector("[data-shimmer='hero']")).toBeTruthy();
    expect(page().queryByText("$99.00")).toBeNull();
    expect(page().queryByText("$12.34")).toBeNull();

    await act(async () => {
      pendingSession.resolve(Response.json(session()));
      await pendingSession.promise;
    });
  });

  test("holds signed-out dashboard on a placeholder and redirects without portfolio chrome", async () => {
    render(<HomeHarness accountSdk={sdk()} routeMode="dashboard" />);

    expect(page().queryByText("$12.34")).toBeNull();
    expect(document.body.textContent).not.toContain(ADDRESS);
    expect(page().queryByText("One home for your money.")).toBeNull();

    await waitFor(() => expect(replaceCalls).toEqual(["/?account=signin"]));

    expect(page().queryByRole("heading", { name: "Balances" })).toBeNull();
    expect(page().queryByRole("button", { name: "Add money" })).toBeNull();
    expect(page().queryByRole("navigation", { name: "Main navigation" })).toBeNull();
    expect(page().queryByRole("heading", { name: "Activity" })).toBeNull();
    expect(page().queryByRole("button", { name: "Save" })).toBeNull();
    expect(page().queryByRole("button", { name: "Checking…" })).toBeNull();
    expect(page().getByText("Signed out")).toBeTruthy();
    expect(page().queryByText("Setup in progress")).toBeNull();
    expect(page().queryByText("$12.34")).toBeNull();
    expect(document.body.textContent).not.toContain(ADDRESS);
  });

  test("does not paint a leftover cache on the signed-out dashboard", async () => {
    seedBalancesCache();
    render(<HomeHarness accountSdk={sdk()} routeMode="dashboard" />);

    await waitFor(() => expect(replaceCalls).toEqual(["/?account=signin"]));
    expect(page().queryByText("$12.34")).toBeNull();
    expect(page().queryByRole("heading", { name: "Balances" })).toBeNull();
    expect(page().getByText("Signed out")).toBeTruthy();
  });

  test("writes a ready presentation through and wipes every balances cache key on sign-out", async () => {
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return Response.json(session());
      if (String(input).startsWith("/api/activity?")) {
        return Response.json(activityPage(input));
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        return valuationResponse(input, { usdc: "12340000" });
      }
      return Response.json(portfolioSnapshot({ usdc: "12340000" }));
    };
    window.localStorage.setItem("home.country.v1", "US");
    window.localStorage.setItem(`${homeBalancesPresentationCachePrefix}stale`, "{}");

    render(
      <PortfolioHomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={sessionFetch}
      />,
    );

    expect((await page().findAllByText("$12.34")).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => {
      expect(
        Object.keys(window.localStorage).some(
          (key) =>
            key.startsWith(homeBalancesPresentationCachePrefix) &&
            key !== `${homeBalancesPresentationCachePrefix}stale`,
        ),
      ).toBe(true);
    });

    fireEvent.click(await enabledAccountButton());
    fireEvent.click(page().getByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(
        Object.keys(window.localStorage).filter((key) =>
          key.startsWith(homeBalancesPresentationCachePrefix),
        ),
      ).toEqual([]),
    );
    expect(window.localStorage.getItem("home.country.v1")).toBe("US");
  });

  test("treats a verified session without a smart account as authenticated but not ready", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={async () => Response.json(session(null))}
      />,
    );

    fireEvent.click(await enabledAccountButton());
    expect(page().getByText("Setup in progress")).toBeTruthy();
    expect(page().queryByText("One home for your money.")).toBeNull();
  });

  test("clears private dashboard content immediately on failed sign-out and exposes manual retry", async () => {
    let signOutCalls = 0;
    render(
      <HomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
          signOut: async () => {
            signOutCalls += 1;
            if (signOutCalls === 1) throw new Error("fixture logout failed");
          },
        })}
      />,
    );

    fireEvent.click(await enabledAccountButton());
    expect(page().getByTitle(ADDRESS)).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(replaceCalls).toEqual(["/"]));
    expect(document.body.textContent).not.toContain("0x1111…111111");
    expect(page().queryByRole("heading", { name: "Balances" })).toBeNull();
    expect(page().queryByRole("button", { name: "Add money" })).toBeNull();
    expect(page().queryByRole("navigation", { name: "Main navigation" })).toBeNull();

    const retry = await page().findByRole("button", { name: "Retry sign out" });
    fireEvent.click(retry);
    await waitFor(() => expect(signOutCalls).toBe(2));
  });

  test("renders partial totals and unavailable or unpriced supported holdings on Home and Balances", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$12.34",
          totalStatus: "partial",
          statusLabel: "Unavailable",
          items: [
            {
              id: "usdc",
              group: "cash",
              name: "US dollar",
              displayBalance: "$12.34",
              currencyCode: "USD",
            },
            {
              id: "asset:eth",
              group: "asset",
              name: "Ethereum",
              detail: "ETH",
              displayBalance: "0.0500 ETH",
              displayContext: "Updating…",
            },
            {
              id: "asset:nvidia",
              group: "asset",
              name: "NVIDIA",
              detail: "NVDAC",
              displayBalance: "Unavailable",
              tone: "error",
            },
          ],
        }}
      />,
    );

    await enabledAccountButton();
    expect(
      document.querySelector(".balance-status")?.getAttribute("data-total-status"),
    ).toBe("partial");
    expect(page().getAllByText("Unavailable")).toHaveLength(2);
    expect(page().queryByText("0.0500 ETH")).toBeNull();
    expect(page().queryByText("Ethereum")).toBeNull();
    const updatingRow = document.querySelector("[data-shimmer='row']");
    expect(updatingRow).toBeTruthy();
    expect(updatingRow?.querySelector("[data-shimmer='mark']")).toBeTruthy();
    expect(
      updatingRow?.querySelector(".shimmer-identity .shimmer-line-wide"),
    ).toBeTruthy();
    expect(
      updatingRow?.querySelector(".shimmer-identity .shimmer-line-narrow"),
    ).toBeTruthy();
    expect(updatingRow?.querySelector(".shimmer-pill")).toBeTruthy();
    expect(page().getByText("Updating…").classList.contains("sr-status")).toBe(true);

    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(page().getAllByText("Unavailable")).toHaveLength(2);
    expect(page().queryByText("0.0500 ETH")).toBeNull();
    expect(page().queryByText("Ethereum")).toBeNull();
    expect(page().getByText("NVIDIA")).toBeTruthy();
    expect(document.querySelector("[data-shimmer='row']")).toBeTruthy();
  });

  test("never substitutes funded non-USD cash for unavailable USDC send availability", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "€2,234.56",
          totalStatus: "partial",
          statusLabel: "Unavailable",
          items: [
            {
              id: "cash:usd",
              group: "cash",
              name: "US dollar",
              displayBalance: "Unavailable",
              currencyCode: "USD",
              tone: "error",
            },
            {
              id: "cash:eur",
              group: "cash",
              name: "Euro",
              displayBalance: "€1,234.56",
              currencyCode: "EUR",
            },
            {
              id: "cash:idr",
              group: "cash",
              name: "Indonesian rupiah",
              displayBalance: "Rp 1,000.00",
              currencyCode: "IDR",
            },
          ],
        }}
      />,
    );

    await enabledAccountButton();
    expect(page().getByText("€1,234.56")).toBeTruthy();
    expect(page().getByText("Rp 1,000.00")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Send" }));

    const send = page().getByRole("dialog", { name: "Send" });
    expect(within(send).queryByText("1,234.56 USDC available")).toBeNull();
    expect(within(send).queryByText("1,000.00 USDC available")).toBeNull();
    expect(
      (within(send).getByRole("button", { name: "Max" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test("renders the GLOBAL no-currency action on Home and Balances", async () => {
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return Response.json(session());
      if (String(input).startsWith("/api/activity?")) {
        return Response.json(activityPage(input));
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        return valuationResponse(input, { usdc: "12340000" });
      }
      return Response.json(portfolioSnapshot({ usdc: "12340000" }));
    };

    render(
      <PortfolioHomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={sessionFetch}
      />,
    );

    const label = await page().findByText(
      "Choose a country in Account to set how money is shown",
    );
    expect(label.getAttribute("data-total-status")).toBe("unavailable");
    expect(page().getByText("—")).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(
      page().getByText("Choose a country in Account to set how money is shown"),
    ).toBeTruthy();
  });

  test("renders an unavailable verified-session state without calling it empty", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "unavailable",
          displayTotal: null,
          totalStatus: "unavailable",
          statusLabel: "Balance unavailable",
          items: [],
        }}
      />,
    );

    await enabledAccountButton();
    expect(page().getByText("Balance unavailable")).toBeTruthy();
    expect(page().queryByText("No balances yet")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(page().getByText("Balance unavailable")).toBeTruthy();
    expect(page().queryByText("No balances yet")).toBeNull();
  });

  test("wires verified balances through the production owner with bounded token display and no unpriced ETH sum", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const sessionFetch: SessionFetch = async (input, init) => {
      requests.push({ input, init });
      if (input === "/api/session") {
        return Response.json(session());
      }
      if (String(input).startsWith("/api/activity?")) {
        return Response.json(activityPage(input));
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        return valuationResponse(input, {
          usdc: "0",
          eth: "50000000000000000",
          idrx: "10000",
        });
      }
      return Response.json(portfolioSnapshot({ usdc: "0", eth: "50000000000000000" }));
    };

    render(
      <PortfolioHomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={sessionFetch}
        detectedCountry="BR"
      />,
    );

    await page().findByText("US dollar");
    expect(page().queryByText("Wallet & savings value")).toBeNull();
    expect(page().queryByText("Wallet and savings only · Borrow separate")).toBeNull();
    expect(page().getByText("US dollar")).toBeTruthy();
    expect(page().getByText("Brazilian real")).toBeTruthy();
    expect(page().getByText("Ethereum")).toBeTruthy();
    expect(page().getByText("0.0500 ETH")).toBeTruthy();
    expect(page().getByText("Indonesian rupiah")).toBeTruthy();
    expect(page().getByText("Rp 100.00")).toBeTruthy();
    const ethRow = page().getByText("Ethereum").closest("li");
    const ethMark = ethRow?.querySelector("[data-mark='eth']");
    expect(ethMark).toBeTruthy();
    expect(ethMark?.querySelector("svg")).toBeTruthy();
    expect(ethMark?.textContent).toBe("");
    expect(ethRow?.querySelector("img")).toBeNull();
    const flagSources = [...document.querySelectorAll("img")]
      .map((image) => image.getAttribute("src"))
      .filter((src) => src?.startsWith("/currency-flags/"));
    expect(flagSources).toEqual(
      expect.arrayContaining([
        "/currency-flags/us.svg",
        "/currency-flags/br.svg",
        "/currency-flags/id.svg",
      ]),
    );
    expect(flagSources).not.toContain("/currency-flags/eth.svg");
    expect(page().queryByText("Euro")).toBeNull();
    expect(page().getAllByText("$0.00").length).toBeGreaterThanOrEqual(1);
    expect(page().getAllByText("R$ 0,00").length).toBeGreaterThanOrEqual(1);
    expect(page().queryByText("USD / USDC")).toBeNull();
    expect(page().queryByText("BRL / BRZ")).toBeNull();
    expect(document.body.textContent).not.toContain("Not available yet");
    expect(page().queryByRole("button", { name: "Save", hidden: false })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Save", current: "page" })).toBeNull();

    expect(requests.some((request) => request.input === "/api/portfolio")).toBe(
      false,
    );
    const valuationRequest = requests.find((request) =>
      String(request.input).startsWith("/api/portfolio/valuation?"),
    );
    expect(valuationRequest).toBeDefined();
    expect(
      new URL(String(valuationRequest?.input), "http://localhost").searchParams.get(
        "region",
      ),
    ).toBe("BR");
    const activityRequest = requests.find((request) =>
      String(request.input).startsWith("/api/activity?"),
    );
    expect(activityRequest).toBeDefined();
    expect(String(activityRequest?.input).match(/\?/g)).toHaveLength(1);
    expect(new URL(String(activityRequest?.input), "http://localhost").searchParams.has("to")).toBe(true);
    expect(
      new Headers(valuationRequest?.init?.headers).get(ACCOUNT_PROVIDER_HEADER),
    ).toBe("cdp-embedded");
  });

  test("persists an Account country through the production Home presentation after refresh", async () => {
    const valuationRegions: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return Response.json(session());
      if (String(input).startsWith("/api/activity?")) {
        return Response.json(activityPage(input));
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        const region = new URL(
          String(input),
          "http://localhost",
        ).searchParams.get("region");
        if (region) valuationRegions.push(region);
        return valuationResponse(input, { usdc: "1000000" });
      }
      return Response.json(portfolioSnapshot({ usdc: "1000000" }));
    };

    const firstVisit = render(
      <PortfolioHomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={sessionFetch}
        detectedCountry="US"
      />,
    );

    await page().findByText("US dollar");
    fireEvent.click(await enabledAccountButton());
    expect(
      page().getByRole("combobox", { name: "Country" }).textContent,
    ).toContain("United States");

    fireEvent.click(page().getByRole("combobox", { name: "Country" }));
    fireEvent.click(
      within(document.body).getByRole("option", { name: /Brazil/ }),
    );

    expect(window.localStorage.getItem(anonymousCountryPreferenceKey)).toBe(
      "BR",
    );
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    await waitFor(() => expect(valuationRegions.at(-1)).toBe("BR"));
    expect(await page().findByText("Brazilian real")).toBeTruthy();

    firstVisit.unmount();
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(homeBalancesPresentationCachePrefix)) {
        window.localStorage.removeItem(key);
      }
    }
    valuationRegions.length = 0;

    render(
      <PortfolioHomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={sessionFetch}
        detectedCountry="US"
      />,
    );

    await waitFor(() => expect(valuationRegions.at(-1)).toBe("BR"));
    expect(await page().findByText("Brazilian real")).toBeTruthy();
    fireEvent.click(await enabledAccountButton());
    expect(
      page().getByRole("combobox", { name: "Country" }).textContent,
    ).toContain("Brazil");
    expect(page().getByText("Saved country choice.")).toBeTruthy();
  });

  test("renders IDR Balances with non-par EURC in euros and canonical currency marks", async () => {
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return Response.json(session());
      if (String(input).startsWith("/api/activity?")) {
        return Response.json(activityPage(input));
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        return valuationResponse(input, {
          usdc: "4343850000",
          idrx: "23409041",
          eurc: "109430000",
        });
      }
      return Response.json(portfolioSnapshot());
    };

    render(
      <PortfolioHomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={sessionFetch}
        detectedCountry="ID"
      />,
    );

    await page().findByText("Indonesian rupiah");
    expect(page().getByText("$4,343.85")).toBeTruthy();
    expect(page().getByText("Rp 234,090.41")).toBeTruthy();
    expect(page().getByText("€131.32")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Rp 131.32");
    const euroRow = page().getByText("Euro").closest("li");
    expect(euroRow?.querySelector("img")?.getAttribute("src")).toBe(
      "/currency-flags/eu.svg",
    );
    const idrRow = page().getByText("Indonesian rupiah").closest("li");
    expect(idrRow?.querySelector("img")?.getAttribute("src")).toBe(
      "/currency-flags/id.svg",
    );
  });

  test("repairs a legacy cached unpriced cash row at the Home display boundary", async () => {
    render(
      <AccountWalletSessionOwner
        sdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={async () => Response.json(session())}
      >
        <HomeExperience
          detectedCountry="US"
          routeMode="dashboard"
          savingsContent={<section aria-label="Savings module">Savings fixture</section>}
          investContent={<section aria-label="Invest module">Invest fixture</section>}
          assetBalances={{
            status: "ready",
            displayTotal: "—",
            items: [
              {
                id: "cash:cached-local",
                group: "cash",
                name: "Local currency",
                displayBalance: "2,500.00 LCLX",
                currencyCode: "LCL",
                tone: "muted",
              },
            ],
          }}
        />
      </AccountWalletSessionOwner>,
    );

    const quantity = await page().findByLabelText("2,500.00 LCLX");
    expect(quantity.textContent).toBe("2,500.00");
    expect(quantity.getAttribute("title")).toBe("2,500.00 LCLX");
    expect(quantity.closest("[data-tone]")?.getAttribute("data-tone")).toBe(
      "default",
    );
    expect(page().queryByText("2,500.00 LCLX")).toBeNull();
  });

  test("persists one reconciled unavailable row without a cache-write loop", async () => {
    writeHomeBalancesPresentation(
      () => window.localStorage,
      {
        ownerKey: OWNER,
        subject: "subject-home",
        smartAccount: ADDRESS,
        region: "GLOBAL",
      },
      {
        status: "ready",
        displayTotal: "$12.34",
        items: [
          {
            id: "usdc",
            group: "cash",
            name: "US dollar",
            displayBalance: "$12.34",
            currencyCode: "USD",
          },
          {
            id: "asset:fixture-eurc",
            group: "asset",
            name: "Euro",
            detail: "EURC",
            displayBalance: "25.00 EURC",
            currencyCode: "EUR",
          },
        ],
      },
    );

    let presentationWrites = 0;
    const onPresentationWrite = () => {
      presentationWrites += 1;
    };
    window.addEventListener("home:balances-presentation-cache", onPresentationWrite);

    try {
      render(
        <AccountWalletSessionOwner
          sdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
          sessionFetch={async () => Response.json(session())}
        >
          <HomeExperience
            routeMode="dashboard"
            savingsContent={<section aria-label="Savings module">Savings fixture</section>}
            investContent={<section aria-label="Invest module">Invest fixture</section>}
            assetBalances={{
              status: "ready",
              displayTotal: "$12.34",
              items: [
                {
                  id: "usdc",
                  group: "cash",
                  name: "US dollar",
                  displayBalance: "$12.34",
                  currencyCode: "USD",
                },
              ],
              unavailableItemIds: ["asset:fixture-eurc"],
            }}
          />
        </AccountWalletSessionOwner>,
      );

      expect(await page().findByText("Unavailable")).toBeTruthy();
      expect(page().getByText("Euro")).toBeTruthy();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(presentationWrites).toBe(1);
      expect(
        readHomeBalancesPresentation(
          () => window.localStorage,
          {
            ownerKey: OWNER,
            subject: "subject-home",
            smartAccount: ADDRESS,
            region: "GLOBAL",
          },
        )?.items[1],
      ).toEqual({
        id: "asset:fixture-eurc",
        group: "asset",
        name: "Euro",
        detail: "EURC",
        displayBalance: "Unavailable",
        currencyCode: "EUR",
        tone: "error",
      });
    } finally {
      window.removeEventListener(
        "home:balances-presentation-cache",
        onPresentationWrite,
      );
    }
  });

  test("renders priced ETH with fiat primary and bounded native under the name", async () => {
    render(
      <AccountWalletSessionOwner
        sdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={async () => Response.json(session())}
      >
        <HomeExperience
          detectedCountry="US"
          routeMode="dashboard"
          savingsContent={<section aria-label="Savings module">Savings fixture</section>}
          investContent={<section aria-label="Invest module">Invest fixture</section>}
          assetBalances={{
            status: "ready",
            displayTotal: "$4,812.40",
            items: [
              {
                id: "asset:eth",
                group: "asset",
                name: "Ethereum",
                detail: "ETH",
                displayBalance: "$4,812.40",
                displayContext: "1.1010 ETH",
              },
              {
                id: "asset:eth-dust",
                group: "asset",
                name: "Ethereum",
                detail: "ETH",
                displayBalance: "<$0.01",
                displayContext: "<0.000001 ETH",
              },
            ],
          }}
        />
      </AccountWalletSessionOwner>,
    );

    expect(await page().findByText("1.1010 ETH")).toBeTruthy();
    expect(page().getAllByText("$4,812.40").length).toBeGreaterThanOrEqual(1);
    expect(page().getByText("1.1010 ETH")).toBeTruthy();
    expect(page().getByText("<$0.01")).toBeTruthy();
    expect(page().getByText("<0.000001 ETH")).toBeTruthy();
    expect(document.body.textContent).not.toContain("1.101012331497033445");
    const ethMarks = document.querySelectorAll("[data-mark='eth']");
    expect(ethMarks).toHaveLength(2);
    for (const mark of ethMarks) {
      expect(mark.querySelector("svg")).toBeTruthy();
      expect(mark.textContent).toBe("");
    }
    expect(document.querySelector("img[src*='eth']")).toBeNull();
  });

  test("renders an incomplete valuation with no useful subtotal as unavailable", async () => {
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return Response.json(session());
      if (String(input).startsWith("/api/activity?")) {
        return Response.json(activityPage(input));
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        const snapshot = valuationSnapshot({ region: "US" });
        return Response.json({
          ...snapshot,
          total: { ...snapshot.total, status: "unavailable", value: null },
        });
      }
      return Response.json(portfolioSnapshot());
    };

    render(
      <PortfolioHomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={sessionFetch}
        detectedCountry="US"
      />,
    );

    expect(await page().findByLabelText("Total balance")).toBeTruthy();
    expect(page().getByText("—")).toBeTruthy();
    expect(page().queryByText("Wallet and savings value unavailable")).toBeNull();
  });

  test("clears the previous wallet amount before a newly verified owner portfolio resolves", async () => {
    const pendingValuation = deferred<Response>();
    const sessionFetch: SessionFetch = async (input, init) => {
      const token = new Headers(init?.headers).get("Authorization");
      const isOwnerB = token === "Bearer token-b";
      if (input === "/api/session") {
        return Response.json(
          isOwnerB
            ? session(
                { address: ADDRESS_B, chainId: BASE_CHAIN_ID },
                "cdp-embedded",
                "subject-home-b",
              )
            : session(),
        );
      }
      if (String(input).startsWith("/api/activity?")) {
        return Response.json(activityPage(input, isOwnerB ? ADDRESS_B : ADDRESS));
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        return isOwnerB
          ? pendingValuation.promise
          : valuationResponse(input, { usdc: "99000000" });
      }
      return Response.json(
        portfolioSnapshot({
          address: isOwnerB ? ADDRESS_B : ADDRESS,
          usdc: isOwnerB ? "2500000" : "99000000",
        }),
      );
    };
    const view = render(
      <PortfolioHomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
          getAccessToken: async () => "token-a",
        })}
        sessionFetch={sessionFetch}
      />,
    );

    await page().findByText("$99.00");

    view.rerender(
      <PortfolioHomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER_B,
          getAccessToken: async () => "token-b",
        })}
        sessionFetch={sessionFetch}
      />,
    );

    await page().findByText("Updating…");
    expect(page().queryByText("$99.00")).toBeNull();

    await act(async () => {
      pendingValuation.resolve(
        valuationResponse("/api/portfolio/valuation?region=GLOBAL", {
          address: ADDRESS_B,
          usdc: "2500000",
        }),
      );
      await pendingValuation.promise;
    });
    expect(await page().findByText("$2.50")).toBeTruthy();
  });

  test("propagates Base provider selection from sign-in through the real portfolio composition", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const sessionFetch: SessionFetch = async (input, init) => {
      requests.push({ input, init });
      if (input === "/api/session") {
        return Response.json(session(undefined, "base-account", "siwe-subject"));
      }
      if (String(input).startsWith("/api/activity?")) {
        return Response.json(activityPage(input));
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        return valuationResponse(input, { usdc: "4250000" });
      }
      return Response.json(portfolioSnapshot({ usdc: "4250000" }));
    };
    const signedOutSdk = sdk({
      isSignedIn: false,
      ownerKey: null,
      signInWithSiwe: async () => ({
        flowId: "siwe-flow",
        message: "fixture SIWE challenge",
      }),
    });
    const view = render(
      <PortfolioHomeHarness
        accountSdk={signedOutSdk}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={async () => connectedBaseAccount()}
        routeMode="landing"
      />,
    );

    await page().findByRole("heading", { name: "One home for your money." });
    fireEvent.click(
      within(page().getByRole("main")).getByRole("button", { name: "Sign in" }),
    );
    fireEvent.click(
      await page().findByRole("button", { name: "Sign in with Base Account" }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    view.rerender(
      <PortfolioHomeHarness
        accountSdk={{ ...signedOutSdk, isSignedIn: true, ownerKey: OWNER }}
        sessionFetch={sessionFetch}
        baseAccountEnabled
        baseAccountConnector={async () => connectedBaseAccount()}
        routeMode="dashboard"
      />,
    );

    expect(await page().findByText("$4.25")).toBeTruthy();
    const authenticatedRequests = requests.filter(
      (request) =>
        request.input === "/api/session" ||
        String(request.input).startsWith("/api/portfolio/valuation?"),
    );
    expect(authenticatedRequests).toHaveLength(2);
    for (const request of authenticatedRequests) {
      expect(
        new Headers(request.init?.headers).get(ACCOUNT_PROVIDER_HEADER),
      ).toBe("base-account");
    }
  });

  test("keeps transfer success mounted while refreshing balances and activity through the real hook/client boundary", async () => {
    const transactionHash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const userOperationHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const preparedCreatedAt = new Date().toISOString();
    const preparedExpiresAt = new Date(Date.now() + 600_000).toISOString();
    const sessionFetch: SessionFetch = async (input, init) => {
      requests.push({ input, init });
      if (input === "/api/session") {
        return Response.json(session());
      }
      if (String(input).startsWith("/api/activity?")) {
        return Response.json(activityPage(input));
      }
      if (String(input).startsWith("/api/transfer-receipt?")) {
        return Response.json({
          status: "confirmed",
          transactionHash,
          blockNumber: "16",
          success: true,
        });
      }
      if (input === "/api/actions/operations?scope=unresolved-send&limit=50") {
        return Response.json({ scope: "unresolved-send", operations: [] });
      }
      if (input === "/api/actions/operations") {
        return Response.json({ operations: [] });
      }
      if (input === "/api/actions/11111111-1111-4111-8111-111111111111") {
        const action = await sessionFetch("/api/actions/send/prepare", {
          body: JSON.stringify({ recipient: ADDRESS_B, amountBaseUnits: "1000001" }),
        }).then((response) => response.json());
        return Response.json({
          operation: {
            action,
            status: "prepared",
            attemptCount: 0,
            createdAt: action.createdAt,
            updatedAt: action.createdAt,
          },
        });
      }
      if (input === "/api/actions/send/prepare") {
        const request = JSON.parse(String(init?.body)) as {
          recipient: `0x${string}`;
          amountBaseUnits: string;
        };
        return Response.json({
          id: "11111111-1111-4111-8111-111111111111",
          reviewHash: "a".repeat(64),
          owner: {
            subject: "subject-home",
            address: ADDRESS,
            chainId: 8453,
            accountProvider: "cdp-embedded",
          },
          kind: "send",
          title: "Send USDC",
          calls: [{
            to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(),
            data: `0xa9059cbb${request.recipient.slice(2).padStart(64, "0")}${BigInt(request.amountBaseUnits).toString(16).padStart(64, "0")}`,
            value: "0",
          }],
          amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: request.amountBaseUnits, direction: "spend" }],
          warnings: [`Recipient: ${request.recipient}`, "Network fee shown by wallet."],
          createdAt: preparedCreatedAt,
          expiresAt: preparedExpiresAt,
        });
      }
      if (String(input).endsWith("/claim")) {
        const action = await sessionFetch("/api/actions/send/prepare", {
          body: JSON.stringify({ recipient: ADDRESS_B, amountBaseUnits: "1000001" }),
        }).then((response) => response.json());
        return Response.json({
          action,
          disposition: "dispatch",
          operation: { action, status: "submitting", attemptCount: 1, createdAt: action.createdAt, updatedAt: action.createdAt },
        });
      }
      if (String(input).endsWith("/submission")) {
        const body = JSON.parse(String(init?.body)) as { transactionHash?: `0x${string}` };
        const action = await sessionFetch("/api/actions/send/prepare", {
          body: JSON.stringify({ recipient: ADDRESS_B, amountBaseUnits: "1000001" }),
        }).then((response) => response.json());
        return Response.json({ operation: {
          action,
          status: body.transactionHash ? "confirmed" : "submitted",
          attemptCount: 1,
          userOperationHash,
          ...(body.transactionHash ? { transactionHash } : {}),
          createdAt: action.createdAt,
          updatedAt: action.createdAt,
        } });
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        return valuationResponse(input, { usdc: "5000000" });
      }
      return Response.json(portfolioSnapshot({ usdc: "5000000" }));
    };

    render(
      <PortfolioHomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
          sendUserOperation: async () => ({ userOperationHash }),
          getUserOperation: async () => ({
            network: "base",
            userOpHash: userOperationHash,
            status: "complete",
            transactionHash,
            calls: [{
              to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              data: `0xa9059cbb${ADDRESS_B.slice(2).padStart(64, "0")}${BigInt(1000001).toString(16).padStart(64, "0")}`,
              value: "0",
            }],
          }),
        })}
        sessionFetch={sessionFetch}
      />,
    );

    await page().findByText("$5.00");
    await page().findByText("No activity yet");
    fireEvent.click(page().getByRole("button", { name: "Send" }));
    for (const digit of "1.000001") {
      fireEvent.click(page().getByRole("button", {
        name: digit === "." ? "Decimal point" : digit,
      }));
    }
    fireEvent.click(await page().findByRole("button", { name: "Continue" }));
    fireEvent.change(page().getByLabelText("To"), {
      target: { value: ADDRESS_B },
    });
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
    expect(await page().findByText("$1.000001")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Send $1.000001" }));

    await page().findByText("Sent $1.000001");
    await waitFor(() => {
      expect(
        requests.filter((request) => request.input === "/api/portfolio"),
      ).toHaveLength(1);
      expect(
        requests.filter((request) =>
          String(request.input).startsWith("/api/portfolio/valuation?"),
        ),
      ).toHaveLength(2);
      expect(
        requests.filter((request) =>
          String(request.input).startsWith("/api/activity?"),
        ),
      ).toHaveLength(2);
    });

    expect(page().getByText("Sent $1.000001")).toBeTruthy();
    expect(page().getByText(/USDC · Base/)).toBeTruthy();
    for (const request of requests.filter((candidate) =>
      String(candidate.input).startsWith("/api/activity"),
    )) {
      expect(String(request.input).match(/\?/g)).toHaveLength(1);
    }
  });

  test("checks an unresolved send after refresh without claim, status mutation, or second prepare", async () => {
    const actionId = "11111111-1111-4111-8111-111111111111";
    const action = {
      id: actionId,
      reviewHash: "a".repeat(64),
      owner: {
        subject: "subject-home",
        address: ADDRESS,
        chainId: 8453,
        accountProvider: "cdp-embedded",
      },
      kind: "send",
      title: "Send USDC",
      calls: [{ to: ADDRESS_B, data: "0x", value: "0" }],
      amounts: [{
        assetId: "usdc",
        symbol: "USDC",
        decimals: 6,
        amountBaseUnits: "100000",
        direction: "spend",
      }],
      warnings: ["Network fee shown by wallet."],
      createdAt: "2026-09-08T05:00:00.000Z",
      expiresAt: "2026-12-08T05:10:00.000Z",
    };
    const unresolved = {
      action,
      status: "submitting",
      attemptCount: 1,
      createdAt: action.createdAt,
      updatedAt: "2026-09-08T05:02:00.000Z",
    };
    let claims = 0;
    let prepares = 0;
    let sends = 0;
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return Response.json(session());
      if (String(input).startsWith("/api/activity?")) return Response.json(activityPage(input));
      if (input === "/api/actions/operations?scope=unresolved-send&limit=50") {
        return Response.json({ scope: "unresolved-send", operations: [unresolved] });
      }
      if (input === "/api/actions/operations") return Response.json({ operations: [unresolved] });
      if (input === `/api/actions/${actionId}`) {
        return Response.json({ operation: unresolved });
      }
      if (input === `/api/actions/${actionId}/claim`) {
        claims += 1;
        return Response.json({
          action,
          disposition: "recover",
          operation: { ...unresolved, status: "submitting" },
        });
      }
      if (input === `/api/actions/${actionId}/status`) {
        return Response.json({ operation: { ...unresolved, status: "unknown" } });
      }
      if (input === "/api/actions/send/prepare") {
        prepares += 1;
        return Response.json(action);
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        return valuationResponse(input, { usdc: "10000000" });
      }
      return Response.json(portfolioSnapshot({ usdc: "10000000" }));
    };

    render(
      <PortfolioHomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
          sendUserOperation: async () => {
            sends += 1;
            return { userOperationHash: `0x${"ab".repeat(32)}` };
          },
        })}
        sessionFetch={sessionFetch}
      />,
    );

    expect(await page().findByText("Send USDC")).toBeTruthy();
    expect(page().getByText(/Wallet submission unresolved/)).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Check status" }));
    await waitFor(() => expect(page().getByText(/Wallet submission unresolved/)).toBeTruthy());
    expect(claims).toBe(0);
    expect(prepares).toBe(0);
    expect(sends).toBe(0);
  });

  test("keeps navigation, country selection, exact asset units, and account-query sheet behavior reachable", async () => {
    const view = render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        detectedCountry="BR"
      />,
    );

    await enabledAccountButton();
    expect(page().queryByRole("combobox", { name: "Country" })).toBeNull();
    expect(page().queryByRole("button", { name: "Invest", current: "page" })).toBeNull();
    expect(
      page().getByRole("navigation", { name: "Main navigation" }).textContent,
    ).not.toContain("Save");
    expect(page().getAllByText("$12.34").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(page().getByRole("button", { name: "Account" }));
    expect(page().getByRole("combobox", { name: "Country" }).textContent).toContain("Brazil");
    expect(page().getByText("Sets how money is shown")).toBeTruthy();
    expect(pushCalls).toEqual(["/dashboard?account=settings"]);
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    expect(backCalls).toBe(1);

    const tabs = page().getByRole("navigation", { name: "Main navigation" });
    expect(within(tabs).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(tabs).getByRole("button", { name: "Home" })).toBeTruthy();
    expect(within(tabs).getByRole("button", { name: "Invest" })).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Save" }));
    expect(page().getByRole("region", { name: "Savings module" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Home" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Save" }));
    expect(page().getByRole("region", { name: "Savings module" })).toBeTruthy();
    expect(pushCalls).toEqual([
      "/dashboard?account=settings",
      "/dashboard?panel=save",
      "/dashboard",
      "/dashboard?panel=save",
    ]);

    fireEvent.click(within(tabs).getByRole("button", { name: "Invest" }));
    const invest = page().getByRole("region", { name: "Invest module" });
    expect(invest).toBeTruthy();
    expect(pushCalls).toEqual([
      "/dashboard?account=settings",
      "/dashboard?panel=save",
      "/dashboard",
      "/dashboard?panel=save",
      "/dashboard?panel=invest",
    ]);
    expect(document.activeElement).toBe(
      document.getElementById("navigation-panel"),
    );

    view.unmount();
    render(<HomeHarness accountSdk={sdk()} initialAccountOpen routeMode="landing" />);
    const dialog = await page().findByRole("dialog", { name: "Sign in to Home" });
    expect((dialog as HTMLDialogElement).open).toBe(true);
    fireEvent.click(page().getByRole("button", { name: "Close sign in" }));
    await waitFor(() => expect(replaceCalls).toEqual(["/"]));
  });

  test("shows a Save loading shell while session is checking, then savings content", async () => {
    const pendingSession = deferred<Response>();
    render(
      <HomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
        })}
        sessionFetch={() => pendingSession.promise}
        initialPanel="save"
      />,
    );

    expect(page().getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    expect(page().getByLabelText("Savings")).toBeTruthy();
    expect(document.querySelector(".save-panel-shell")).toBeTruthy();
    expect(page().getByText("Updating…")).toBeTruthy();
    expect(document.querySelector("[data-shimmer='hero']")).toBeTruthy();
    expect(document.querySelectorAll("[data-shimmer='row']").length).toBe(2);
    expect(page().queryByText("Savings verifying unavailable")).toBeNull();
    expect(page().queryByText("Savings unavailable")).toBeNull();
    expect(page().queryByText("Savings fixture")).toBeNull();
    expect(page().queryByText("Checking…")).toBeNull();

    await act(async () => {
      pendingSession.resolve(Response.json(session()));
      await pendingSession.promise;
    });

    expect(await page().findByRole("region", { name: "Savings module" })).toBeTruthy();
    expect(page().getByText("Savings fixture")).toBeTruthy();
    expect(page().queryByText("Updating…")).toBeNull();
    expect(document.querySelector("[data-shimmer='hero']")).toBeNull();
    expect(page().queryByText("Savings verifying unavailable")).toBeNull();
    expect(page().queryByText("Savings unavailable")).toBeNull();
  });

  test("reserves Savings unavailable for a missing module after verification", async () => {
    render(
      <AccountWalletSessionOwner
        sdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={async () => Response.json(session())}
      >
        <HomeExperience
          routeMode="dashboard"
          initialPanel="save"
          investContent={<section aria-label="Invest module">Invest fixture</section>}
          assetBalances={{
            status: "ready",
            displayTotal: "$12.34",
            items: [],
          }}
        />
      </AccountWalletSessionOwner>,
    );

    expect(await page().findByText("Savings unavailable")).toBeTruthy();
    expect(page().queryByText("Savings verifying unavailable")).toBeNull();
    expect(page().queryByText("Updating…")).toBeNull();
    expect(document.querySelector("[data-shimmer='hero']")).toBeNull();
  });

  test("shows Savings unavailable after a failed session check, not a verifying empty panel", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({
          isSignedIn: true,
          ownerKey: OWNER,
        })}
        sessionFetch={async () =>
          Response.json({ error: { code: "SESSION_UNAVAILABLE" } }, { status: 503 })
        }
        initialPanel="save"
      />,
    );

    expect(await page().findByText("Savings unavailable")).toBeTruthy();
    expect(page().queryByText("Savings verifying unavailable")).toBeNull();
    expect(page().queryByText("Savings fixture")).toBeNull();
    expect(document.querySelector("[data-shimmer='hero']")).toBeNull();
  });

  test("taps Balances and Activity into nested lists and keeps Home free of Refresh chrome", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
      />,
    );

    await enabledAccountButton();
    expect(page().queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(page().queryByText(/^Updated(\s|$)/)).toBeNull();
    expect(page().queryByText("Data may be delayed")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
    expect(page().getByText("US dollar")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Save" })).toBeNull();
    expect(pushCalls).toEqual(["/dashboard?panel=balances"]);

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(page().getByRole("button", { name: "Save" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Activity" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Refresh" })).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Activity" }));
    expect(page().getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(page().queryByText(/^Updated(\s|$)/)).toBeNull();
    expect(pushCalls).toEqual([
      "/dashboard?panel=balances",
      "/dashboard",
      "/dashboard?panel=activity",
    ]);

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(page().getByRole("button", { name: "Save" }));
    expect(page().getByRole("region", { name: "Savings module" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
    expect(page().getByRole("heading", { level: 1, name: "Save" })).toBeTruthy();
  });

  test("composes one recorded-operations outage notice with onchain Activity", async () => {
    const notice =
      "Pending Home actions are temporarily unavailable. Onchain activity is still shown.";
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="activity"
        sessionFetch={async (input) => {
          const path = String(input);
          if (path === "/api/session") return Response.json(session());
          if (path.startsWith("/api/activity?")) {
            return Response.json({
              ...activityPage(input),
              recordedOperations: "unavailable",
            });
          }
          if (path === "/api/actions/operations") {
            return Response.json(
              { error: { code: "OPERATIONS_UNAVAILABLE" } },
              { status: 503 },
            );
          }
          return Response.json({});
        }}
      />,
    );

    await enabledAccountButton();
    expect(await page().findByText(notice)).toBeTruthy();
    expect(page().getAllByText(notice)).toHaveLength(1);
    expect(
      page().queryByText(
        "Recorded Home actions are unavailable. Onchain transfers are still shown.",
      ),
    ).toBeNull();
  });

  test("Home hub previews four balance rows and the nested panel lists every holding", async () => {
    const nvidia = investPortfolioAssets.find((asset) => asset.id === "nvdac")!;
    const bitcoin = investPortfolioAssets.find((asset) => asset.id === "cbbtc")!;
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetMarkResolution={{
          images: {
            [nvidia.assetKey]: "https://icons.example.test/nvda.png",
            [bitcoin.assetKey]: "https://icons.example.test/cbbtc.png",
          },
          pending: false,
        }}
        assetBalances={{
          status: "ready",
          displayTotal: "$12.34",
          items: [
            {
              id: "cash:usd",
              group: "cash",
              name: "US dollar",
              displayBalance: "$1.00",
              currencyCode: "USD",
            },
            {
              id: "cash:idr",
              group: "cash",
              name: "Indonesian rupiah",
              displayBalance: "Rp 2.00",
              currencyCode: "IDR",
            },
            {
              id: "asset:eur",
              group: "asset",
              name: "Euro",
              displayBalance: "€3.00",
              currencyCode: "EUR",
            },
            {
              id: "asset:eth",
              group: "asset",
              name: "Ethereum",
              displayBalance: "4.00 ETH",
            },
            {
              id: `asset:${nvidia.assetKey}`,
              assetKey: nvidia.assetKey,
              group: "asset",
              name: "NVIDIA",
              detail: "NVDAc",
              displayBalance: "5.00 NVDAc",
            },
            {
              id: `asset:${bitcoin.assetKey}`,
              assetKey: bitcoin.assetKey,
              group: "asset",
              name: "Bitcoin",
              detail: "cbBTC",
              displayBalance: "6.00 cbBTC",
            },
          ],
        }}
      />,
    );

    await enabledAccountButton();
    expect(page().getByText("US dollar")).toBeTruthy();
    expect(page().getByText("Ethereum")).toBeTruthy();
    expect(page().queryByText("NVIDIA")).toBeNull();
    expect(page().queryByText("Bitcoin")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    const nvidiaRow = page().getByText("NVIDIA").closest("li")!;
    const bitcoinRow = page().getByText("Bitcoin").closest("li")!;
    expect(nvidiaRow.querySelector("img")?.getAttribute("src")).toBe(
      "https://icons.example.test/nvda.png",
    );
    expect(bitcoinRow.querySelector("img")?.getAttribute("src")).toBe(
      "https://icons.example.test/cbbtc.png",
    );
    expect(page().getByText("Indonesian rupiah")).toBeTruthy();
  });

  test("honors Balances and Activity dashboard deep links on first paint", async () => {
    const balances = render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="balances"
      />,
    );
    await enabledAccountButton();
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
    expect(page().getByText("US dollar")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Save" })).toBeNull();
    expect(pushCalls).toEqual([]);
    balances.unmount();

    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="activity"
      />,
    );
    await enabledAccountButton();
    expect(page().getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(page().queryByText(/^Updated(\s|$)/)).toBeNull();
  });

  test("honors a dashboard panel deep link on first paint", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="invest"
      />,
    );

    await page().findByRole("region", { name: "Invest module" });
    expect(pushCalls).toEqual([]);
    expect(page().getByRole("button", { name: "Invest", current: "page" })).toBeTruthy();

    act(() => {
      window.history.replaceState({}, "", "/dashboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(page().queryByRole("region", { name: "Invest module" })).toBeNull();
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
  });

  test("replaces deep-linked account settings instead of backing out of Home", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialAccountSettingsOpen
      />,
    );

    expect(await page().findByRole("combobox", { name: "Country" })).toBeTruthy();
    await page().findByRole("button", { name: "Sign out" });
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    expect(backCalls).toBe(0);
    expect(replaceCalls).toEqual(["/dashboard"]);
    expect(await page().findByRole("heading", { name: "Balances" })).toBeTruthy();
  });

  test("pins shell chrome, shows a profile mark, and keeps the footer on Account", async () => {
    render(
      <HomeHarness accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })} />,
    );
    const account = await enabledAccountButton();
    expect(document.querySelector(".app-frame-shell")).toBeTruthy();
    expect(document.querySelector(".app-header")).toBeTruthy();
    expect(
      within(document.querySelector(".app-header") as HTMLElement).getByRole(
        "button",
        { name: "Home" },
      ),
    ).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Home" })).toBeNull();
    expect(document.querySelector(".panel-fade")).toBeTruthy();
    expect(account.querySelector("[data-profile]")).toBeTruthy();
    expect(account.textContent).toBe("h");
    expect(page().getByRole("button", { name: "Account" }).textContent).not.toBe(
      "Account",
    );

    fireEvent.click(account);
    expect(page().getByRole("heading", { level: 1, name: "Account" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Account" })).toBeNull();
    expect(page().getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    expect(await enabledAccountButton()).toBeTruthy();
  });

  test("swaps nested Save and Memes titles inside the same header band", async () => {
    const { InvestExperience } = await import("@/client/invest/invest-experience");
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        investContent={<InvestExperience />}
      />,
    );
    await enabledAccountButton();
    const header = document.querySelector(".app-header");
    expect(header).toBeTruthy();
    expect(
      within(header as HTMLElement).getByRole("button", { name: "Home" }),
    ).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Home" })).toBeNull();
    expect(page().queryByRole("heading", { name: "Save" })).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Save" }));
    expect(page().getByRole("heading", { name: "Save" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Account" })).toBeTruthy();
    expect(document.querySelector(".app-header-title")?.textContent).toBe("Save");

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(within(page().getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Invest" }));
    await page().findByRole("heading", { name: "Invest" });
    expect(page().queryByText("Browse on Base")).toBeNull();
    const memesShelf = page().getByRole("heading", { name: "Memes" }).closest("section");
    expect(memesShelf).toBeTruthy();
    const main = document.querySelector(".app-main-authenticated") as HTMLElement;
    expect(main).toBeTruthy();
    main.scrollTop = 480;
    fireEvent.click(within(memesShelf as HTMLElement).getByRole("button", { name: "See all ›" }));
    await waitFor(() =>
      expect(document.querySelector(".app-header-title")?.textContent).toBe("Memes"),
    );
    expect(main.scrollTop).toBe(0);
    expect(page().getByRole("heading", { level: 1, name: "Memes" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Back to Invest" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Account" })).toBeTruthy();
    expect(page().getAllByRole("button", { name: "Back to Invest" })).toHaveLength(1);
    expect(page().getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
  });

  test("keeps a deep-linked Memes category in the same header band", async () => {
    const { InvestExperience } = await import("@/client/invest/invest-experience");
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        initialPanel="invest"
        investContent={
          <InvestExperience initialView={{ screen: "category", shelfId: "memes" }} />
        }
      />,
    );
    await enabledAccountButton();
    await waitFor(() =>
      expect(document.querySelector(".app-header-title")?.textContent).toBe("Memes"),
    );
    expect(page().getByRole("heading", { level: 1, name: "Memes" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Back to Invest" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Account" })).toBeTruthy();
    expect(page().getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
  });
});

describe("balances incremental rendering", () => {
  function manyBalances(count: number): HomeAssetBalancesPresentation["items"] {
    return Array.from({ length: count }, (_, index) => ({
      id: `asset:fixture-${index}`,
      group: "asset",
      name: `Holding ${index}`,
      detail: `H${index}`,
      displayBalance: `${index}.00 H${index}`,
    }));
  }

  function readyBalances(
    count = 25,
    items?: HomeAssetBalancesPresentation["items"],
  ) {
    return {
      status: "ready" as const,
      displayTotal: "$99.99",
      items: items ?? manyBalances(count),
    };
  }

  async function openManyBalances(
    props: Partial<ComponentProps<typeof HomeHarness>> = {},
  ) {
    const view = render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={readyBalances()}
        {...props}
      />,
    );
    await enabledAccountButton();
    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    return view;
  }

  function balancesMain() {
    const main = document.querySelector(".app-main-authenticated") as HTMLElement;
    expect(main).toBeTruthy();
    return main;
  }

  function scrollBalances(main: HTMLElement, top = 480) {
    main.scrollTop = top;
    fireEvent.scroll(main);
  }

  function expectRevealWindowAtSecondBatch() {
    expect(page().getByText("Holding 19")).toBeTruthy();
    expect(page().queryByText("Holding 20")).toBeNull();
  }

  async function openAssetFromBalances() {
    const { InvestExperience } = await import("@/client/invest/invest-experience");
    const restoreFetch = stubInvestHistory();
    await openManyBalances({ investContent: <InvestExperience /> });
    revealNextBalancesBatch();
    const main = balancesMain();
    scrollBalances(main);
    await openNvidiaAsset();
    return { main, restoreFetch };
  }

  async function openNvidiaAsset() {
    fireEvent.click(page().getByRole("button", { name: "Invest" }));
    await page().findByRole("heading", { name: "Invest" });
    fireEvent.click(page().getByRole("button", { name: "NVIDIA details" }));
    await page().findByRole("heading", { name: "NVIDIA" });
  }

  test("reveals the nested Balances list in batches and reaches the final holding without duplicates", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$99.99",
          totalStatus: "partial",
          statusLabel: "Unavailable",
          items: manyBalances(25),
        }}
      />,
    );

    await enabledAccountButton();
    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();

    // The authoritative total/status stays independent of the rendered batch.
    expect(page().getByText("Unavailable")).toBeTruthy();
    expect(page().getByText("Holding 0")).toBeTruthy();
    expect(page().getByText("Holding 9")).toBeTruthy();
    expect(page().queryByText("Holding 10")).toBeNull();
    expect(document.querySelector(".balances-sentinel")).toBeTruthy();

    revealNextBalancesBatch();
    expect(page().getByText("Holding 19")).toBeTruthy();
    expect(page().queryByText("Holding 20")).toBeNull();
    expect(document.querySelector(".balances-sentinel")).toBeTruthy();

    revealNextBalancesBatch();
    expect(page().getByText("Holding 24")).toBeTruthy();
    expect(document.querySelector(".balances-sentinel")).toBeNull();

    expect(page().getAllByText("Holding 0")).toHaveLength(1);
    expect(page().getAllByText("Holding 12")).toHaveLength(1);
  });

  test("clears the revealed window on a fresh forward Balances entry", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$99.99",
          items: manyBalances(25),
        }}
      />,
    );

    await enabledAccountButton();
    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    revealNextBalancesBatch();
    expect(page().getByText("Holding 19")).toBeTruthy();
    expect(page().queryByText("Holding 20")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(page().queryByText("Holding 19")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(page().getByText("Holding 0")).toBeTruthy();
    expect(page().getByText("Holding 9")).toBeTruthy();
    expect(page().queryByText("Holding 10")).toBeNull();
    expect(page().queryByText("Holding 19")).toBeNull();
    expect(document.querySelector(".balances-sentinel")).toBeTruthy();
  });

  test("keeps the revealed window across an equivalent-data refresh", async () => {
    const view = render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$99.99",
          items: manyBalances(25),
        }}
      />,
    );

    await enabledAccountButton();
    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    revealNextBalancesBatch();
    expect(page().getByText("Holding 19")).toBeTruthy();

    view.rerender(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$99.99",
          items: manyBalances(25),
        }}
      />,
    );

    expect(page().getByText("Holding 19")).toBeTruthy();
    expect(page().queryByText("Holding 20")).toBeNull();
    expect(document.querySelector(".balances-sentinel")).toBeTruthy();
  });

  test("clears Balances scroll on a fresh forward Balances entry", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$99.99",
          items: manyBalances(25),
        }}
      />,
    );

    await enabledAccountButton();
    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    const main = document.querySelector(".app-main-authenticated") as HTMLElement;
    expect(main).toBeTruthy();
    main.scrollTop = 480;
    fireEvent.scroll(main);

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(main.scrollTop).toBe(0);
  });

  test("auto-fills more than two batches while the sentinel stays intersecting", async () => {
    autoIntersectOnObserve = true;
    try {
      render(
        <HomeHarness
          accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
          assetBalances={{
            status: "ready",
            displayTotal: "$99.99",
            items: manyBalances(35),
          }}
        />,
      );

      await enabledAccountButton();
      fireEvent.click(page().getByRole("button", { name: "Balances" }));
      await waitFor(() => expect(page().getByText("Holding 34")).toBeTruthy());
      expect(document.querySelector(".balances-sentinel")).toBeNull();
    } finally {
      autoIntersectOnObserve = false;
    }
  });

  test("queues Account Done until its history push commits, then restores on the delayed pop", async () => {
    const accountSdk = sdk({ isSignedIn: true, ownerKey: OWNER });
    const sessionFetch: SessionFetch = async () => Response.json(session());
    const assetBalances = {
      status: "ready" as const,
      displayTotal: "$99.99",
      items: manyBalances(25),
    };
    const fixture = () => (
      <HomeHarness
        accountSdk={accountSdk}
        sessionFetch={sessionFetch}
        assetBalances={assetBalances}
      />
    );
    const view = render(fixture());

    await enabledAccountButton();
    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    revealNextBalancesBatch();
    const main = document.querySelector(".app-main-authenticated") as HTMLElement;
    expect(main).toBeTruthy();
    main.scrollTop = 480;
    fireEvent.scroll(main);

    autoCommitRouterPush = false;
    fireEvent.click(page().getByRole("button", { name: "Account" }));
    expect(await page().findByRole("combobox", { name: "Country" })).toBeTruthy();
    main.scrollTop = 120;
    fireEvent.scroll(main);

    autoPopRouterBack = false;
    fireEvent.click(page().getByRole("button", { name: "Done" }));
    expect(page().getByRole("heading", { level: 1, name: "Account" })).toBeTruthy();
    expect(backCalls).toBe(0);

    // Issue #273 regression marker: App Router commits the Account push after
    // the local overlay paints; Done must wait for that entry before going back.
    act(() => commitPendingRouterPush());
    view.rerender(fixture());
    await waitFor(() => expect(backCalls).toBe(1));
    expect(page().getByRole("heading", { level: 1, name: "Account" })).toBeTruthy();

    act(() => popHistory());
    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(main.scrollTop).toBe(480);
    expectRevealWindowAtSecondBatch();
  });

  test("resets the reveal window when rows change materially with unchanged IDs", async () => {
    const view = render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$99.99",
          items: manyBalances(25),
        }}
      />,
    );

    await enabledAccountButton();
    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    revealNextBalancesBatch();
    expect(page().getByText("Holding 19")).toBeTruthy();

    view.rerender(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$99.99",
          items: manyBalances(25).map((item, index) => ({
            ...item,
            displayBalance: `updated:${index}`,
          })),
        }}
      />,
    );

    expect(page().getByText("Holding 9")).toBeTruthy();
    expect(page().queryByText("Holding 10")).toBeNull();
    expect(page().getByText("updated:1")).toBeTruthy();
    expect(document.querySelector(".balances-sentinel")).toBeTruthy();
  });

  test("resets the reveal window when the item set changes for another owner", async () => {
    const view = render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$99.99",
          items: manyBalances(25),
        }}
      />,
    );

    await enabledAccountButton();
    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    revealNextBalancesBatch();
    expect(page().getByText("Holding 19")).toBeTruthy();

    view.rerender(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$1.00",
          items: manyBalances(25).map((item) => ({
            ...item,
            id: `${item.id}-other`,
            name: `Other ${item.name}`,
          })),
        }}
      />,
    );

    expect(page().getByText("Other Holding 9")).toBeTruthy();
    expect(page().queryByText("Other Holding 10")).toBeNull();
    expect(page().queryByText("Holding 19")).toBeNull();
    expect(document.querySelector(".balances-sentinel")).toBeTruthy();
  });

  test("keeps Home preview capped and shows a short Balances list completely", async () => {
    render(
      <HomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        assetBalances={{
          status: "ready",
          displayTotal: "$99.99",
          items: manyBalances(6),
        }}
      />,
    );

    await enabledAccountButton();
    expect(page().getByText("Holding 0")).toBeTruthy();
    expect(page().getByText("Holding 3")).toBeTruthy();
    expect(page().queryByText("Holding 4")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    expect(page().getByText("Holding 5")).toBeTruthy();
    expect(document.querySelector(".balances-sentinel")).toBeNull();
  });

  test("restores Balances scroll and revealed batches after opening an asset and using app Back", async () => {
    const { main, restoreFetch } = await openAssetFromBalances();
    try {
      fireEvent.click(page().getByRole("button", { name: "Back" }));
      await page().findByRole("heading", { name: "Invest" });
      act(() => popHistory());

      expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
      expect(main.scrollTop).toBe(480);
      expectRevealWindowAtSecondBatch();
    } finally {
      restoreFetch();
    }
  });

  test("restores Balances scroll via browser history back after opening an asset", async () => {
    const { main, restoreFetch } = await openAssetFromBalances();
    try {
      act(() => popHistory()); // asset detail -> Invest hub
      act(() => popHistory()); // Invest hub -> Balances

      expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
      expect(main.scrollTop).toBe(480);
      expectRevealWindowAtSecondBatch();
    } finally {
      restoreFetch();
    }
  });

  test("keeps a generic Balances→Invest→Back return at the top without restoring", async () => {
    await openManyBalances();
    revealNextBalancesBatch();
    const main = balancesMain();
    scrollBalances(main);

    fireEvent.click(page().getByRole("button", { name: "Invest" }));
    await page().findByRole("heading", { name: "Invest" });
    act(() => popHistory());

    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(main.scrollTop).toBe(0);
    expect(page().getByText("Holding 0")).toBeTruthy();
    expect(page().queryByText("Holding 10")).toBeNull();
  });

  test("keeps a direct Balances→Home→Back return at the top without restoring", async () => {
    await openManyBalances();
    revealNextBalancesBatch();
    const main = balancesMain();
    scrollBalances(main);

    fireEvent.click(page().getByRole("button", { name: "Home" }));
    expect(page().queryByRole("button", { name: "Back" })).toBeNull();
    act(() => popHistory());

    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(main.scrollTop).toBe(0);
    expect(page().getByText("Holding 9")).toBeTruthy();
    expect(page().queryByText("Holding 10")).toBeNull();
  });

  test("keeps a Balances→Home→Activity→Back return at the top without restoring", async () => {
    await openManyBalances();
    revealNextBalancesBatch();
    const main = balancesMain();
    scrollBalances(main);

    fireEvent.click(page().getByRole("button", { name: "Home" }));
    fireEvent.click(page().getByRole("button", { name: "Activity" }));
    await page().findByRole("heading", { name: "Activity" });
    act(() => popHistory()); // Activity -> Home
    act(() => popHistory()); // Home -> Balances

    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(main.scrollTop).toBe(0);
    expect(page().getByText("Holding 9")).toBeTruthy();
    expect(page().queryByText("Holding 10")).toBeNull();
  });

  const identityFences = [
    {
      name: "owner",
      rerender: (view: ReturnType<typeof render>) =>
        view.rerender(
          <HomeHarness
            accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER_B })}
            sessionFetch={async () =>
              Response.json(
                session(
                  { address: ADDRESS_B, chainId: BASE_CHAIN_ID },
                  "cdp-embedded",
                  "subject-home-b",
                ),
              )
            }
            assetBalances={readyBalances()}
          />,
        ),
    },
    {
      name: "account provider",
      rerender: (view: ReturnType<typeof render>) =>
        view.rerender(
          <HomeHarness
            accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
            sessionFetch={async () =>
              Response.json(
                session(
                  { address: ADDRESS, chainId: BASE_CHAIN_ID },
                  "base-account",
                ),
              )
            }
            assetBalances={readyBalances()}
          />,
        ),
    },
    {
      name: "subject",
      rerender: (view: ReturnType<typeof render>) =>
        view.rerender(
          <HomeHarness
            accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
            sessionFetch={async () =>
              Response.json(
                session(
                  { address: ADDRESS, chainId: BASE_CHAIN_ID },
                  "cdp-embedded",
                  "subject-home-other",
                ),
              )
            }
            assetBalances={readyBalances()}
          />,
        ),
    },
    {
      name: "smart account",
      rerender: (view: ReturnType<typeof render>) =>
        view.rerender(
          <HomeHarness
            accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
            sessionFetch={async () =>
              Response.json(
                session({ address: ADDRESS_B, chainId: BASE_CHAIN_ID }),
              )
            }
            assetBalances={readyBalances()}
          />,
        ),
    },
    {
      name: "region",
      rerender: (view: ReturnType<typeof render>) =>
        view.rerender(
          <HomeHarness
            accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
            detectedCountry="US"
            assetBalances={readyBalances()}
          />,
        ),
    },
    {
      name: "list",
      rerender: (view: ReturnType<typeof render>) =>
        view.rerender(
          <HomeHarness
            accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
            assetBalances={readyBalances(
              25,
              manyBalances(25).map((item) => ({
                ...item,
                id: `${item.id}-other`,
                name: `Other ${item.name}`,
              })),
            )}
          />,
        ),
    },
  ];

  for (const fence of identityFences) {
    test(`clears saved Balances scroll when the ${fence.name} identity changes`, async () => {
      const view = await openManyBalances();
      const main = balancesMain();
      scrollBalances(main);

      fence.rerender(view);

      await waitFor(() => expect(main.scrollTop).toBe(0));
    });
  }

  test("does not refetch portfolio valuation when returning to Balances", async () => {
    const valuationRequests: string[] = [];
    const sessionFetch: SessionFetch = async (input) => {
      if (input === "/api/session") return Response.json(session());
      if (String(input).startsWith("/api/activity?")) {
        return Response.json(activityPage(input));
      }
      if (String(input).startsWith("/api/portfolio/valuation?")) {
        valuationRequests.push(String(input));
        return valuationResponse(input, { usdc: "12340000" });
      }
      return Response.json(portfolioSnapshot({ usdc: "12340000" }));
    };

    render(
      <PortfolioHomeHarness
        accountSdk={sdk({ isSignedIn: true, ownerKey: OWNER })}
        sessionFetch={sessionFetch}
      />,
    );

    expect(await page().findByLabelText("Total balance")).toBeTruthy();
    expect(valuationRequests).toHaveLength(1);

    fireEvent.click(page().getByRole("button", { name: "Balances" }));
    await page().findByRole("heading", { name: "Balances" });
    const main = document.querySelector(".app-main-authenticated") as HTMLElement;
    expect(main).toBeTruthy();
    main.scrollTop = 480;
    fireEvent.scroll(main);

    fireEvent.click(page().getByRole("button", { name: "Invest" }));
    await page().findByRole("heading", { name: "Invest" });

    act(() => popHistory());

    expect(page().getByRole("heading", { name: "Balances" })).toBeTruthy();
    expect(main.scrollTop).toBe(0);
    expect(valuationRequests).toHaveLength(1);
  });
});

describe("balances scroll clamp", () => {
  test("clamps a saved offset to the current scrollable range", () => {
    const tall = { scrollHeight: 1000, clientHeight: 400 } as HTMLElement;
    const short = { scrollHeight: 600, clientHeight: 400 } as HTMLElement;
    const flat = { scrollHeight: 300, clientHeight: 400 } as HTMLElement;

    expect(clampHomeScrollTop(tall, 480)).toBe(480);
    expect(clampHomeScrollTop(short, 480)).toBe(200);
    // When content is shorter than the viewport, defer to the native clamp.
    expect(clampHomeScrollTop(flat, 480)).toBe(480);
    expect(clampHomeScrollTop(null, 480)).toBe(480);
    expect(clampHomeScrollTop(tall, 0)).toBe(0);
  });
});

describe("balances restoration identity", () => {
  test("fences the reveal scope by account provider independently", () => {
    const base = {
      ownerKey: "owner",
      provider: "cdp-embedded",
      subject: "subject",
      smartAccount: ADDRESS,
      region: "US" as RegionId,
    };
    const embedded = homeBalancesRestoreScope(base);
    const baseAccount = homeBalancesRestoreScope({
      ...base,
      provider: "base-account",
    });

    expect(embedded).toBeTruthy();
    expect(baseAccount).toBeTruthy();
    expect(baseAccount).not.toBe(embedded);
    expect(
      homeBalancesRestoreScope({ ...base, smartAccount: null }),
    ).toBeNull();
  });
});
