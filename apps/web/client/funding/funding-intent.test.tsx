import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { clearOwnerQueryBoundary, getHomeQueryClient, ownerQueryKey, ownerQueryMeta } from "@/client/query/query-client";
import { FUNDING_OPEN_ORDER_VERSION } from "@/shared/funding/contracts/open-order";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";
import { FUNDING_PROVIDER_CUSTOMERS_VERSION } from "@/shared/funding/contracts/provider-customers";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { FundingActionsForWallet } = await import("./funding-actions");

const address = "0x1111111111111111111111111111111111111111" as const;
type Wallet = Pick<AccountWalletClient, "ownerKey" | "status" | "verification" | "session" | "fetchAccountResource">;

type VerifiedWallet = Wallet & { session: NonNullable<Wallet["session"]> };

function verifiedWallet(subject = "subject"): VerifiedWallet {
  return {
    ownerKey: subject,
    status: "verified",
    verification: "server",
    session: { user: { subject }, smartAccount: { address, chainId: 8453 }, accountProvider: "base-account" },
    fetchAccountResource: async () => { throw new Error("Missing read fixture"); },
  };
}

const binding = {
  direction: "onramp", providerId: "coinbase", displayName: "Coinbase", region: "US", assetId: "base:usdc",
  assetSymbol: "USDC", assetDecimals: 6, currency: "USD",
  paymentMethods: [{ id: "apple-pay", label: "Apple Pay" }], quotes: true, customerSetup: null,
};

function providersOk(providers: unknown[]) {
  return { version: FUNDING_PROVIDERS_VERSION, direction: "onramp" as const, providers };
}

function customersOk(customers: unknown[]) {
  return { version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers };
}

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
  window.history.replaceState(null, "", "/home");
  document.body.style.overflow = "";
});

test("Add money pointer and focus intent fetch methods once, then open from the owner cache", async () => {
  const paths: string[] = [];
  const wallet: VerifiedWallet = { ...verifiedWallet(), fetchAccountResource: async (path) => {
    paths.push(path);
    if (path.startsWith("/api/funding/providers?")) return providersOk([{ ...binding, customerSetup: { hosted: true } }]);
    if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
    if (path.startsWith("/api/funding/provider-customers?")) return customersOk([]);
    throw new Error(`Unexpected read: ${path}`);
  } };
  const view = render(<FundingActionsForWallet wallet={wallet} regionId="US" />);
  const trigger = view.getByRole("link", { name: "Add money" });
  await act(async () => { fireEvent.pointerDown(trigger); fireEvent.focus(trigger); });
  expect(paths).toEqual([
    "/api/funding/providers?region=US&direction=onramp",
    "/api/funding/orders?region=US",
  ]);
  const owner = dataOwnerKey(wallet.session);
  expect(getHomeQueryClient().getQueryData(ownerQueryKey(owner, "funding-providers", "US", "onramp"))).toBeDefined();
  expect(getHomeQueryClient().getQueryData(ownerQueryKey(owner, "funding-open-order", "US"))).toBeDefined();
  fireEvent.click(trigger);
  await waitFor(() => expect(view.getByRole("dialog", { name: "Add money" }).textContent).toContain("Deposit USD"));
  expect(paths.filter((path) => path.startsWith("/api/funding/providers?"))).toHaveLength(1);
  expect(paths.filter((path) => path.startsWith("/api/funding/orders?"))).toHaveLength(1);
  expect(paths.filter((path) => path.startsWith("/api/funding/provider-customers?"))).toHaveLength(1);
});

test("Add money intent skips signed-out, unresolved and GLOBAL regions", async () => {
  const paths: string[] = [];
  const wallet: Wallet = { ...verifiedWallet(), fetchAccountResource: async (path) => { paths.push(path); return { version: FUNDING_OPEN_ORDER_VERSION, order: null }; } };
  const cases = [
    { wallet: { ...wallet, status: "signed-out" as const, verification: null, session: null, ownerKey: null }, regionId: "US" as const, regionReady: true },
    { wallet, regionId: "US" as const, regionReady: false },
    { wallet, regionId: "GLOBAL" as const, regionReady: true },
  ];
  for (const props of cases) {
    const view = render(<FundingActionsForWallet {...props} />);
    await act(async () => { fireEvent.pointerDown(view.getByRole("link", { name: "Add money" })); });
    expect(paths).toEqual([]);
    view.unmount();
  }
});

test("Add money intent keeps provider and open-order reads separate for every owner and region", async () => {
  const paths: string[] = [];
  const wallet = (subject: string): Wallet => ({ ...verifiedWallet(subject), fetchAccountResource: async (path) => {
    paths.push(`${subject}:${path}`);
    return path.startsWith("/api/funding/orders?") ? { version: FUNDING_OPEN_ORDER_VERSION, order: null } : providersOk([]);
  } });
  const first = wallet("first");
  const second = wallet("second");
  const view = render(<FundingActionsForWallet wallet={first} regionId="US" />);
  const trigger = view.getByRole("link", { name: "Add money" });
  await act(async () => { fireEvent.pointerDown(trigger); });
  view.rerender(<FundingActionsForWallet wallet={first} regionId="AR" />);
  await act(async () => { fireEvent.pointerDown(trigger); });
  view.rerender(<FundingActionsForWallet wallet={second} regionId="AR" />);
  await act(async () => { fireEvent.pointerDown(trigger); });
  expect(paths).toEqual([
    "first:/api/funding/providers?region=US&direction=onramp", "first:/api/funding/orders?region=US",
    "first:/api/funding/providers?region=AR&direction=onramp", "first:/api/funding/orders?region=AR",
    "second:/api/funding/providers?region=AR&direction=onramp", "second:/api/funding/orders?region=AR",
  ]);
  const client = getHomeQueryClient();
  const firstOwner = dataOwnerKey(first.session!);
  const secondOwner = dataOwnerKey(second.session!);
  expect(client.getQueryData(ownerQueryKey(firstOwner, "funding-providers", "US", "onramp"))).toBeDefined();
  expect(client.getQueryData(ownerQueryKey(secondOwner, "funding-providers", "AR", "onramp"))).toBeDefined();
  expect(client.getQueryCache().find({ queryKey: ownerQueryKey(firstOwner, "funding-providers", "US", "onramp") })?.meta).toEqual(ownerQueryMeta(firstOwner));
  expect(client.getQueryCache().find({ queryKey: ownerQueryKey(firstOwner, "funding-open-order", "US") })?.meta).toEqual(ownerQueryMeta(firstOwner));
  clearOwnerQueryBoundary(client, undefined, secondOwner);
  expect(client.getQueryData(ownerQueryKey(firstOwner, "funding-providers", "US", "onramp"))).toBeUndefined();
  expect(client.getQueryData(ownerQueryKey(firstOwner, "funding-open-order", "US"))).toBeUndefined();
  expect(client.getQueryData(ownerQueryKey(secondOwner, "funding-providers", "AR", "onramp"))).toBeDefined();
});

test("a delayed provider read shows loading, then methods without selecting one", async () => {
  const providers = deferred();
  const wallet: Wallet = { ...verifiedWallet(), fetchAccountResource: async (path) =>
    path.startsWith("/api/funding/providers?") ? providers.promise : { version: FUNDING_OPEN_ORDER_VERSION, order: null } };
  const view = render(<FundingActionsForWallet wallet={wallet} regionId="US" />);
  const trigger = view.getByRole("link", { name: "Add money" });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  await waitFor(() => expect(view.getByRole("dialog", { name: "Add money" }).textContent).toContain("Loading deposit methods"));
  expect(view.getByRole("dialog", { name: "Add money" }).textContent).not.toContain("Deposit USD");
  await act(async () => { providers.resolve(providersOk([binding])); await providers.promise; });
  await waitFor(() => expect(view.getByRole("dialog", { name: "Add money" }).textContent).toContain("Deposit USD"));
  expect(view.getByRole("dialog", { name: "Add money" }).textContent).not.toContain("Review deposit");
});

test("a late provider response after close does not reopen or navigate", async () => {
  const providers = deferred();
  const wallet: Wallet = { ...verifiedWallet(), fetchAccountResource: async (path) =>
    path.startsWith("/api/funding/providers?") ? providers.promise : { version: FUNDING_OPEN_ORDER_VERSION, order: null } };
  const view = render(<FundingActionsForWallet wallet={wallet} regionId="US" />);
  fireEvent.pointerDown(view.getByRole("link", { name: "Add money" }));
  fireEvent.click(view.getByRole("link", { name: "Add money" }));
  const close = await waitFor(() => view.getByRole("button", { name: "Close add money" }));
  fireEvent.click(close);
  await act(async () => { providers.resolve(providersOk([binding])); await providers.promise; });
  expect(window.location.search).not.toContain("add-money");
  expect(view.queryByRole("button", { name: /Deposit USD/ })).toBeNull();
});

test("a failed provider read offers in-sheet Retry that fetches methods", async () => {
  const providers = deferred();
  let providerReads = 0;
  const wallet: Wallet = { ...verifiedWallet(), fetchAccountResource: async (path) => {
    if (path.startsWith("/api/funding/providers?")) {
      providerReads += 1;
      return providerReads === 1 ? providers.promise : providersOk([binding]);
    }
    return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
  } };
  const view = render(<FundingActionsForWallet wallet={wallet} regionId="US" />);
  fireEvent.pointerDown(view.getByRole("link", { name: "Add money" }));
  fireEvent.click(view.getByRole("link", { name: "Add money" }));
  await waitFor(() => expect(view.getByRole("status").textContent).toContain("Loading deposit methods"));
  await act(async () => { providers.reject(new Error("Unavailable")); await providers.promise.catch(() => {}); });
  expect((await view.findByRole("alert")).textContent).toContain("Funding methods are unavailable. Try again.");
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(providerReads).toBe(2));
  expect(await view.findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
});
