import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AccountWalletSdkBoundary } from "@/features/account/cdp-client";
import type {
  BaseAccountConnector,
  ConnectedBaseAccount,
} from "@/features/account/base-account-connector";
import type {
  SessionFetch,
  VerifiedAccountSession,
} from "@/features/account/session-client";
import { ACCOUNT_PROVIDER_HEADER } from "@/features/account/session-types";
import { verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { presentationRegions, type RegionId } from "@/config/regions";

const replaceCalls: string[] = [];
const pushCalls: string[] = [];
let backCalls = 0;
mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => replaceCalls.push(href),
    push: (href: string) => pushCalls.push(href),
    back: () => {
      backCalls += 1;
    },
  }),
}));

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const {
  AccountWalletClientProvider,
  AccountWalletSessionOwner,
  CdpAccountProvider,
  createBlockedAccountWalletClient,
} = await import("@/features/account/cdp-client");
const { BASE_CHAIN_ID } = await import("@/features/account/session-client");
const { HomeExperience, PortfolioHomeExperience } = await import(
  "./home-experience"
);

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
      indicativeValue: { atoms: usdc, scale: 6 },
      valuationStatus: "priced",
    },
  ];
  if (currency && currency !== "USD") {
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
    prices: [],
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

function HomeHarness({
  accountSdk,
  sessionFetch = async () => Response.json(session()),
  initialAccountOpen = false,
  initialPanel,
  initialAccountSettingsOpen = false,
  detectedCountry = null,
  routeMode = "dashboard",
}: {
  accountSdk: AccountWalletSdkBoundary;
  sessionFetch?: SessionFetch;
  initialAccountOpen?: boolean;
  initialPanel?: "home" | "invest" | "save";
  initialAccountSettingsOpen?: boolean;
  detectedCountry?: string | null;
  routeMode?: "landing" | "dashboard";
}) {
  return (
    <AccountWalletSessionOwner sdk={accountSdk} sessionFetch={sessionFetch}>
      <HomeExperience
        detectedCountry={detectedCountry}
        initialAccountOpen={initialAccountOpen}
        initialPanel={initialPanel}
        initialAccountSettingsOpen={initialAccountSettingsOpen}
        routeMode={routeMode}
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
        }}
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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  replaceCalls.length = 0;
  pushCalls.length = 0;
  backCalls = 0;
  document.body.style.overflow = "";
  window.history.replaceState({}, "", "/");
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
    expect(page().queryByRole("button", { name: "Receive" })).toBeNull();

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
    expect(page().getByRole("link", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Save" })).toBeTruthy();
    expect(page().getByText("Updating…")).toBeTruthy();
    expect(document.querySelector("[data-shimmer='hero']")).toBeTruthy();
    expect(document.querySelectorAll("[data-shimmer='row']").length).toBe(4);
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
    expect(page().getByRole("link", { name: "Add money" }).getAttribute("href")).toBe("/fund");
    expect(page().getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false);
    expect(page().getByRole("button", { name: "Receive" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Receive" }));
    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    expect(page().getByTitle(ADDRESS).textContent).toBe("0x1111…111111");
    fireEvent.click(page().getByRole("button", { name: "Close receive dialog" }));
    expect(page().queryByRole("dialog", { name: "Receive" })).toBeNull();
    expect(page().queryByText("One home for your money.")).toBeNull();
  });

  test("holds signed-out dashboard on a placeholder and redirects without portfolio chrome", async () => {
    render(<HomeHarness accountSdk={sdk()} routeMode="dashboard" />);

    expect(page().queryByText("$12.34")).toBeNull();
    expect(document.body.textContent).not.toContain(ADDRESS);
    expect(page().queryByText("One home for your money.")).toBeNull();

    await waitFor(() => expect(replaceCalls).toEqual(["/?account=signin"]));

    expect(page().queryByRole("heading", { name: "Balances" })).toBeNull();
    expect(page().queryByRole("link", { name: "Add money" })).toBeNull();
    expect(page().queryByRole("navigation", { name: "Main navigation" })).toBeNull();
    expect(page().queryByRole("heading", { name: "Activity" })).toBeNull();
    expect(page().queryByRole("button", { name: "Save" })).toBeNull();
    expect(page().queryByRole("button", { name: "Checking…" })).toBeNull();
    expect(page().getByText("Signed out")).toBeTruthy();
    expect(page().queryByText("Setup in progress")).toBeNull();
    expect(page().queryByText("$12.34")).toBeNull();
    expect(document.body.textContent).not.toContain(ADDRESS);
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
    expect(page().queryByRole("link", { name: "Add money" })).toBeNull();
    expect(page().queryByRole("navigation", { name: "Main navigation" })).toBeNull();

    const retry = await page().findByRole("button", { name: "Retry sign out" });
    fireEvent.click(retry);
    await waitFor(() => expect(signOutCalls).toBe(2));
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
    expect(page().getByText("100.00 IDRX")).toBeTruthy();
    expect(page().queryByText("Euro")).toBeNull();
    expect(page().getAllByText("$0.00").length).toBeGreaterThanOrEqual(1);
    expect(page().getAllByText("R$ 0,00").length).toBeGreaterThanOrEqual(1);
    expect(page().queryByText("USD / USDC")).toBeNull();
    expect(page().queryByText("BRL / BRZ")).toBeNull();
    expect(document.body.textContent).not.toContain("Not available yet");
    expect(page().queryByRole("button", { name: "Save", hidden: false })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Save", current: "page" })).toBeNull();

    const portfolioRequest = requests.find(
      (request) => request.input === "/api/portfolio",
    );
    expect(portfolioRequest).toBeDefined();
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
      new Headers(portfolioRequest?.init?.headers).get(ACCOUNT_PROVIDER_HEADER),
    ).toBe("cdp-embedded");
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
      await page().findByRole("button", { name: "Continue with Base Account" }),
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
        request.input === "/api/portfolio" ||
        String(request.input).startsWith("/api/portfolio/valuation?"),
    );
    expect(authenticatedRequests).toHaveLength(3);
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
            status: "complete",
            transactionHash,
            calls: [{
              to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              data: `0xa9059cbb${ADDRESS_B.slice(2).padStart(64, "0")}${BigInt(1000001).toString(16).padStart(64, "0")}`,
              value: BigInt(0),
            }],
          }) as never,
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
    fireEvent.click(page().getByRole("button", { name: "Continue" }));
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
      ).toHaveLength(3);
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

  test("surfaces an unresolved send after refresh with Check status recover and no second prepare", async () => {
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
      if (input === "/api/actions/operations") return Response.json({ operations: [unresolved] });
      if (input === `/api/actions/${actionId}`) {
        return Response.json({
          operation: { ...unresolved, status: claims > 0 ? "unknown" : "submitting" },
        });
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
    await waitFor(() => expect(page().getByText(/Outcome unknown/)).toBeTruthy());
    expect(claims).toBe(1);
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
    expect(pushCalls).toEqual([
      "/dashboard?account=settings",
      "/dashboard?panel=save",
    ]);

    fireEvent.click(within(tabs).getByRole("button", { name: "Invest" }));
    const invest = page().getByRole("region", { name: "Invest module" });
    expect(invest).toBeTruthy();
    expect(pushCalls).toEqual([
      "/dashboard?account=settings",
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
});
