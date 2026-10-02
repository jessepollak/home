import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useState } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { verifiedLocalCashAssets } from "@/config/portfolio-assets";
import { requiredLocalCashAsset } from "@/shared/balances/fixtures";
import { receiveSupportedCashCurrencies } from "@/shared/funding/assets";
import { FUNDING_OPEN_ORDER_VERSION } from "@/shared/funding/contracts/open-order";
import { FUNDING_QUOTE_VERSION } from "@/shared/funding/contracts/quotes";
import { FUNDING_PROVIDERS_VERSION } from "@/shared/funding/contracts/providers";
import { FUNDING_PROVIDER_CUSTOMERS_VERSION } from "@/shared/funding/contracts/provider-customers";
import { fundingProvidersOptions } from "./funding-prefetch";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { FundingExperienceForWallet: RenderFundingExperienceForWallet } = await import("./funding-experience");
const { shouldPollFundingOrder } = await import("./order-polling");

const ADDRESS_A = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const REDIRECT_URL = "https://checkout.idrx.co/?token=synthetic";
const APPLE_PAY_URL = "https://pay.coinbase.com/embedded/apple-pay";

type FundingWallet = Pick<
  AccountWalletClient,
  "ownerKey" | "status" | "verification" | "session" | "fetchAccountResource"
>;

function FundingExperienceForWallet(props: Parameters<typeof RenderFundingExperienceForWallet>[0]) {
  const fetchAccountResource: FundingWallet["fetchAccountResource"] = async (path, options) => {
    const response = await props.wallet.fetchAccountResource(path, options);
    if (path.startsWith("/api/funding/providers?") && response !== null && typeof response === "object" &&
      !Array.isArray(response) && "providers" in response && Array.isArray(response.providers) && !("version" in response)) {
      return { ...response, version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: response.providers.map((binding) => ({ direction: "onramp", ...binding })) };
    }
    return response;
  };
  return <RenderFundingExperienceForWallet {...props} wallet={{ ...props.wallet, fetchAccountResource }} />;
}

function fundingBinding() {
  return { direction: "onramp" as const, providerId: "ripio", displayName: "Ripio", region: "AR", assetId: "base:wars", assetSymbol: "wARS", assetDecimals: 18, currency: "ARS", paymentMethods: [{ id: "bank_transfer", label: "Bank transfer" }], quotes: true, customerSetup: null };
}

function redirectBinding() {
  return { direction: "onramp" as const, providerId: "idrx", displayName: "IDRX", region: "ID", assetId: "base:idrx", assetSymbol: "IDRX", assetDecimals: 2, currency: "IDR", paymentMethods: [{ id: "qris", label: "QRIS" }], quotes: false, customerSetup: null };
}

function applePayBinding() {
  return { direction: "onramp" as const, providerId: "coinbase", displayName: "Coinbase", region: "US", assetId: "base:usdc", assetSymbol: "USDC", assetDecimals: 6, currency: "USD", paymentMethods: [{ id: "apple-pay", label: "Apple Pay" }], quotes: true, customerSetup: null };
}

function providersOk(providers: unknown[]) {
  return { version: FUNDING_PROVIDERS_VERSION, direction: "onramp" as const, providers };
}

function customersOk(customers: unknown[]) {
  return { version: FUNDING_PROVIDER_CUSTOMERS_VERSION, customers };
}

function applePayOrder(state = "awaiting-payment", url = APPLE_PAY_URL) {
  return { id: "11111111-1111-4111-8111-111111111111", providerId: "coinbase", state, fiatAmount: "25", expectedTokenAmountAtomic: "24500000", fees: [{ label: "Coinbase fee", amount: "0.50", currency: "USD" }], providerStatus: null, instructions: { kind: "embed", url, presentation: "apple-pay", amount: "25.50", currency: "USD" } };
}

function pendingRipioOrder() {
  return { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "awaiting-payment", fiatAmount: "1000", providerStatus: null, instructions: null };
}

function customerBinding() {
  return { ...fundingBinding(), customerSetup: { hosted: true } };
}

function multiMethodBinding() {
  return {
    ...fundingBinding(),
    region: "CO",
    assetId: "base:wcop",
    assetSymbol: "wCOP",
    currency: "COP",
    paymentMethods: [
      { id: "provider", label: "Ripio" },
      { id: "bank_transfer", label: "Bank transfer" },
      { id: "breb", label: "Bre-B" },
      { id: "bancolombia", label: "Bancolombia" },
      { id: "nequi", label: "Nequi" },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function verifiedWallet(address: `0x${string}` = ADDRESS_A): FundingWallet {
  return {
    ownerKey: `owner-${address}`,
    status: "verified",
    verification: "server",
    session: {
      user: { subject: `subject-${address}` },
      smartAccount: { address, chainId: 8453 },
      accountProvider: "base-account",
    },
    fetchAccountResource: async () => {
      throw new Error("funding fixture not configured");
    },
  };
}

function walletOwnerKey(wallet: FundingWallet): string {
  if (!wallet.session) throw new Error("fixture wallet must declare a verified session");
  return dataOwnerKey(wallet.session);
}

function enterAmount(value: string) {
  fireEvent.change(page().getByRole("textbox", { name: "Amount" }), { target: { value } });
}

function restoringWallet(wallet: FundingWallet): FundingWallet {
  return { ...wallet, status: "restoring", verification: null, session: null, ownerKey: null };
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
  window.sessionStorage.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("FundingExperience", () => {
  test("opens Add money on a cold load and hands off to methods with one dialog", async () => {
    const wallet = verifiedWallet();
    const props = { wallet, navigateToRedirect: () => {}, regionId: "US" as const };
    const view = render(<FundingExperienceForWallet {...props} open={false} />);
    view.rerender(<FundingExperienceForWallet {...props} open />);
    expect(await page().findByRole("dialog", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Close add money" })).toBeTruthy();
    expect(await page().findByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    expect(page().getAllByRole("dialog")).toHaveLength(1);
    expect(page().queryByText("Loading")).toBeNull();
  });
  test("mounts an empty live region before announcing loading on cold open", async () => {
    const { MethodBody } = await import("./add-money-dialog");
    const html = renderToStaticMarkup(
      <MethodBody
        onSelectReceive={() => {}}
        providerBindings={[]}
        providersStatus="loading"
        countryName="Germany"
        providerBindingsDisabled={false}
        customerSetupReady={false}
        resumableBinding={() => false}
        fundingReadError={null}
        onSelectBinding={() => {}}
      />,
    );
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector('[role="status"]')?.textContent).toBe("");
    expect(document.querySelector('[aria-busy="true"] [data-shimmer="deposit-method"]')?.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  test.each([{}, { providers: [{ providerId: "partial" }] }, { version: 2, direction: "onramp", providers: [] }])("treats a malformed or partial providers response as a retryable failure, not an empty method list: %p", async (providersResponse) => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersResponse;
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="DE" />);
    expect((await page().findByRole("alert")).textContent).toContain("Funding methods are unavailable. Try again.");
    expect(page().getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(page().queryByText("No local deposit method in Germany yet.")).toBeNull();
  });

  test("rejects a previously persisted malformed providers envelope before showing methods", async () => {
    const wallet = verifiedWallet();
    const owner = dataOwnerKey(wallet.session!);
    getHomeQueryClient().setQueryData(ownerQueryKey(owner, "funding-providers", "DE"), {});
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="DE" />);
    expect((await page().findByRole("alert")).textContent).toContain("Funding methods are unavailable. Try again.");
    expect(page().queryByText("No local deposit method in Germany yet.")).toBeNull();
  });

  test("treats a providers response bound to another region as a retryable failure", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="DE" />);
    expect((await page().findByRole("alert")).textContent).toContain("Funding methods are unavailable. Try again.");
    expect(page().queryByRole("button", { name: /Deposit ARS/ })).toBeNull();
    expect(page().queryByText("No local deposit method in Germany yet.")).toBeNull();
  });

  test("rejects a previously persisted stale providers envelope before showing methods", async () => {
    const wallet = verifiedWallet();
    const owner = dataOwnerKey(wallet.session!);
    getHomeQueryClient().setQueryData(ownerQueryKey(owner, "funding-providers", "DE"), { version: 2, direction: "onramp", providers: [] });
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="DE" />);
    expect((await page().findByRole("alert")).textContent).toContain("Funding methods are unavailable. Try again.");
    expect(page().queryByText("No local deposit method in Germany yet.")).toBeNull();
  });

  test("retries a persisted stale providers envelope into a loaded method list", async () => {
    const ownerWallet = verifiedWallet();
    const owner = dataOwnerKey(ownerWallet.session!);
    getHomeQueryClient().setQueryData(ownerQueryKey(owner, "funding-providers", "AR"), { version: 2, direction: "onramp", providers: [] });
    const wallet = { ...ownerWallet, fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    expect((await page().findByRole("alert")).textContent).toContain("Funding methods are unavailable. Try again.");
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("shows the local deposit empty state only after providers load, without hiding Receive", async () => {
    let resolveProviders!: (value: unknown) => void;
    const providerRead = new Promise<unknown>((resolve) => { resolveProviders = resolve; });
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providerRead;
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="DE" />);
    expect(await page().findByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    expect(page().getByRole("status").textContent).toBe("Loading deposit methods");
    expect(page().queryByText("No local deposit method in Germany yet.")).toBeNull();

    await act(async () => { resolveProviders(providersOk([])); await providerRead; });
    const emptyDescription = await page().findByText("No local deposit method in Germany yet.", { selector: '[data-slot="alert-description"]' });
    expect(emptyDescription.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(page().getAllByText("No local deposit method in Germany yet.").filter((node) => !node.closest('[aria-hidden="true"]'))).toEqual([page().getByRole("status")]);
    expect(page().getByRole("status").textContent).toBe("No local deposit method in Germany yet.");
    expect(page().queryByText("Loading deposit methods")).toBeNull();
    expect(page().getByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    expect(page().queryByRole("button", { name: /Deposit EUR/ })).toBeNull();
  });
  test("reserves a noninteractive deposit row while loading without selecting a method", async () => {
    const providers = deferred<unknown>();
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providers.promise;
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="US" />);

    const receive = await page().findByRole("button", { name: /Receive crypto/ });
    expect(receive.hasAttribute("disabled")).toBe(false);
    expect(page().getByRole("status").textContent).toBe("Loading deposit methods");
    expect(page().getByRole("status").closest('[aria-busy]')).toBeNull();
    expect(page().getByRole("button", { name: /Receive crypto/ }).closest('[aria-busy="true"]')).toBeTruthy();
    expect(page().queryByRole("button", { name: /Deposit USD/ })).toBeNull();
    fireEvent.click(receive);
    expect(page().getByRole("heading", { name: "Receive" })).toBeTruthy();
    expect(page().getAllByRole("dialog")).toHaveLength(1);
    expect(page().getByRole("dialog").contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().getAllByRole("dialog")).toHaveLength(1);
    expect(page().getByRole("dialog").contains(document.activeElement)).toBe(true);

    await act(async () => { providers.resolve(providersOk([applePayBinding()])); await providers.promise; });
    expect(await page().findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    expect(page().queryByText("Loading deposit methods")).toBeNull();
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("status").textContent).toBe("");
  });

  test("reuses the scoped provider cache on reopen during background refetch", async () => {
    const refetch = deferred<unknown>();
    let providerReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) {
        providerReads += 1;
        return providerReads === 1 ? providersOk([applePayBinding()]) : refetch.promise;
      }
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    const props = { wallet, navigateToRedirect: () => {}, regionId: "US" as const };
    const view = render(<FundingExperienceForWallet {...props} open />);
    expect(await page().findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet {...props} open={false} />);
    await getHomeQueryClient().invalidateQueries();
    view.rerender(<FundingExperienceForWallet {...props} open />);
    expect(page().getByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    expect(page().queryByText("Loading deposit methods")).toBeNull();
    await waitFor(() => expect(providerReads).toBe(2));
    expect(page().getByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    await act(async () => { refetch.resolve(providersOk([applePayBinding()])); await refetch.promise; });
  });

  test("keeps valid cached provider rows available with a retry indication after a background refetch fails", async () => {
    const retry = deferred<unknown>();
    const failedRefetch = deferred<void>();
    let providerReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) {
        providerReads += 1;
        if (providerReads === 1) return providersOk([applePayBinding()]);
        if (providerReads === 2) { await failedRefetch.promise; throw new Error("PROVIDERS_UNAVAILABLE"); }
        return retry.promise;
      }
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    const props = { wallet, navigateToRedirect: () => {}, regionId: "US" as const };
    const view = render(<FundingExperienceForWallet {...props} open />);
    expect(await page().findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet {...props} open={false} />);
    await act(async () => { await getHomeQueryClient().invalidateQueries(); });
    view.rerender(<FundingExperienceForWallet {...props} open />);
    await waitFor(() => expect(providerReads).toBe(2));
    const provider = page().getByRole("button", { name: /Deposit USD/ });
    await waitFor(() => expect(provider.hasAttribute("disabled")).toBe(false));
    expect(page().getByRole("status").textContent).toBe("");
    await act(async () => { failedRefetch.resolve(); await failedRefetch.promise; });
    expect((await page().findByRole("alert")).textContent).toContain("Couldn't refresh funding methods. Try again.");
    expect(page().getByRole("button", { name: /Deposit USD/ })).toBe(provider);
    expect(provider.hasAttribute("disabled")).toBe(false);
    expect(page().queryByText("Loading deposit methods")).toBeNull();
    expect(page().queryByText(/No local deposit method/)).toBeNull();
    expect(page().getByRole("button", { name: /Receive crypto/ }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(providerReads).toBe(3));
    expect(page().queryByRole("alert")).toBeNull();
    expect(page().getByRole("status").textContent).toBe("");
    expect(page().getByRole("button", { name: /Deposit USD/ })).toBe(provider);
    expect(provider.hasAttribute("disabled")).toBe(false);
    await act(async () => { retry.resolve(providersOk([applePayBinding()])); await retry.promise; });
    expect(page().getByRole("button", { name: /Deposit USD/ })).toBe(provider);
    expect(page().queryByText("Loading deposit methods")).toBeNull();
  });

  test.each([
    ["empty", providersOk([]), "Couldn't refresh funding methods. Try again."],
    ["malformed", { version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: [{ providerId: "partial" }] }, "Funding methods are unavailable. Try again."],
  ])("a failed refresh of %s cached providers never presents an empty success", async (_state, cached, message) => {
    const wallet = verifiedWallet();
    const providersKey = ownerQueryKey(dataOwnerKey(wallet.session!), "funding-providers", "DE");
    getHomeQueryClient().setQueryData(providersKey, cached);
    await getHomeQueryClient().invalidateQueries({ queryKey: providersKey });
    const fixture = { ...wallet, fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) throw new Error("PROVIDERS_UNAVAILABLE");
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={fixture} navigateToRedirect={() => {}} regionId="DE" />);
    expect((await page().findByRole("alert")).textContent).toContain(message);
    expect(page().queryByText(/No local deposit method/)).toBeNull();
    expect(page().queryByRole("button", { name: /Deposit EUR/ })).toBeNull();
    expect(page().getByRole("button", { name: /Receive crypto/ }).hasAttribute("disabled")).toBe(false);
  });

  test("prioritizes an open-order Retry over a failed provider refresh and gates stale cached orders", async () => {
    const firstOrderRead = deferred<void>();
    const ownerWallet = verifiedWallet();
    const owner = dataOwnerKey(ownerWallet.session!);
    const providersKey = ownerQueryKey(owner, "funding-providers", "US");
    const ordersKey = ownerQueryKey(owner, "funding-open-order", "US");
    getHomeQueryClient().setQueryData(providersKey, providersOk([applePayBinding()]));
    getHomeQueryClient().setQueryData(ordersKey, { version: FUNDING_OPEN_ORDER_VERSION, order: null });
    await getHomeQueryClient().invalidateQueries({ queryKey: providersKey });
    await getHomeQueryClient().invalidateQueries({ queryKey: ordersKey });
    let providerReads = 0;
    let orderReads = 0;
    const wallet = { ...ownerWallet, fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) {
        providerReads += 1;
        if (providerReads === 1) throw new Error("PROVIDERS_UNAVAILABLE");
        return providersOk([applePayBinding()]);
      }
      if (path.startsWith("/api/funding/orders?")) {
        orderReads += 1;
        if (orderReads === 1) { await firstOrderRead.promise; throw new Error("ORDER_UNAVAILABLE"); }
        return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      }
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="US" />);
    const provider = await page().findByRole("button", { name: /Deposit USD/ });
    expect((await page().findByRole("alert")).textContent).toContain("Couldn't refresh funding methods. Try again.");
    await waitFor(() => expect(orderReads).toBe(1));
    expect(provider.hasAttribute("disabled")).toBe(true);
    fireEvent.click(provider);
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    await act(async () => { firstOrderRead.resolve(); await firstOrderRead.promise; });
    expect((await page().findByRole("alert")).textContent).toContain("Home couldn't check for an open deposit. Retry.");
    expect(provider.hasAttribute("disabled")).toBe(true);
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(orderReads).toBe(2));
    await waitFor(() => expect(provider.hasAttribute("disabled")).toBe(false));
    expect(page().getByRole("alert").textContent).toContain("Couldn't refresh funding methods. Try again.");
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(providerReads).toBe(2));
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("prioritizes provider-setup Retry while ordinary rows stay usable after a failed provider refresh", async () => {
    const firstCustomerRead = deferred<void>();
    const ownerWallet = verifiedWallet();
    const owner = dataOwnerKey(ownerWallet.session!);
    const providersKey = ownerQueryKey(owner, "funding-providers", "AR");
    const customersKey = ownerQueryKey(owner, "funding-provider-customers", "AR");
    let providerReads = 0;
    let customerReads = 0;
    const setupBinding = { ...customerBinding(), providerId: "setup", assetId: "base:usdc", currency: "USD" };
    getHomeQueryClient().setQueryData(providersKey, providersOk([fundingBinding(), setupBinding]));
    getHomeQueryClient().setQueryData(customersKey, customersOk([]));
    await getHomeQueryClient().invalidateQueries({ queryKey: providersKey });
    await getHomeQueryClient().invalidateQueries({ queryKey: customersKey });
    const wallet = { ...ownerWallet, fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) {
        providerReads += 1;
        if (providerReads === 1) throw new Error("PROVIDERS_UNAVAILABLE");
        return providersOk([fundingBinding(), setupBinding]);
      }
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path.startsWith("/api/funding/provider-customers?")) {
        customerReads += 1;
        if (customerReads === 1) { await firstCustomerRead.promise; throw new Error("CUSTOMERS_UNAVAILABLE"); }
        return customersOk([]);
      }
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const ordinary = await page().findByRole("button", { name: /Deposit ARS/ });
    const setup = page().getByRole("button", { name: /Deposit USD/ });
    expect((await page().findByRole("alert")).textContent).toContain("Couldn't refresh funding methods. Try again.");
    await waitFor(() => expect(customerReads).toBe(1));
    await waitFor(() => expect(ordinary.hasAttribute("disabled")).toBe(false));
    expect(setup.hasAttribute("disabled")).toBe(true);
    await act(async () => { firstCustomerRead.resolve(); await firstCustomerRead.promise; });
    expect((await page().findByRole("alert")).textContent).toContain("Home couldn't check your provider setup. Retry.");
    expect(ordinary.hasAttribute("disabled")).toBe(false);
    expect(setup.hasAttribute("disabled")).toBe(true);
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(customerReads).toBe(2));
    await waitFor(() => expect(setup.hasAttribute("disabled")).toBe(false));
    expect(page().getByRole("alert").textContent).toContain("Couldn't refresh funding methods. Try again.");
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(providerReads).toBe(2));
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("a late provider retry cannot display cached rows or errors from the previous region", async () => {
    const retry = deferred<unknown>();
    const indonesia = deferred<unknown>();
    let usReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?region=US")) {
        usReads += 1;
        if (usReads === 1) return providersOk([applePayBinding()]);
        if (usReads === 2) throw new Error("PROVIDERS_UNAVAILABLE");
        return retry.promise;
      }
      if (path.startsWith("/api/funding/providers?region=ID")) return indonesia.promise;
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    const props = { wallet, navigateToRedirect: () => {} };
    const view = render(<FundingExperienceForWallet {...props} regionId="US" />);
    expect(await page().findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet {...props} regionId="US" open={false} />);
    await act(async () => { await getHomeQueryClient().invalidateQueries(); });
    view.rerender(<FundingExperienceForWallet {...props} regionId="US" />);
    expect((await page().findByRole("alert")).textContent).toContain("Couldn't refresh funding methods. Try again.");
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(usReads).toBe(3));
    view.rerender(<FundingExperienceForWallet {...props} regionId="ID" />);
    expect(page().queryByRole("button", { name: /Deposit USD/ })).toBeNull();
    expect(page().queryByRole("alert")).toBeNull();
    expect(page().getByRole("status").textContent).toBe("Loading deposit methods");
    await act(async () => { retry.resolve(providersOk([applePayBinding()])); await retry.promise; });
    expect(page().queryByRole("button", { name: /Deposit USD/ })).toBeNull();
    expect(page().getByRole("status").textContent).toBe("Loading deposit methods");
    await act(async () => { indonesia.resolve(providersOk([redirectBinding()])); await indonesia.promise; });
    expect(await page().findByRole("button", { name: /Deposit IDR/ })).toBeTruthy();
  });

  test("a late provider retry cannot display cached rows or errors after an account switch", async () => {
    const retry = deferred<unknown>();
    const secondAccount = deferred<unknown>();
    let firstAccountReads = 0;
    const walletA = { ...verifiedWallet(ADDRESS_A), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) {
        firstAccountReads += 1;
        if (firstAccountReads === 1) return providersOk([applePayBinding()]);
        if (firstAccountReads === 2) throw new Error("PROVIDERS_UNAVAILABLE");
        return retry.promise;
      }
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    const walletB = { ...verifiedWallet(ADDRESS_B), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return secondAccount.promise;
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    const props = { navigateToRedirect: () => {}, regionId: "US" as const };
    const view = render(<FundingExperienceForWallet {...props} wallet={walletA} />);
    expect(await page().findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet {...props} wallet={walletA} open={false} />);
    await act(async () => { await getHomeQueryClient().invalidateQueries(); });
    view.rerender(<FundingExperienceForWallet {...props} wallet={walletA} />);
    expect((await page().findByRole("alert")).textContent).toContain("Couldn't refresh funding methods. Try again.");
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(firstAccountReads).toBe(3));
    view.rerender(<FundingExperienceForWallet {...props} wallet={walletB} />);
    expect(page().queryByRole("button", { name: /Deposit USD/ })).toBeNull();
    expect(page().queryByRole("alert")).toBeNull();
    expect(page().getByRole("status").textContent).toBe("Loading deposit methods");
    await act(async () => { retry.resolve(providersOk([applePayBinding()])); await retry.promise; });
    expect(page().queryByRole("button", { name: /Deposit USD/ })).toBeNull();
    expect(page().queryByRole("alert")).toBeNull();
    await act(async () => { secondAccount.resolve(providersOk([])); await secondAccount.promise; });
    expect((await page().findByRole("status")).textContent).toBe("No local deposit method in United States yet.");
  });

  test("replaces a provider failure with the loading row during retry", async () => {
    const retry = deferred<unknown>();
    let providerReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) {
        providerReads += 1;
        if (providerReads === 1) throw new Error("PROVIDERS_UNAVAILABLE");
        return retry.promise;
      }
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="US" />);
    expect((await page().findByRole("alert")).textContent).toContain("Funding methods are unavailable. Try again.");
    expect(page().queryByText("Loading deposit methods")).toBeNull();
    const status = page().getByRole("status");
    expect(status.textContent).toBe("");
    expect(status.closest('[aria-busy]')).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(providerReads).toBe(2));
    expect(page().queryByRole("alert")).toBeNull();
    expect(page().getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Loading deposit methods");
    await act(async () => { retry.resolve(providersOk([applePayBinding()])); await retry.promise; });
    expect(await page().findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    expect(page().queryByText("Loading deposit methods")).toBeNull();
  });

  test("does not reuse a previous region's provider row", async () => {
    const indonesia = deferred<unknown>();
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?region=US")) return providersOk([applePayBinding()]);
      if (path.startsWith("/api/funding/providers?region=ID")) return indonesia.promise;
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    const view = render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="US" />);
    expect(await page().findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="ID" />);
    expect(page().getByRole("status").textContent).toBe("Loading deposit methods");
    expect(page().queryByRole("button", { name: /Deposit USD/ })).toBeNull();
    await act(async () => { indonesia.resolve(providersOk([redirectBinding()])); await indonesia.promise; });
    expect(await page().findByRole("button", { name: /Deposit IDR/ })).toBeTruthy();
  });

  test("does not reuse a previous account's provider row", async () => {
    const secondAccount = deferred<unknown>();
    const walletA = { ...verifiedWallet(ADDRESS_A), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([applePayBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    const walletB = { ...verifiedWallet(ADDRESS_B), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return secondAccount.promise;
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error("unexpected request");
    } };
    const view = render(<FundingExperienceForWallet wallet={walletA} navigateToRedirect={() => {}} regionId="US" />);
    expect(await page().findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet wallet={walletB} navigateToRedirect={() => {}} regionId="US" />);
    expect(page().getByRole("status").textContent).toBe("Loading deposit methods");
    expect(page().queryByRole("button", { name: /Deposit USD/ })).toBeNull();
    await act(async () => { secondAccount.resolve(providersOk([applePayBinding()])); await secondAccount.promise; });
    expect(await page().findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
  });

  test("omits the loading row when the region has no provider query", async () => {
    render(<FundingExperienceForWallet wallet={verifiedWallet()} navigateToRedirect={() => {}} regionId="GLOBAL" />);
    expect(await page().findByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    expect(page().queryByText("Loading deposit methods")).toBeNull();
    expect(page().queryByText(/No local deposit method/)).toBeNull();
  });

  test("does not present a disabled regional candidate as receive support", async () => {
    await act(async () => {
      render(
        <FundingExperienceForWallet
          wallet={verifiedWallet()}
          navigateToRedirect={() => {}}
          initialStep="receive"
          regionId="BR"
        />,
      );
    });

    expect(await page().findByRole("heading", { name: "Receive" })).toBeTruthy();
    const supportedAssets = page().getByRole("region", {
      name: "Supported receive assets on Base",
    });
    expect(requiredLocalCashAsset("BRL").symbol).toBe("wBRL");
    expect(supportedAssets.textContent).toContain("USDC");
    expect(supportedAssets.textContent).not.toContain("wBRL");
  });

  test.each([
    ["DE", "EURC"],
    ["ID", "IDRX"],
  ] as const)("presents admitted %s receive asset %s", async (regionId, symbol) => {
    await act(async () => {
      render(
        <FundingExperienceForWallet
          wallet={verifiedWallet()}
          navigateToRedirect={() => {}}
          initialStep="receive"
          regionId={regionId}
        />,
      );
    });
    const supportedAssets = page().getByRole("region", {
      name: "Supported receive assets on Base",
    });
    expect(supportedAssets.textContent).toContain("USDC");
    expect(supportedAssets.textContent).toContain(symbol);
  });

  test("admits only receive currencies with verified display identities", () => {
    for (const currency of receiveSupportedCashCurrencies) {
      expect(Object.hasOwn(verifiedLocalCashAssets, currency)).toBe(true);
    }
  });

  test("keeps provider bindings visible and disabled until a failed open-order read is retried", async () => {
    let orderReads = 0;
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) {
          return providersOk([redirectBinding()]);
        }
        if (path.startsWith("/api/funding/orders?")) {
          orderReads += 1;
          if (orderReads === 1) throw new Error("ORDER_UNAVAILABLE");
          return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        }
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={() => {}}
        regionId="ID"
      />,
    );

    const provider = await page().findByRole("button", {
      name: /Deposit IDR/,
    });
    expect(provider.hasAttribute("disabled")).toBe(true);
    expect(page().getByRole("alert").textContent).toContain(
      "Home couldn't check for an open deposit. Retry.",
    );

    fireEvent.click(page().getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(orderReads).toBe(2));
    await waitFor(() => expect(provider.hasAttribute("disabled")).toBe(false));
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("treats a malformed orders response as a retryable failure, not no open order", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([redirectBinding()]);
      if (path.startsWith("/api/funding/orders?")) return {};
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="ID" />);
    const provider = await page().findByRole("button", { name: /Deposit IDR/ });
    expect(provider.hasAttribute("disabled")).toBe(true);
    expect(page().getByRole("alert").textContent).toContain("Home couldn't check for an open deposit. Retry.");
    expect(page().getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test("treats another region's open order as a retryable failure, not no open deposit", async () => {
    let orderReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([redirectBinding()]);
      if (path.startsWith("/api/funding/orders?")) {
        orderReads += 1;
        return orderReads === 1 ? { version: FUNDING_OPEN_ORDER_VERSION, order: { ...pendingRipioOrder(), region: "BR" } } : { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      }
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="ID" />);
    const provider = await page().findByRole("button", { name: /Deposit IDR/ });
    expect(provider.hasAttribute("disabled")).toBe(true);
    expect(page().getByRole("alert").textContent).toContain("Home couldn't check for an open deposit. Retry.");
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(orderReads).toBe(2));
    await waitFor(() => expect(provider.hasAttribute("disabled")).toBe(false));
    expect(page().queryByRole("alert")).toBeNull();
  });

  test.each([{ order: null }, { version: 2, order: null }, { version: FUNDING_OPEN_ORDER_VERSION, order: { id: "incomplete" } }])(
    "keeps a malformed region-wide open-order response retryable: %#", async (malformed) => {
      let orderReads = 0;
      const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers?")) return providersOk([redirectBinding()]);
        if (path.startsWith("/api/funding/orders?")) return ++orderReads === 1 ? malformed : { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        throw new Error(`unexpected request: ${path}`);
      } };
      render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="ID" />);
      const provider = await page().findByRole("button", { name: /Deposit IDR/ });
      await waitFor(() => expect(page().getByRole("alert").textContent).toContain("Home couldn't check for an open deposit. Retry."));
      expect(provider.hasAttribute("disabled")).toBe(true);
      expect(getHomeQueryClient().getQueryData(ownerQueryKey(walletOwnerKey(wallet), "funding-open-order", "ID"))).toBeUndefined();
      fireEvent.click(page().getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(orderReads).toBe(2));
      await waitFor(() => expect(provider.hasAttribute("disabled")).toBe(false));
      expect(page().queryByRole("alert")).toBeNull();
    },
  );

  test("hides an open-order read error when there are no provider bindings", async () => {
    let orderReads = 0;
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([]);
        if (path.startsWith("/api/funding/orders?")) {
          orderReads += 1;
          throw new Error("ORDER_UNAVAILABLE");
        }
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={() => {}}
        regionId="AR"
      />,
    );

    const receive = await page().findByRole("button", { name: /Receive crypto/ });
    await waitFor(() => expect(orderReads).toBe(1));
    expect(receive.hasAttribute("disabled")).toBe(false);
    expect(page().queryByRole("alert")).toBeNull();
    expect(await page().findByText("No local deposit method in Argentina yet.", { selector: '[data-slot="alert-description"]' })).toBeTruthy();
    expect(page().getByRole("status").textContent).toBe("No local deposit method in Argentina yet.");
  });

  test("keeps a provider-list failure visible for retry", async () => {
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) {
          throw new Error("PROVIDERS_UNAVAILABLE");
        }
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={() => {}}
        regionId="AR"
      />,
    );

    expect((await page().findByRole("alert")).textContent).toContain(
      "Funding methods are unavailable. Try again.",
    );
    expect(page().getByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    expect(page().getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(page().queryByText(/No local deposit method/)).toBeNull();
  });

  test("rejects an unversioned providers envelope before caching it", async () => {
    const owner = walletOwnerKey(verifiedWallet());
    const queryClient = getHomeQueryClient();
    await expect(queryClient.fetchQuery(fundingProvidersOptions(owner, "US", async () => ({ providers: [] }))))
      .rejects.toThrow("Invalid funding providers response");
    expect(queryClient.getQueryData(ownerQueryKey(owner, "funding-providers", "US"))).toBeUndefined();
  });

  test.each([
    ["unsupported version", { version: 4, direction: "onramp", providers: [applePayBinding()] }],
    ["unsupported direction", { version: FUNDING_PROVIDERS_VERSION, direction: "invalid", providers: [] }],
    ["missing direction", { version: FUNDING_PROVIDERS_VERSION, providers: [] }],
    ["mismatched direction", { version: FUNDING_PROVIDERS_VERSION, direction: "offramp", providers: [] }],
    ["mismatched entry direction", providersOk([applePayBinding(), { ...applePayBinding(), direction: "offramp", quotes: false, paymentMethods: [] }])],
    ["malformed entry among valid providers", providersOk([applePayBinding(), {}])],
    ["missing provider list", { version: FUNDING_PROVIDERS_VERSION, direction: "onramp", providers: null }],
    ["non-object response", "invalid"],
  ] as const)("offers retry instead of empty methods for %s", async (_label, invalid) => {
    let reads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) {
        reads += 1;
        return reads === 1 ? invalid : providersOk([applePayBinding()]);
      }
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="US" />);
    expect((await page().findByRole("alert")).textContent).toContain("Funding methods are unavailable. Try again.");
    expect(page().queryByText(/No local deposit method/)).toBeNull();
    expect(page().queryByRole("button", { name: /Deposit USD/ })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(await page().findByRole("button", { name: /Deposit USD/ })).toBeTruthy();
    expect(reads).toBe(2);
  });

  test("derives provider row copy from the binding and summarizes extra methods", async () => {
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([multiMethodBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        throw new Error("unexpected request");
      },
    };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="CO" />);

    const provider = await page().findByRole("button", { name: /Deposit COP/ });
    expect(provider.textContent).toContain("Deposit COP");
    expect(provider.textContent).toContain("Ripio · Bank transfer · Bre-B · +2");
    expect(provider.textContent?.match(/Ripio/g)).toHaveLength(1);
    expect(provider.textContent).not.toContain("Deposit COP with Ripio");
  });

  test("Enter requests one quote from the fiat amount field, which rejects a third decimal and locks during the request", async () => {
    const quoteBodies: unknown[] = [];
    let resolveQuote!: (value: unknown) => void;
    const pendingQuote = new Promise<unknown>((resolve) => { resolveQuote = resolve; });
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string, options?: { body?: unknown }) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([redirectBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        if (path === "/api/funding/quotes") {
          quoteBodies.push(options?.body);
          return pendingQuote;
        }
        throw new Error("unexpected request");
      },
    };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="ID" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit IDR/ }));
    const field = page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
    const review = page().getByRole("button", { name: "Review quote" });
    expect(review.hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(quoteBodies).toHaveLength(0);

    enterAmount("20000.12");
    expect(field.value).toBe("20000.12");
    enterAmount("20000.123");
    expect(field.value).toBe("20000.12");
    enterAmount("20000");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(quoteBodies).toHaveLength(1));
    expect(quoteBodies).toEqual([{
      providerId: "idrx", region: "ID", paymentMethod: "qris", fiatAmount: "20000",
    }]);
    expect(field.disabled).toBe(true);
    expect(review.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      resolveQuote({
        version: FUNDING_QUOTE_VERSION,
        quoteToken: "signed-token",
        quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      });
      await pendingQuote;
    });
    expect(await page().findByRole("heading", { name: "Review quote" })).toBeTruthy();
    expect(quoteBodies).toHaveLength(1);
  });

  test("Add money review Back returns to the amount and X exits the flow", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([redirectBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path === "/api/funding/quotes") return { version: FUNDING_QUOTE_VERSION, quoteToken: "signed-token", quote: {
        fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z",
      } };
      throw new Error("unexpected request");
    } };
    let closes = 0;
    function Journey() {
      const [open, setOpen] = useState(true);
      return <FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="ID"
        open={open} onClose={() => { closes++; setOpen(false); }} />;
    }
    render(<Journey />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit IDR/ }));
    enterAmount("20000");
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    expect(page().getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect((page().getByRole("textbox", { name: "Amount" }) as HTMLInputElement).value).toBe("20000");
    expect(page().getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    fireEvent.click(page().getByRole("button", { name: "Close add money" }));
    await waitFor(() => expect(page().queryByRole("dialog") === null).toBe(true));
    expect(closes).toBe(1);
  });

  test("drops a selected region's funding flow and uses the new region for the next order", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string, options?: { body?: unknown }) => {
      requests.push({ path, body: options?.body });
      if (path.startsWith("/api/funding/providers")) return providersOk(path.includes("region=AR") ? [fundingBinding()] : [redirectBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path === "/api/funding/quotes") return { version: FUNDING_QUOTE_VERSION, quoteToken: "id-token", quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" } };
      if (path === "/api/funding/orders") return { order: { id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", state: "awaiting-payment", fiatAmount: "20000", expectedTokenAmountAtomic: "2000000", fees: [], providerStatus: null, instructions: { kind: "redirect", url: REDIRECT_URL } } };
      throw new Error("unexpected request");
    } };
    const view = render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect(page().getByRole("heading", { name: "Deposit ARS" })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="ID" />);
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Deposit ARS" })).toBeNull();
    fireEvent.click(await page().findByRole("button", { name: /Deposit IDR/ }));
    enterAmount("20000");
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    expect(requests.find((request) => request.path === "/api/funding/quotes")?.body).toEqual({ providerId: "idrx", region: "ID", paymentMethod: "qris", fiatAmount: "20000" });
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await waitFor(() => expect(requests.find((request) => request.path === "/api/funding/orders")?.body).toEqual({ quoteToken: "id-token" }));
  });

  test("lists configured provider bindings and creates an order with only the quote token", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string, options?: { body?: unknown }) => {
        requests.push({ path, body: options?.body });
        if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        if (path === "/api/funding/quotes") return { version: FUNDING_QUOTE_VERSION, quoteToken: "signed-token", quote: { fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [{ label: "Rail", amount: "10", currency: "ARS" }], expiresAt: "2099-01-01T00:00:00.000Z" } };
        if (path === "/api/funding/orders") return { order: { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "awaiting-payment", fiatAmount: "1000", expectedTokenAmountAtomic: "1000000000000000000000", fees: [{ label: "Provider", amount: "12", currency: "ARS" }], providerStatus: null, instructions: { kind: "bank-transfer", rail: "CVU", accountNumber: "1234567890", amount: "1012", currency: "ARS" } } };
        throw new Error("unexpected request");
      },
    };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const provider = await page().findByRole("button", { name: /Deposit ARS/ });
    fireEvent.click(provider);
    expect(page().getByRole("dialog", { name: "Deposit ARS" })).toBeTruthy();
    enterAmount("1000");
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    expect(page().queryByText("Sandbox — not a real deposit")).toBeNull();
    expect(page().getByText("Receive").parentElement?.textContent).toContain("1.000,00\u00A0wARS");
    expect(page().getByText("Rail").parentElement?.textContent).toContain("$10,00");
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByRole("heading", { name: "Review payment details" });
    expect(page().getByText("You pay").parentElement?.textContent).toContain("$1.012,00");
    expect(page().getByText("Provider").parentElement?.textContent).toContain("$12,00");
    expect(page().queryByText("1234567890")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
    await page().findByText("Deposit pending");
    expect(page().queryByText("Sandbox — not a real deposit")).toBeNull();
    expect(page().getByText("1234567890")).toBeTruthy();
    expect(requests.find((item) => item.path === "/api/funding/orders")?.body).toEqual({ quoteToken: "signed-token" });
    expect(getHomeQueryClient().getQueryData<{ version: typeof FUNDING_OPEN_ORDER_VERSION; order: unknown }>(ownerQueryKey(dataOwnerKey(wallet.session!), "funding-open-order", "AR"))).toEqual({
      version: FUNDING_OPEN_ORDER_VERSION,
      order: {
        id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "awaiting-payment", fiatAmount: "1000",
        expectedTokenAmountAtomic: "1000000000000000000000",
        fees: [{ label: "Provider", amount: "12", currency: "ARS" }],
        providerStatus: null,
        instructions: { kind: "bank-transfer", rail: "CVU", accountNumber: "1234567890", amount: "1012", currency: "ARS" },
      },
    });
  });

  test("shows the sandbox badge on all three review and status screens", async () => {
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        if (path === "/api/funding/quotes") return { version: FUNDING_QUOTE_VERSION, sandbox: true, quoteToken: "sandbox-token", quote: { fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" } };
        if (path === "/api/funding/orders") return { order: { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", sandbox: true, state: "awaiting-payment", fiatAmount: "1000", expectedTokenAmountAtomic: "1000000000000000000000", fees: [], providerStatus: null, instructions: { kind: "bank-transfer", rail: "CVU", accountNumber: "1234567890", amount: "1000", currency: "ARS" } } };
        throw new Error("unexpected request");
      },
    };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    enterAmount("1000");
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    expect(page().getAllByText("Sandbox — not a real deposit")).toHaveLength(1);
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByRole("heading", { name: "Review payment details" });
    expect(page().getAllByText("Sandbox — not a real deposit")).toHaveLength(1);
    fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
    await page().findByText("Deposit pending");
    expect(page().getAllByText("Sandbox — not a real deposit")).toHaveLength(1);
  });

  test("stops polling sandbox sent-unverified orders but continues for live orders", () => {
    expect(shouldPollFundingOrder({ state: "sent-unverified", sandbox: true })).toBe(false);
    expect(shouldPollFundingOrder({ state: "sent-unverified", sandbox: false })).toBe(true);
    expect(shouldPollFundingOrder({ state: "awaiting-payment", sandbox: true })).toBe(true);
  });

  test("shows sandbox sent-unverified as complete without polling", async () => {
    let statusCalls = 0;
    const order = { id: "11111111-1111-4111-8111-111111111111", providerId: "coinbase", sandbox: true, state: "sent-unverified", fiatAmount: "5", expectedTokenAmountAtomic: "4880000", fees: [{ label: "Coinbase fee", amount: "0.12", currency: "USD" }], providerStatus: "ONRAMP_ORDER_STATUS_COMPLETED", instructions: { kind: "embed", url: APPLE_PAY_URL, presentation: "apple-pay", amount: "5", currency: "USD" } };
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([applePayBinding()]);
        if (path.includes("/api/funding/orders/11111111")) { statusCalls += 1; return { order }; }
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order };
        throw new Error("unexpected request");
      },
    };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromVerification regionId="US" />);
    expect(await page().findByRole("heading", { name: "Sandbox complete — no real funds moved" })).toBeTruthy();
    expect(page().queryByText("ONRAMP_ORDER_STATUS_COMPLETED")).toBeNull();
    expect(document.body.textContent).not.toContain("ONRAMP_ORDER_STATUS_COMPLETED");
    expect(page().getAllByText("Sandbox — not a real deposit")).toHaveLength(1);
    expect(statusCalls).toBe(0);
  });

  test.each([
    ["ONRAMP_ORDER_STATUS_PENDING_PAYMENT", "awaiting-payment", "Deposit pending"],
    ["HTTP_503", "failed", "Deposit not completed"],
    ["AUTHORIZATION_ERROR", "failed", "Deposit not completed"],
  ])("hides raw provider status %s on a resumed %s order", async (providerStatus, state, title) => {
    const order = { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state, fiatAmount: "1000", providerStatus, instructions: null };
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order };
        if (path.startsWith("/api/funding/orders")) return { order };
        throw new Error("unexpected request");
      },
    };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromVerification regionId="AR" />);
    expect(await page().findByRole("heading", { name: title })).toBeTruthy();
    expect(page().queryByText(providerStatus)).toBeNull();
    expect(page().queryByText(`Status: ${providerStatus}`)).toBeNull();
    expect(document.body.textContent).not.toContain(providerStatus);
  });

  test("retries a lost order response with the exact original quote token", async () => {
    let quoteCalls = 0;
    const orderBodies: unknown[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string, options?: { body?: unknown }) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path === "/api/funding/quotes") { quoteCalls += 1; return { version: FUNDING_QUOTE_VERSION, quoteToken: "original-signed-token", quote: { fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" } }; }
      if (path === "/api/funding/orders") { orderBodies.push(options?.body); if (orderBodies.length === 1) throw new Error("lost response"); return { order: { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "dispatch-ambiguous", fiatAmount: "1000", providerStatus: null, instructions: null } }; }
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    enterAmount("1000");
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByRole("alert");
    expect(page().getByRole("button", { name: "Back" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByText("Don't try again yet");
    await page().findByText(
      "Home is waiting to learn whether the provider created this deposit, and will not send it again. You can clear this order 24 hours after its quote expires.",
    );
    expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Clear old order" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Close add money" })).toBeTruthy();
    expect(quoteCalls).toBe(1);
    expect(orderBodies).toEqual([{ quoteToken: "original-signed-token" }, { quoteToken: "original-signed-token" }]);

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByText("Don't try again yet")).toBeTruthy();
    expect(quoteCalls).toBe(1);
    expect(orderBodies).toEqual([{ quoteToken: "original-signed-token" }, { quoteToken: "original-signed-token" }]);
  });

  test("shows typed create conflicts instead of generic retry copy", async () => {
    for (const [code, message] of [
      ["AMBIGUOUS_ORDER_OPEN", "Home is still waiting on an earlier deposit. Close and reopen Add money, then continue it; no new provider request was created."],
      ["ORDER_STATE_CHANGED", "This deposit changed while Home was confirming it. Close and reopen Add money to check the existing order before trying again."],
    ] as const) {
      const wallet = {
        ...verifiedWallet(),
        fetchAccountResource: async (path: string) => {
          if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
          if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
          if (path === "/api/funding/quotes") return { version: FUNDING_QUOTE_VERSION, quoteToken: "signed-token", quote: { fiatAmount: "1000", tokenAmountAtomic: "1000000000000000000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" } };
          if (path === "/api/funding/orders") throw Object.assign(new Error(code), { code });
          throw new Error("unexpected request");
        },
      };

      const view = render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
      fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
      enterAmount("1000");
      fireEvent.click(page().getByRole("button", { name: "Review quote" }));
      fireEvent.click(await page().findByRole("button", { name: "Confirm deposit" }));
      expect((await page().findByRole("alert")).textContent).toContain(message);
      view.unmount();
      getHomeQueryClient().clear();
    }
  });

  test("clears an eligible resumed ambiguous order, refetches remaining open orders, and Back returns to funding methods", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const ambiguous = { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "dispatch-ambiguous", fiatAmount: "1000", providerStatus: null, instructions: null };
    const resolved = { ...ambiguous, state: "cancelled" };
    let cleared = false;
    let openOrderReads = 0;
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string, options?: { body?: unknown }) => {
        requests.push({ path, body: options?.body });
        if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
        if (path.startsWith("/api/funding/orders?")) {
          openOrderReads += 1;
          return { version: FUNDING_OPEN_ORDER_VERSION, order: cleared ? { ...ambiguous, id: "22222222-2222-4222-8222-222222222222", state: "awaiting-payment" } : ambiguous };
        }
        if (path.endsWith("/resolve")) { cleared = true; return { version: 1, order: resolved }; }
        throw new Error("unexpected request");
      },
    };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect(page().getByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start new deposit" })).toBeNull();
    expect(page().getByText("Home can't confirm this deposit yet. Continue to check it before starting another.")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    await page().findByText("Don't try again yet");
    expect(page().getByRole("button", { name: "Back" })).toBeTruthy();
    expect(page().getByText(/Home is waiting to learn whether the provider created this deposit/)).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Clear old order" }));
    await page().findByText("Order cleared");
    expect(requests.find((request) => request.path.endsWith("/resolve"))).toEqual({
      path: "/api/funding/orders/11111111-1111-4111-8111-111111111111/resolve",
      body: { version: 1 },
    });
    await waitFor(() => expect(openOrderReads).toBe(2));
    expect(page().getByText("Order cleared")).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(await page().findByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    expect(page().queryByText("Don't try again yet")).toBeNull();

    fireEvent.click(page().getByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(page().queryByRole("button", { name: "Review quote" })).toBeNull();
    expect(requests.some((request) => request.path === "/api/funding/quotes" || request.path === "/api/funding/orders")).toBe(false);
  });

  test("a resume-only binding fetches its own older order and offers Continue but no new deposit", async () => {
    const paused = { ...fundingBinding(), resumeOnly: true, customerSetup: { hosted: true } };
    const newerBinding = { ...fundingBinding(), providerId: "newer", currency: "USD", assetId: "base:usdc" };
    const olderOrder = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer", fiatAmount: "1000" };
    const newerOrder = { ...pendingRipioOrder(), id: "22222222-2222-4222-8222-222222222222", providerId: "newer" };
    const requests: string[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk([paused, newerBinding]);
      if (path === "/api/funding/orders?region=AR") return { version: FUNDING_OPEN_ORDER_VERSION, order: newerOrder };
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(paused.assetId)}`) return { version: FUNDING_OPEN_ORDER_VERSION, order: olderOrder };
      if (path === `/api/funding/orders/${olderOrder.id}`) return { order: olderOrder };
      if (path.startsWith("/api/funding/provider-customers?")) throw new Error("customer read unavailable");
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const pausedButton = await page().findByRole("button", { name: /Deposit ARS/ });
    await waitFor(() => expect(page().getByRole("alert").textContent).toContain("Home couldn't check your provider setup. Retry."));
    expect(pausedButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(pausedButton);
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start new deposit" })).toBeNull();
    expect(requests).toContain(`/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(paused.assetId)}`);
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(requests).not.toContain("/api/funding/quotes");
    expect(requests).not.toContain("/api/funding/orders");
  });

  test("a resume-only binding with several methods finds an order on a non-first method", async () => {
    const binding = { ...fundingBinding(), resumeOnly: true, paymentMethods: [
      { id: "provider", label: "Ripio" }, { id: "bank_transfer", label: "Bank transfer" },
    ] };
    const older = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer" };
    const requests: string[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk([binding]);
      if (path === "/api/funding/orders?region=AR") return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=provider&assetId=${encodeURIComponent(binding.assetId)}`) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(binding.assetId)}`) return { version: FUNDING_OPEN_ORDER_VERSION, order: older };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start new deposit" })).toBeNull();
    expect(requests).toContain(`/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(binding.assetId)}`);
  });

  test("a scoped response for another method, with or without a version, stays retryable", async () => {
    const paused = { ...fundingBinding(), resumeOnly: true };
    const wrongMethod = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "card" };
    const correct = { ...wrongMethod, paymentMethod: "bank_transfer" };
    let providerReads = 0;
    let scopedReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) { providerReads += 1; return providersOk([paused]); }
      if (path === "/api/funding/orders?region=AR") return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(paused.assetId)}`) {
        scopedReads += 1;
        if (scopedReads === 1) return { version: FUNDING_OPEN_ORDER_VERSION, order: wrongMethod };
        if (scopedReads === 2) return { order: wrongMethod };
        return { version: FUNDING_OPEN_ORDER_VERSION, order: correct };
      }
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    for (const read of [1, 2]) {
      expect((await page().findByRole("alert")).textContent).toContain("Home couldn't check your open deposit. Retry.");
      expect(scopedReads).toBe(read);
      expect(page().getByRole("button", { name: /Deposit ARS/ }).hasAttribute("disabled")).toBe(false);
      expect(page().queryByRole("heading", { name: "You have an open deposit" })).toBeNull();
      expect(providerReads).toBe(1);
      fireEvent.click(page().getByRole("button", { name: "Retry" }));
      if (read === 1) await waitFor(() => expect(scopedReads).toBe(2));
    }
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(scopedReads).toBe(3);
    expect(providerReads).toBe(1);
  });

  test("a failed method read does not hide a paused order found by another method", async () => {
    const paused = { ...fundingBinding(), resumeOnly: true, paymentMethods: [
      { id: "provider", label: "Ripio" }, { id: "bank_transfer", label: "Bank transfer" },
    ] };
    const order = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer" };
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([paused]);
      if (path === "/api/funding/orders?region=AR") return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=provider&assetId=${encodeURIComponent(paused.assetId)}`) throw new Error("method unavailable");
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(paused.assetId)}`) return { version: FUNDING_OPEN_ORDER_VERSION, order };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(page().queryByRole("alert")).toBeNull();
    expect(page().queryByRole("button", { name: "Start new deposit" })).toBeNull();
  });

  test("a missing paused order removes its tile without disabling healthy corridors", async () => {
    const paused = { ...fundingBinding(), resumeOnly: true };
    const healthy = { ...redirectBinding(), region: "AR" };
    let providerReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk(++providerReads === 1 ? [paused, healthy] : [healthy]);
      if (path === "/api/funding/orders?region=AR") return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(paused.assetId)}`) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    await waitFor(() => expect(providerReads).toBe(2));
    expect(page().queryByRole("button", { name: /Deposit ARS/ })).toBeNull();
    expect(page().queryByRole("heading", { name: "You have an open deposit" })).toBeNull();
    expect(page().queryByRole("alert")).toBeNull();
    const healthyButton = page().getByRole("button", { name: /Deposit IDR/ });
    expect(healthyButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(healthyButton);
    expect(page().getByRole("textbox", { name: "Amount" })).toBeTruthy();
  });

  test("a cached paused order cannot open after a region round trip until a fresh match arrives", async () => {
    const paused = { ...fundingBinding(), resumeOnly: true };
    const oldOrder = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer" };
    const freshOrder = { ...oldOrder, id: "22222222-2222-4222-8222-222222222222", fiatAmount: "2000" };
    const freshRead = deferred<unknown>();
    let pausedReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk(path.includes("region=AR") ? [paused] : [redirectBinding()]);
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(paused.assetId)}`) return ++pausedReads === 1 ? { version: FUNDING_OPEN_ORDER_VERSION, order: oldOrder } : freshRead.promise;
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error(`unexpected request: ${path}`);
    } };
    const view = render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="ID" />);
    expect(await page().findByRole("button", { name: /Deposit IDR/ })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const pausedButton = await page().findByRole("button", { name: /Deposit ARS/ });
    const owner = walletOwnerKey(wallet);
    const lookupKey = ownerQueryKey(owner, "funding-open-order-by-provider", "AR", "ripio", "bank_transfer", 1);
    await waitFor(() => expect(getHomeQueryClient().getQueryData(lookupKey)).toBeUndefined());
    getHomeQueryClient().setQueryData(lookupKey, { order: oldOrder });
    fireEvent.click(pausedButton);
    await waitFor(() => expect(pausedReads).toBe(2));
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "You have an open deposit" })).toBeNull();
    await act(async () => { freshRead.resolve({ version: FUNDING_OPEN_ORDER_VERSION, order: freshOrder }); await freshRead.promise; });
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(page().getByText("You pay").parentElement?.textContent).toContain("2.000");
  });

  test("a fresh paused miss after a region round trip clears selection and refreshes providers", async () => {
    const paused = { ...fundingBinding(), resumeOnly: true };
    const healthy = { ...redirectBinding(), region: "AR" };
    const oldOrder = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer" };
    const freshRead = deferred<unknown>();
    let pausedReads = 0;
    let providerReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?region=AR")) return providersOk(++providerReads === 1 ? [paused, healthy] : [healthy]);
      if (path.startsWith("/api/funding/providers?")) return providersOk([redirectBinding()]);
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(paused.assetId)}`) return ++pausedReads === 1 ? { version: FUNDING_OPEN_ORDER_VERSION, order: oldOrder } : freshRead.promise;
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error(`unexpected request: ${path}`);
    } };
    const view = render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="ID" />);
    expect(await page().findByRole("button", { name: /Deposit IDR/ })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const pausedButton = await page().findByRole("button", { name: /Deposit ARS/ });
    const owner = walletOwnerKey(wallet);
    getHomeQueryClient().setQueryData(ownerQueryKey(owner, "funding-open-order-by-provider", "AR", "ripio", "bank_transfer", 1), { order: oldOrder });
    fireEvent.click(pausedButton);
    await waitFor(() => expect(pausedReads).toBe(2));
    expect(page().queryByRole("heading", { name: "You have an open deposit" })).toBeNull();
    await act(async () => { freshRead.resolve({ version: FUNDING_OPEN_ORDER_VERSION, order: null }); await freshRead.promise; });
    await waitFor(() => expect(providerReads).toBe(2));
    expect(page().queryByRole("button", { name: /Deposit ARS/ })).toBeNull();
    expect(page().getByRole("button", { name: /Deposit IDR/ }).hasAttribute("disabled")).toBe(false);
    expect(page().queryByRole("alert")).toBeNull();
  });

  test.each([
    ["unreadable order", { version: FUNDING_OPEN_ORDER_VERSION, order: 123 }],
    ["truncated order", { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() }],
    ["order for a different asset", { version: FUNDING_OPEN_ORDER_VERSION, order: { ...pendingRipioOrder(), region: "AR", assetId: "base:usdc", paymentMethod: "bank_transfer" } }],
    ["non-object response", "invalid"],
  ] as const)("a paused %s remains retryable without clearing the selection", async (_label, invalid) => {
    const paused = { ...fundingBinding(), resumeOnly: true };
    const order = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer" };
    let providerReads = 0;
    let pausedReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) { providerReads += 1; return providersOk([paused]); }
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(paused.assetId)}`) return ++pausedReads === 1 ? invalid : { version: FUNDING_OPEN_ORDER_VERSION, order };
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect((await page().findByRole("alert")).textContent).toContain("Home couldn't check your open deposit. Retry.");
    expect(page().getByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "You have an open deposit" })).toBeNull();
    expect(providerReads).toBe(1);
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(pausedReads).toBe(2);
    expect(providerReads).toBe(1);
  });

  test("a paused transport failure offers retry and leaves healthy methods usable", async () => {
    const paused = { ...fundingBinding(), resumeOnly: true };
    const healthy = { ...redirectBinding(), region: "AR" };
    const order = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer" };
    let pausedReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([paused, healthy]);
      if (path === "/api/funding/orders?region=AR") return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(paused.assetId)}`) {
        if (++pausedReads === 1) throw new Error("transport unavailable");
        return { version: FUNDING_OPEN_ORDER_VERSION, order };
      }
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect((await page().findByRole("alert")).textContent).toContain("Home couldn't check your open deposit. Retry.");
    expect(page().getByRole("button", { name: /Deposit IDR/ }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(pausedReads).toBe(2);
  });

  test("a late paused lookup cannot open a deposit on a later visit without selection", async () => {
    const firstRead = deferred<unknown>();
    const paused = { ...fundingBinding(), resumeOnly: true };
    const healthy = { ...redirectBinding(), region: "AR" };
    const order = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer" };
    let pausedReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([paused, healthy]);
      if (path === "/api/funding/orders?region=AR") return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(paused.assetId)}`) return ++pausedReads === 1 ? firstRead.promise : { version: FUNDING_OPEN_ORDER_VERSION, order };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { wallet, navigateToRedirect: () => {}, regionId: "AR" as const };
    const view = render(<FundingExperienceForWallet {...props} open />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    await waitFor(() => expect(pausedReads).toBe(1));
    expect(page().getByRole("button", { name: /Deposit IDR/ }).hasAttribute("disabled")).toBe(false);
    view.rerender(<FundingExperienceForWallet {...props} open={false} />);
    view.rerender(<FundingExperienceForWallet {...props} open />);
    await act(async () => { firstRead.resolve({ version: FUNDING_OPEN_ORDER_VERSION, order }); await firstRead.promise; });
    expect(await page().findByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "You have an open deposit" })).toBeNull();
    expect(pausedReads).toBe(1);
    fireEvent.click(page().getByRole("button", { name: /Deposit ARS/ }));
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(pausedReads).toBe(2);
  });

  test("two resume-only bindings under one provider each select their own open payment method", async () => {
    const bank = { ...fundingBinding(), resumeOnly: true };
    const card = { ...fundingBinding(), assetId: "base:usdc", currency: "USD", paymentMethods: [{ id: "card", label: "Card" }], resumeOnly: true };
    const older = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer" };
    const newer = { ...pendingRipioOrder(), id: "22222222-2222-4222-8222-222222222222", region: "AR", assetId: "base:usdc", paymentMethod: "card" };
    const requests: string[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk([bank, card]);
      if (path === "/api/funding/orders?region=AR") return { version: FUNDING_OPEN_ORDER_VERSION, order: newer };
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(bank.assetId)}`) return { version: FUNDING_OPEN_ORDER_VERSION, order: older };
      if (path === `/api/funding/orders?region=AR&providerId=ripio&paymentMethod=card&assetId=${encodeURIComponent(card.assetId)}`) return { version: FUNDING_OPEN_ORDER_VERSION, order: newer };
      if (path === `/api/funding/orders/${older.id}`) return { order: older };
      if (path === `/api/funding/orders/${newer.id}`) return { order: newer };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(requests).toContain(`/api/funding/orders?region=AR&providerId=ripio&paymentMethod=bank_transfer&assetId=${encodeURIComponent(bank.assetId)}`);
    expect(requests).not.toContain("/api/funding/quotes");
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(await page().findByRole("button", { name: /Deposit USD/ }));
    expect(await page().findByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(requests).toContain(`/api/funding/orders?region=AR&providerId=ripio&paymentMethod=card&assetId=${encodeURIComponent(card.assetId)}`);
  });

  test("an open order resumes only for its own binding when one provider has several in the region", async () => {
    const usdBinding = { ...fundingBinding(), assetId: "base:usdc", assetSymbol: "USDC", assetDecimals: 6, currency: "USD", paymentMethods: [{ id: "card", label: "Card" }] };
    const ambiguous = { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer", state: "dispatch-ambiguous", fiatAmount: "1000", providerStatus: null, instructions: null };
    const requests: string[] = [];
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        requests.push(path);
        if (path.startsWith("/api/funding/providers")) return providersOk([usdBinding, fundingBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: ambiguous };
        throw new Error("unexpected request");
      },
    };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    await page().findByText("Don't try again yet");
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(await page().findByRole("button", { name: /Deposit USD/ }));
    expect(page().queryByRole("heading", { name: "You have an open deposit" })).toBeNull();
    expect(page().getByRole("button", { name: "Review quote" })).toBeTruthy();
    await waitFor(() => expect(page().queryByText("Don't try again yet")).toBeNull());
    expect(page().queryByRole("button", { name: "Clear old order" })).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByText("Don't try again yet")).toBeTruthy();
    expect(requests.some((path) => path === "/api/funding/quotes" || path === "/api/funding/orders" || path.endsWith("/resolve"))).toBe(false);
  });

  test("Back then the matching provider resumes ambiguity without another quote or create", async () => {
    let quoteCalls = 0;
    let createCalls = 0;
    const ambiguous = { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "dispatch-ambiguous", fiatAmount: "1000", providerStatus: null, instructions: null };
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: ambiguous };
        if (path === "/api/funding/quotes") { quoteCalls += 1; throw new Error("unexpected quote"); }
        if (path === "/api/funding/orders") { createCalls += 1; throw new Error("unexpected create"); }
        throw new Error("unexpected request");
      },
    };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    await page().findByText("Don't try again yet");
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(await page().findByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByText("Don't try again yet")).toBeTruthy();
    expect(quoteCalls).toBe(0);
    expect(createCalls).toBe(0);
  });

  test("does not reopen a terminal order from the open-order cache after Back", async () => {
    const received = { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "received", fiatAmount: "1000", providerStatus: "complete", instructions: null };
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: received };
        throw new Error("unexpected request");
      },
    };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    expect(await page().findByRole("heading", { name: "Add money" })).toBeTruthy();
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect(await page().findByRole("button", { name: "Review quote" })).toBeTruthy();
    expect(page().queryByText("Money received")).toBeNull();
  });

  test("shows the server recovery time when an ambiguous order is not ready", async () => {
    const ambiguous = { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "dispatch-ambiguous", fiatAmount: "1000", providerStatus: null, instructions: null };
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: ambiguous };
        if (path.endsWith("/resolve")) throw Object.assign(new Error("not ready"), {
          serverMessage: "This order can be cleared after Sep 13, 2026, 12:05 AM UTC.",
        });
        throw new Error("unexpected request");
      },
    };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    await page().findByText("Don't try again yet");
    fireEvent.click(page().getByRole("button", { name: "Clear old order" }));
    expect((await page().findByRole("alert")).textContent).toContain(
      "This order can be cleared after Sep 13, 2026, 12:05 AM UTC.",
    );
    expect(page().getByText("Don't try again yet")).toBeTruthy();
  });

  test("an ordinary picker stays on methods with a cached pending order and sends read requests only", async () => {
    const wallet = verifiedWallet();
    const requests: Array<{ path: string; method?: string }> = [];
    const navigations: string[] = [];
    getHomeQueryClient().setQueryData(ownerQueryKey(dataOwnerKey(wallet.session!), "funding-open-order", "AR"), { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() });
    const fixture = { ...wallet, fetchAccountResource: async (path: string, options?: { method?: string }) => {
      requests.push({ path, method: options?.method });
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={fixture} navigateToRedirect={(url) => navigations.push(url)} regionId="AR" />);
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(requests).toEqual([{ path: "/api/funding/providers?region=AR&direction=onramp", method: undefined }]);
    expect(navigations).toEqual([]);
  });

  test("a provider return does not resume a persisted partial open order", async () => {
    const wallet = verifiedWallet();
    const ownerKey = dataOwnerKey(wallet.session!);
    const steps: string[] = [];
    const { id, providerId, state, fiatAmount } = pendingRipioOrder();
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-open-order", "AR"), { version: FUNDING_OPEN_ORDER_VERSION, order: { id, providerId, state, fiatAmount } });
    let orderReads = 0;
    let returnValidOrder = false;
    const fixture = { ...wallet, fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) {
        orderReads += 1;
        return { version: FUNDING_OPEN_ORDER_VERSION, order: returnValidOrder ? pendingRipioOrder() : { id, providerId, state, fiatAmount } };
      }
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={fixture} navigateToRedirect={() => {}} regionId="AR" returnedFromProvider initialStep="method" onStepChange={(step: string) => steps.push(step)} />);
    expect((await page().findByRole("alert")).textContent).toContain("Home couldn't check for an open deposit. Retry.");
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(steps).not.toContain("order");
    expect(orderReads).toBe(0);
    returnValidOrder = true;
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(orderReads).toBe(1);
    expect(steps.filter((step) => step === "order")).toHaveLength(1);
    expect(page().queryByRole("alert")).toBeNull();
  });

  test.each([
    ["null fee", { fees: [null] }],
    ["object atomic amount", { expectedTokenAmountAtomic: { amount: "1000000" } }],
    ["foreign region", { region: "BR" }],
    ["partial quote", { quote: { fiatAmount: "1000" } }],
  ])("a provider return rejects cached open-order %s and resumes only after retry", async (_case, fields) => {
    const wallet = verifiedWallet();
    const ownerKey = dataOwnerKey(wallet.session!);
    const steps: string[] = [];
    const validOrder = { ...pendingRipioOrder(), region: "AR", expectedTokenAmountAtomic: "1000000", fees: [{ label: "Provider", amount: "1", currency: "ARS" }], instructions: { kind: "bank-transfer", rail: "CVU", accountNumber: "123", amount: "1001", currency: "ARS" } };
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-open-order", "AR"), { version: FUNDING_OPEN_ORDER_VERSION, order: { ...validOrder, ...fields } });
    let orderReads = 0;
    const fixture = { ...wallet, fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) { orderReads += 1; return { version: FUNDING_OPEN_ORDER_VERSION, order: validOrder }; }
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={fixture} navigateToRedirect={() => {}} regionId="AR" returnedFromProvider initialStep="method" onStepChange={(step: string) => steps.push(step)} />);
    expect((await page().findByRole("alert")).textContent).toContain("Home couldn't check for an open deposit. Retry.");
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(steps).not.toContain("order");
    expect(orderReads).toBe(0);
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(await page().findByRole("heading", { name: "Review payment details" })).toBeTruthy();
    expect(steps.filter((step) => step === "order")).toHaveLength(1);
    expect(orderReads).toBe(1);
  });

  test("a provider return does not resume a persisted open order without the current version", async () => {
    const wallet = verifiedWallet();
    const ownerKey = dataOwnerKey(wallet.session!);
    const steps: string[] = [];
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-open-order", "AR"), { order: pendingRipioOrder() });
    let orderReads = 0;
    const fixture = { ...wallet, fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) {
        orderReads += 1;
        return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      }
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={fixture} navigateToRedirect={() => {}} regionId="AR" returnedFromProvider initialStep="method" onStepChange={(step: string) => steps.push(step)} />);
    expect((await page().findByRole("alert")).textContent).toContain("Home couldn't check for an open deposit. Retry.");
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(steps).not.toContain("order");
    expect(orderReads).toBe(0);
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(orderReads).toBe(1);
    expect(steps.filter((step) => step === "order")).toHaveLength(1);
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("a late verification return resumes a cached order once, and only a new return request re-arms it", async () => {
    const wallet = verifiedWallet();
    const ownerKey = dataOwnerKey(wallet.session!);
    const requests: string[] = [];
    const steps: string[] = [];
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-open-order", "AR"), { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() });
    const fixture = { ...wallet, fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { wallet: fixture, navigateToRedirect: () => {}, regionId: "AR" as const, onStepChange: (step: string) => steps.push(step) };
    const view = render(<FundingExperienceForWallet {...props} />);
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet {...props} />);
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(steps).not.toContain("order");

    const returned = { ...props, returnedFromProvider: true, returnedFromVerification: true, initialStep: "method" as const };
    view.rerender(<FundingExperienceForWallet {...returned} />);
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(steps.filter((step) => step === "order")).toHaveLength(1);
    expect(requests.every((path) => path.startsWith("/api/funding/providers?") || path.startsWith("/api/funding/orders?"))).toBe(true);

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    view.rerender(<FundingExperienceForWallet {...returned} />);
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(ownerKey, "funding-open-order", "AR") }); });
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(steps.filter((step) => step === "order")).toHaveLength(1);

    view.rerender(<FundingExperienceForWallet {...props} />);
    expect(page().queryByText("Deposit pending")).toBeNull();
    view.rerender(<FundingExperienceForWallet {...returned} />);
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(steps.filter((step) => step === "order")).toHaveLength(2);
    view.rerender(<FundingExperienceForWallet {...returned} />);
    expect(steps.filter((step) => step === "order")).toHaveLength(2);
    expect(requests.every((path) => path.startsWith("/api/funding/providers?") || path.startsWith("/api/funding/orders?"))).toBe(true);
  });

  test.each(["providers first", "orders first"])("a late pending order leaves %s on the method list", async (first) => {
    let resolveProviders!: (value: unknown) => void;
    let resolveOrders!: (value: unknown) => void;
    const providers = new Promise<unknown>((resolve) => { resolveProviders = resolve; });
    const orders = new Promise<unknown>((resolve) => { resolveOrders = resolve; });
    const requests: string[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providers;
      if (path.startsWith("/api/funding/orders?")) return orders;
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const resolveFirst = first === "providers first"
      ? () => resolveProviders(providersOk([fundingBinding()]))
      : () => resolveOrders({ version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() });
    const resolveSecond = first === "providers first"
      ? () => resolveOrders({ version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() })
      : () => resolveProviders(providersOk([fundingBinding()]));
    await act(async () => { resolveFirst(); await (first === "providers first" ? providers : orders); });
    await act(async () => { resolveSecond(); await (first === "providers first" ? orders : providers); });
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(requests).toEqual(["/api/funding/providers?region=AR&direction=onramp", "/api/funding/orders?region=AR"]);
  });

  test("without an order the picker stays on methods and provider selection opens a fresh quote form", async () => {
    const requests: string[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const provider = await page().findByRole("button", { name: /Deposit ARS/ });
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    fireEvent.click(provider);
    expect(page().getByRole("heading", { name: "Deposit ARS" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Review quote" })).toBeTruthy();
    expect(requests).toEqual(["/api/funding/providers?region=AR&direction=onramp", "/api/funding/orders?region=AR"]);
  });

  test("selecting a matching pending order shows its amount without opening the order or making writes", async () => {
    const requests: string[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: { ...pendingRipioOrder(), createdAt: "2026-09-13T00:05:00.000Z" } };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect(page().getByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(page().getByText("You pay").parentElement?.textContent).toContain("1.000,00");
    expect(page().getByText("Started").parentElement?.textContent).toContain("2026");
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(requests).toEqual(["/api/funding/providers?region=AR&direction=onramp", "/api/funding/orders?region=AR"]);
  });

  test("Continue deposit opens the selected pending order without quote or create", async () => {
    const requests: string[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(requests).toEqual(["/api/funding/providers?region=AR&direction=onramp", "/api/funding/orders?region=AR"]);
  });

  test("Start new deposit opens a fresh quote form instead of the pending order", async () => {
    const requests: string[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Start new deposit" }));
    expect(page().getByRole("button", { name: "Review quote" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(page().queryByRole("heading", { name: "You have an open deposit" })).toBeNull();
    expect(requests).toEqual(["/api/funding/providers?region=AR&direction=onramp", "/api/funding/orders?region=AR"]);
  });

  test("Back from the open-order prompt and close/reopen return to methods", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { wallet, navigateToRedirect: () => {}, regionId: "AR" as const };
    const view = render(<FundingExperienceForWallet {...props} open />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "You have an open deposit" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: /Deposit ARS/ }));
    fireEvent.click(page().getByRole("button", { name: "Close add money" }));
    view.rerender(<FundingExperienceForWallet {...props} open={false} />);
    view.rerender(<FundingExperienceForWallet {...props} open />);
    expect(await page().findByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "You have an open deposit" })).toBeNull();
  });

  test("reopening resets an unfinished Receive step to the current start step", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { wallet, navigateToRedirect: () => {}, regionId: "AR" as const };
    const view = render(<FundingExperienceForWallet {...props} open />);
    fireEvent.click(await page().findByRole("button", { name: /Receive crypto/ }));
    expect(page().getByRole("heading", { name: "Receive" })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet {...props} open={false} />);
    view.rerender(<FundingExperienceForWallet {...props} open />);
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Receive" })).toBeNull();
  });

  test("Continue uses the order selected before an open-order refetch", async () => {
    const first = pendingRipioOrder();
    const replacement = { ...first, id: "22222222-2222-4222-8222-222222222222", state: "dispatch-ambiguous" };
    let reads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: ++reads === 1 ? first : replacement };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(wallet.session!), "funding-open-order", "AR") }); });
    expect(reads).toBe(2);
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(page().queryByText("Don't try again yet")).toBeNull();
  });

  test("Back and close/reopen do not resume on an order refetch", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { wallet, navigateToRedirect: () => {}, regionId: "AR" as const, returnedFromVerification: true };
    const view = render(<FundingExperienceForWallet {...props} />);
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: [dataOwnerKey(wallet.session!), "funding-open-order", "AR"] }); });
    expect(page().queryByText("Deposit pending")).toBeNull();
    view.rerender(<FundingExperienceForWallet {...props} open={false} />);
    view.rerender(<FundingExperienceForWallet {...props} open />);
    expect(await page().findByRole("heading", { name: "Add money" })).toBeTruthy();
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: [dataOwnerKey(wallet.session!), "funding-open-order", "AR"] }); });
    expect(page().queryByText("Deposit pending")).toBeNull();
  });

  test("a provider return resumes once when its open order arrives after the methods", async () => {
    const orderRead = deferred<unknown>();
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return orderRead.promise;
      throw new Error(`unexpected request: ${path}`);
    } };
    const steps: string[] = [];
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromProvider initialStep="method" regionId="AR" onStepChange={(step) => steps.push(step)} />);
    expect(await page().findByRole("button", { name: /Receive crypto/ })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    await act(async () => { orderRead.resolve({ version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() }); await orderRead.promise; });
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(steps.filter((step) => step === "order")).toHaveLength(1);
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(dataOwnerKey(wallet.session!), "funding-open-order", "AR") }); });
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(steps.filter((step) => step === "order")).toHaveLength(1);
  });

  test("explicit navigation wins when verification customer data arrives later", async () => {
    const customerRead = deferred<unknown>();
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([customerBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path.startsWith("/api/funding/provider-customers?")) return customerRead.promise;
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromVerification regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Receive crypto/ }));
    expect(page().getByRole("heading", { name: "Receive" })).toBeTruthy();
    await act(async () => {
      customerRead.resolve(customersOk([{ providerId: "ripio", region: "AR", state: "pending", verificationStartedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" }]));
      await customerRead.promise;
    });
    expect(page().getByRole("heading", { name: "Receive" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();
  });

  test("a provider return opened while restoring resumes its order once after verification", async () => {
    const requests: Array<{ path: string; method?: string }> = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string, options?: { method?: string }) => {
      requests.push({ path, method: options?.method });
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { navigateToRedirect: () => {}, returnedFromProvider: true, initialStep: "method" as const, regionId: "AR" as const };
    const view = render(<FundingExperienceForWallet {...props} wallet={restoringWallet(wallet)} />);
    expect(await page().findByRole("heading", { name: "Add money" })).toBeTruthy();
    view.rerender(<FundingExperienceForWallet {...props} wallet={wallet} />);
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: [dataOwnerKey(wallet.session!), "funding-open-order", "AR"] }); });
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(requests.filter(({ path, method }) => method === "POST" || path === "/api/funding/quotes" || path === "/api/funding/orders")).toEqual([]);
  });

  test("an ordinary open that starts while restoring stays on methods after verification with a pending order", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { navigateToRedirect: () => {}, initialStep: "method" as const, regionId: "AR" as const };
    const view = render(<FundingExperienceForWallet {...props} wallet={restoringWallet(wallet)} />);
    view.rerender(<FundingExperienceForWallet {...props} wallet={wallet} />);
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: [dataOwnerKey(wallet.session!), "funding-open-order", "AR"] }); });
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
  });

  test("a verification return opened while restoring resumes pending customer setup", async () => {
    const pending = { providerId: "ripio", region: "AR", state: "pending", verificationStartedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([customerBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path.startsWith("/api/funding/provider-customers?")) return customersOk([pending]);
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { navigateToRedirect: () => {}, returnedFromProvider: true, returnedFromVerification: true, initialStep: "method" as const, regionId: "AR" as const };
    const view = render(<FundingExperienceForWallet {...props} wallet={restoringWallet(wallet)} />);
    view.rerender(<FundingExperienceForWallet {...props} wallet={wallet} />);
    expect(await page().findByRole("heading", { name: "Set up Ripio" })).toBeTruthy();
  });

  test.each(["directly", "after revalidation"])("a restoring return cannot pass from verified user A to user B %s", async (transition) => {
    const fetchAccountResource = async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      throw new Error(`unexpected request: ${path}`);
    };
    const walletA = { ...verifiedWallet(), fetchAccountResource };
    const walletB = { ...verifiedWallet(ADDRESS_B), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { navigateToRedirect: () => {}, returnedFromVerification: true, regionId: "AR" as const };
    const view = render(<FundingExperienceForWallet {...props} wallet={restoringWallet(walletA)} />);
    view.rerender(<FundingExperienceForWallet {...props} wallet={walletA} />);
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    if (transition === "after revalidation") view.rerender(<FundingExperienceForWallet {...props} wallet={restoringWallet(walletA)} />);
    view.rerender(<FundingExperienceForWallet {...props} wallet={walletB} />);
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
  });

  test("closing a restoring return spends it before the verified wallet arrives", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { navigateToRedirect: () => {}, returnedFromVerification: true, regionId: "AR" as const };
    const view = render(<FundingExperienceForWallet {...props} wallet={restoringWallet(wallet)} />);
    view.rerender(<FundingExperienceForWallet {...props} wallet={restoringWallet(wallet)} open={false} />);
    view.rerender(<FundingExperienceForWallet {...props} wallet={wallet} open />);
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
  });

  test("a provider return can resume once, but a changed account cannot inherit its return entry", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const view = render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromProvider initialStep="method" regionId="AR" />);
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    view.rerender(<FundingExperienceForWallet wallet={{ ...wallet, ...verifiedWallet(ADDRESS_B), fetchAccountResource: wallet.fetchAccountResource }} navigateToRedirect={() => {}} returnedFromProvider initialStep="method" regionId="AR" />);
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    view.rerender(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromProvider initialStep="method" regionId="AR" />);
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
  });

  test.each([
    ["in one render", false],
    ["before preference readiness", true],
  ])("a verification return follows persisted-region hydration %s and resumes its matching order once", async (_, regionChangesBeforeReady) => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: path.includes("region=AR") ? { ...pendingRipioOrder(), region: "AR" } : null };
      throw new Error(`unexpected request: ${path}`);
    } };
    const ownerKey = dataOwnerKey(wallet.session!);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-providers", "AR"), providersOk([fundingBinding()]));
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-open-order", "AR"), { version: FUNDING_OPEN_ORDER_VERSION, order: { ...pendingRipioOrder(), region: "AR" } });
    const steps: string[] = [];
    const props = { wallet, navigateToRedirect: () => {}, returnedFromVerification: true, onStepChange: (step: string) => steps.push(step) };
    const view = render(<FundingExperienceForWallet {...props} regionReady={false} regionId="CO" />);
    expect(await page().findByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    if (regionChangesBeforeReady) {
      view.rerender(<FundingExperienceForWallet {...props} regionReady={false} regionId="AR" />);
      expect(page().queryByRole("button", { name: /Deposit ARS/ })).toBeNull();
      expect(page().queryByText("Deposit pending")).toBeNull();
    }

    view.rerender(<FundingExperienceForWallet {...props} regionReady regionId="AR" />);
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(steps.filter((step) => step === "order")).toHaveLength(1);
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(ownerKey, "funding-open-order", "AR") }); });
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(steps.filter((step) => step === "order")).toHaveLength(1);
  });

  test("a provider return waits for same-region preference readiness even with its order cached", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const ownerKey = dataOwnerKey(wallet.session!);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-providers", "AR"), providersOk([fundingBinding()]));
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-open-order", "AR"), { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() });
    const steps: string[] = [];
    const props = { wallet, navigateToRedirect: () => {}, returnedFromProvider: true, initialStep: "method" as const, regionId: "AR" as const, onStepChange: (step: string) => steps.push(step) };
    const view = render(<FundingExperienceForWallet {...props} regionReady={false} />);
    expect(await page().findByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("button", { name: /Deposit ARS/ })).toBeNull();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(steps).not.toContain("order");

    view.rerender(<FundingExperienceForWallet {...props} regionReady />);
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(steps.filter((step) => step === "order")).toHaveLength(1);
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: ownerQueryKey(ownerKey, "funding-open-order", "AR") }); });
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(steps.filter((step) => step === "order")).toHaveLength(1);
  });

  test("a verification customer return resumes when same-region preference becomes ready", async () => {
    const pending = { providerId: "ripio", region: "AR", state: "pending", verificationStartedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([customerBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path.startsWith("/api/funding/provider-customers?")) return customersOk([pending]);
      throw new Error(`unexpected request: ${path}`);
    } };
    const ownerKey = dataOwnerKey(wallet.session!);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-providers", "AR"), providersOk([customerBinding()]));
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-open-order", "AR"), { version: FUNDING_OPEN_ORDER_VERSION, order: null });
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-provider-customers", "AR"), customersOk([pending]));
    const props = { wallet, navigateToRedirect: () => {}, returnedFromVerification: true, regionId: "AR" as const };
    const view = render(<FundingExperienceForWallet {...props} regionReady={false} />);
    expect(page().queryByRole("button", { name: /Deposit ARS/ })).toBeNull();
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();

    view.rerender(<FundingExperienceForWallet {...props} regionReady />);
    expect(await page().findByRole("heading", { name: "Set up Ripio" })).toBeTruthy();
  });

  test("a verification return retries a persisted malformed customer envelope into a resume", async () => {
    const pending = { providerId: "ripio", region: "AR", state: "pending", verificationStartedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([customerBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path.startsWith("/api/funding/provider-customers?")) return customersOk([pending]);
      throw new Error(`unexpected request: ${path}`);
    } };
    const ownerKey = dataOwnerKey(wallet.session!);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-provider-customers", "AR"), { version: 1, customers: [{ providerId: "partial" }] });
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromVerification initialStep="method" regionId="AR" />);
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();
    await waitFor(() => expect(page().getByRole("alert").textContent).toContain("Home couldn't check your provider setup. Retry."));
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(await page().findByRole("heading", { name: "Set up Ripio" })).toBeTruthy();
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("a verification return retries a persisted foreign-region customer envelope into a resume", async () => {
    const pending = { providerId: "ripio", region: "AR", state: "pending", verificationStartedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([customerBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path.startsWith("/api/funding/provider-customers?")) return customersOk([pending]);
      throw new Error(`unexpected request: ${path}`);
    } };
    const ownerKey = dataOwnerKey(wallet.session!);
    getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "funding-provider-customers", "AR"), customersOk([{ ...pending, region: "BR" }]));
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromVerification initialStep="method" regionId="AR" />);
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();
    await waitFor(() => expect(page().getByRole("alert").textContent).toContain("Home couldn't check your provider setup. Retry."));
    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    expect(await page().findByRole("heading", { name: "Set up Ripio" })).toBeTruthy();
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("an ordinary open remains on methods across persisted-region hydration", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { wallet, navigateToRedirect: () => {} };
    const view = render(<FundingExperienceForWallet {...props} regionReady={false} regionId="CO" />);
    view.rerender(<FundingExperienceForWallet {...props} regionReady regionId="AR" />);
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
  });

  test("a region change cannot inherit a return entry even when its order matches", async () => {
    const requests: string[] = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/funding/providers?")) return providersOk([{ ...fundingBinding(), region: path.includes("region=CO") ? "CO" : "AR" }]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: { ...pendingRipioOrder(), region: path.includes("region=CO") ? "CO" : "AR" } };
      throw new Error(`unexpected request: ${path}`);
    } };
    const view = render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromVerification regionId="AR" />);
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    view.rerender(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromVerification regionId="CO" />);
    expect(await page().findByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(requests).toContain("/api/funding/orders?region=CO");
    view.rerender(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromVerification regionId="AR" />);
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
  });

  test("a provider-only return retains its Receive entry and cannot resume after Back", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromProvider regionId="AR" />);
    expect(await page().findByRole("heading", { name: "Receive" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: [dataOwnerKey(wallet.session!), "funding-open-order", "AR"] }); });
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
  });

  test("an explicit close disarms a return before reopen and refetch", async () => {
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      throw new Error(`unexpected request: ${path}`);
    } };
    const props = { wallet, navigateToRedirect: () => {}, regionId: "AR" as const, returnedFromVerification: true };
    const view = render(<FundingExperienceForWallet {...props} />);
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Close add money" }));
    view.rerender(<FundingExperienceForWallet {...props} open={false} />);
    view.rerender(<FundingExperienceForWallet {...props} open />);
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: [dataOwnerKey(wallet.session!), "funding-open-order", "AR"] }); });
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
  });

  test("late verification-return order cannot override Receive or resume after Back", async () => {
    let resolveOrder!: (value: unknown) => void;
    const pendingOrder = new Promise<unknown>((resolve) => { resolveOrder = resolve; });
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([fundingBinding()]);
      if (path.startsWith("/api/funding/orders?")) return pendingOrder;
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromVerification regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Receive crypto/ }));
    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    await act(async () => { resolveOrder({ version: FUNDING_OPEN_ORDER_VERSION, order: { id: "11111111-1111-4111-8111-111111111111", providerId: "ripio", state: "dispatch-ambiguous", fiatAmount: "1000", providerStatus: null, instructions: null } }); await pendingOrder; });
    expect(page().getByRole("dialog", { name: "Receive" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: [dataOwnerKey(wallet.session!), "funding-open-order", "AR"] }); });
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Don't try again yet")).toBeNull();
  });

  test("keeps the generic redirect renderer for non-Coinbase providers", async () => {
    const navigations: string[] = [];
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([redirectBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        if (path === "/api/funding/quotes") return { version: FUNDING_QUOTE_VERSION, quoteToken: "signed-token", quote: { fiatAmount: "25000", tokenAmountAtomic: "2500000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" } };
        if (path === "/api/funding/orders") return { order: { id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", state: "awaiting-payment", fiatAmount: "25000", expectedTokenAmountAtomic: "2500000", fees: [], providerStatus: null, instructions: { kind: "redirect", url: REDIRECT_URL } } };
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={(url) => navigations.push(url)}
        regionId="ID"
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: /Deposit IDR/ }));
    enterAmount("25000");
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));

    await waitFor(() => expect(navigations).toEqual([REDIRECT_URL]));
    expect(page().getByRole("link", { name: "Continue to payment" }).getAttribute("href")).toBe(REDIRECT_URL);
  });

  test("a resumed open redirect order never auto-navigates; it keeps the explicit link", async () => {
    const navigations: string[] = [];
    const openOrder = { id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", state: "awaiting-payment", fiatAmount: "25000", expectedTokenAmountAtomic: "2500000", fees: [], providerStatus: null, instructions: { kind: "redirect", url: REDIRECT_URL } };
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([redirectBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: openOrder };
        if (path.startsWith("/api/funding/orders")) return { order: openOrder };
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={(url) => navigations.push(url)}
        regionId="ID"
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: /Deposit IDR/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByRole("link", { name: "Continue to payment" })).toBeTruthy();
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    expect(navigations).toEqual([]);
  });

  test("a resumed QR order shows its payment code instead of a method-list error", async () => {
    const payload = "000201010212IDRX-QRIS-25000";
    const openOrder = { id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", state: "awaiting-payment", fiatAmount: "25000", providerStatus: null, instructions: { kind: "qr", scheme: "qris", payload, amount: "25000", currency: "IDR" } };
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers?")) return providersOk([redirectBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: openOrder };
      throw new Error(`unexpected request: ${path}`);
    } };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="ID" returnedFromProvider initialStep="method" />);
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(page().getByRole("heading", { name: "QRIS payment" })).toBeTruthy();
    expect(page().getByRole("button", { name: /Copy payment code/ }).getAttribute("title")).toBe(payload);
    expect(page().queryByRole("alert")).toBeNull();
  });

  test("a redirect order settled below the quote shows the final receive amount and the fee lines", async () => {
    const settledOrder = { id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", state: "sent-unverified", fiatAmount: "20000", expectedTokenAmountAtomic: "1986000", fees: [{ label: "VA INA", amount: "3000", currency: "IDR" }, { label: "QRIS Fee (0.7%)", amount: "140", currency: "IDR" }], providerStatus: "MINTED:PAID", instructions: { kind: "redirect", url: REDIRECT_URL } };
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([redirectBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: settledOrder };
        if (path.startsWith("/api/funding/orders")) return { order: settledOrder };
        throw new Error("unexpected request");
      },
    };

    render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={() => {}}
        regionId="ID"
      />,
    );

    fireEvent.click(await page().findByRole("button", { name: /Deposit IDR/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByText("Receive")).toBeTruthy();
    expect(page().getByText(/19[,.]860/)).toBeTruthy();
    expect(page().getByText("VA INA")).toBeTruthy();
    expect(page().getByText("QRIS Fee (0.7%)")).toBeTruthy();
    expect(page().getByText(/3[,.]000/)).toBeTruthy();
  });

  test("shows safe quote errors without suggesting the entered details are wrong", async () => {
    for (const [code, serverMessage, expected] of [
      ["QUOTE_BELOW_MINIMUM", "Coinbase needs more than $2 after fees. Enter a larger amount.", "Coinbase needs more than $2 after fees. Enter a larger amount."],
      ["QUOTE_DECLINED", "Coinbase couldn't quote this amount. Try a different amount.", "Coinbase couldn't quote this amount. Try a different amount."],
      ["QUOTE_UNAVAILABLE", "provider outage", "Quotes are unavailable right now. Try again shortly."],
      ["UNKNOWN", "provider details", "This quote could not be created. Try again."],
      ["QUOTE_BELOW_MINIMUM", "x".repeat(201), "This quote could not be created. Try again."],
    ] as const) {
      const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([applePayBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        if (path === "/api/funding/quotes") throw Object.assign(new Error("quote rejected"), { code, serverMessage });
        throw new Error("unexpected request");
      } };
      const view = render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="US" />);
      fireEvent.click(await page().findByRole("button", { name: /Deposit USD/ }));
      enterAmount("25");
      fireEvent.click(page().getByRole("button", { name: "Review quote" }));
      const alert = await page().findByRole("alert");
      expect(alert.textContent).toContain(expected);
      expect(alert.textContent).not.toContain("Check your details");
      view.unmount();
      getHomeQueryClient().clear();
    }
  });

  test("renders Apple Pay only after economics review and refetches only for trusted messages", async () => {
    const navigations: string[] = [];
    const requests: Array<{ path: string; method?: string }> = [];
    let statusCalls = 0;
    let resolveStatus!: (value: unknown) => void;
    const statusResult = new Promise<unknown>((resolve) => { resolveStatus = resolve; });
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string, options?: { method?: "GET" | "POST" | "PUT" }) => {
        requests.push({ path, method: options?.method });
        if (path.startsWith("/api/funding/providers")) return providersOk([applePayBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        if (path === "/api/funding/quotes") return { version: FUNDING_QUOTE_VERSION, quoteToken: "signed-token", quote: { fiatAmount: "25", tokenAmountAtomic: "24500000", fees: [{ label: "Coinbase fee", amount: "0.50", currency: "USD" }], expiresAt: "2099-01-01T00:00:00.000Z" } };
        if (path === "/api/funding/orders") return { order: applePayOrder() };
        if (path === "/api/funding/orders/11111111-1111-4111-8111-111111111111") {
          statusCalls += 1;
          return statusResult;
        }
        throw new Error("unexpected request");
      },
    };

    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={(url) => navigations.push(url)} regionId="US" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit USD/ }));
    enterAmount("25");
    fireEvent.click(page().getByRole("button", { name: "Review quote" }));
    await page().findByRole("heading", { name: "Review quote" });
    fireEvent.click(page().getByRole("button", { name: "Confirm deposit" }));
    await page().findByRole("heading", { name: "Review payment details" });
    // The created order repriced ($25 quoted, $25.50 charged); the review shows the real total.
    expect(page().getByText("You pay").parentElement?.textContent).toContain("$25.50");
    expect(Boolean(page().queryByTitle("Apple Pay")), "iframe before economics confirmation").toBe(false);
    expect(navigations).toEqual([]);

    fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
    const iframe = await page().findByTitle("Apple Pay") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe(APPLE_PAY_URL);
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe.getAttribute("allow")).toBe("payment");
    expect(page().getByText("Pay $25.50 with Apple Pay")).toBeTruthy();
    expect(navigations).toEqual([]);

    const source = iframe.contentWindow!;
    const send = (data: unknown, origin = "https://pay.coinbase.com", eventSource: MessageEventSource = source) => {
      window.dispatchEvent(new MessageEvent("message", { data, origin, source: eventSource }));
    };
    send(JSON.stringify({ eventName: "onramp_api.commit_success" }), "https://evil.example");
    send(JSON.stringify({ eventName: "onramp_api.commit_success" }), "https://pay.coinbase.com", window);
    send("not-json");
    send(JSON.stringify({ eventName: "onramp_api.unknown" }));
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    expect(statusCalls).toBe(0);

    send(JSON.stringify({ eventName: "onramp_api.commit_success" }));
    send({ eventName: "onramp_api.polling_success" });
    await waitFor(() => expect(statusCalls).toBe(1));
    expect(navigations).toEqual([]);
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(2);

    resolveStatus({ order: applePayOrder("settling") });
    await waitFor(() => expect(Boolean(page().queryByTitle("Apple Pay")), "iframe after settling").toBe(false));
  });

  test("removes the Apple Pay message listener on unmount", async () => {
    const addListener = spyOn(window, "addEventListener");
    const removeListener = spyOn(window, "removeEventListener");
    const openOrder = applePayOrder();
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([applePayBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: openOrder };
        if (path.startsWith("/api/funding/orders")) return { order: openOrder };
        throw new Error("unexpected request");
      },
    };
    const view = render(
      <FundingExperienceForWallet
        wallet={wallet}
        navigateToRedirect={() => {}}
        regionId="US"
      />,
    );

    try {
      fireEvent.click(await page().findByRole("button", { name: /Deposit USD/ }));
      fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
      await page().findByRole("heading", { name: "Review payment details" });
      fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
      await page().findByTitle("Apple Pay");
      const messageRegistration = addListener.mock.calls.find(
        ([type]) => type === "message",
      );
      expect(messageRegistration).toBeDefined();

      view.unmount();

      expect(removeListener).toHaveBeenCalledWith(
        "message",
        messageRegistration?.[1],
      );
    } finally {
      addListener.mockRestore();
      removeListener.mockRestore();
    }
  });

  test("refuses to render an insecure embed URL", async () => {
    const openOrder = applePayOrder("awaiting-payment", "http://pay.coinbase.com/embedded/apple-pay");
    const wallet = {
      ...verifiedWallet(),
      fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([applePayBinding()]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: openOrder };
        if (path.startsWith("/api/funding/orders")) return { order: openOrder };
        throw new Error("unexpected request");
      },
    };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="US" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit USD/ }));
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    await page().findByRole("heading", { name: "Review payment details" });
    fireEvent.click(page().getByRole("button", { name: "View payment instructions" }));
    expect(page().queryByTitle("Apple Pay")).toBeNull();
  });

  test("hides the prior verified address as soon as the account boundary changes", async () => {
    const view = render(
      <FundingExperienceForWallet
        wallet={verifiedWallet(ADDRESS_A)}
        navigateToRedirect={() => {}}
        initialStep="receive"
      />,
    );
    expect(await page().findByTitle(ADDRESS_A)).toBeTruthy();

    view.rerender(
      <FundingExperienceForWallet
        wallet={{
          ...verifiedWallet(ADDRESS_B),
          status: "validating",
          verification: "provisional",
          session: null,
        }}
        navigateToRedirect={() => {}}
        initialStep="receive"
      />,
    );

    expect(page().queryByTitle(ADDRESS_A)).toBeNull();
    expect(page().getByText(/Sign in and verify a Base account/)).toBeTruthy();
  });

  test("signed-out empty state offers sign in without exposing funding actions", async () => {
    await act(async () => {
      render(
        <FundingExperienceForWallet
          wallet={{
            ownerKey: null,
            status: "signed-out",
            verification: null,
            session: null,
            fetchAccountResource: async () => {
              throw new Error("signed out");
            },
          }}
          navigateToRedirect={() => {}}
        />,
      );
    });

    expect(await page().findByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/?account=signin",
    );
    expect(page().queryByRole("button", { name: /Receive crypto/ })).toBeNull();
    expect(page().queryByRole("button", { name: "Continue to Coinbase" })).toBeNull();
  });
});

describe("provider customer funding position", () => {
  test("shows only email and dispatches one combined hosted verification action", async () => {
    const navigations: string[] = [];
    const requests: unknown[] = [];
    const binding = customerBinding();
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string, options?: { method?: string; body?: unknown }) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([binding]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path.startsWith("/api/funding/provider-customers?")) return customersOk([]);
      if (path === "/api/funding/provider-customers/verification" && options?.method === "POST") {
        requests.push(options.body);
        return { customer: { providerId: "ripio", region: "AR", state: "pending", verificationStartedAt: "2026-09-18T00:01:00.000Z", updatedAt: "2026-09-18T00:01:00.000Z" }, handoff: { url: "https://kyc.ripio.com/start?token=synthetic" } };
      }
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={(url) => navigations.push(url)} regionId="AR" />);
    fireEvent.click(await page().findByRole("button", { name: /Deposit ARS/ }));
    expect(page().getByRole("heading", { name: "Set up Ripio" })).toBeTruthy();
    expect(page().getAllByRole("textbox")).toHaveLength(1);
    fireEvent.input(page().getByRole("textbox", { name: "Email" }), { target: { value: "person@example.com" } });
    fireEvent.click(page().getByRole("button", { name: "Continue to Ripio verification" }));
    await waitFor(() => expect(requests).toEqual([{ providerId: "ripio", region: "AR", email: "person@example.com" }]));
    expect(navigations).toEqual(["https://kyc.ripio.com/start?token=synthetic"]);
  });

  test("opening a customer-capable picker only fetches providers, orders, and customers", async () => {
    const requests: Array<{ path: string; method?: string }> = [];
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string, options?: { method?: string }) => {
      requests.push({ path, method: options?.method });
      if (path.startsWith("/api/funding/providers?")) return providersOk([customerBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: pendingRipioOrder() };
      if (path.startsWith("/api/funding/provider-customers?")) return customersOk([]);
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("button", { name: /Deposit ARS/ })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(requests).toEqual([
      { path: "/api/funding/providers?region=AR&direction=onramp", method: undefined },
      { path: "/api/funding/orders?region=AR", method: undefined },
      { path: "/api/funding/provider-customers?region=AR", method: undefined },
    ]);
  });

  test("does not auto-enter setup from an ordinary method-list visit", async () => {
    const binding = customerBinding();
    const pending = { providerId: "ripio", region: "AR", state: "pending", verificationStartedAt: null, updatedAt: "2026-09-18T00:00:00.000Z" };
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([binding]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path.startsWith("/api/funding/provider-customers?")) return customersOk([pending]);
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    expect(await page().findByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();
  });

  test("does not open a customer-capable provider before its customer lookup resolves", async () => {
    let orderReads = 0;
    let customerReads = 0;
    let resolveCustomers!: (value: unknown) => void;
    const customersRead = new Promise<unknown>((resolve) => { resolveCustomers = resolve; });
    const verified = { providerId: "ripio", region: "AR", state: "verified", verificationStartedAt: null, updatedAt: "2026-09-18T00:00:00.000Z" };
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([customerBinding()]);
      if (path.startsWith("/api/funding/orders?")) { orderReads += 1; return { version: FUNDING_OPEN_ORDER_VERSION, order: null }; }
      if (path.startsWith("/api/funding/provider-customers?")) { customerReads += 1; return customersRead; }
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const provider = await page().findByRole("button", { name: /Deposit ARS/ });
    await waitFor(() => expect(orderReads).toBe(1));
    await waitFor(() => expect(customerReads).toBe(1));
    expect(provider.hasAttribute("disabled")).toBe(true);
    fireEvent.click(provider);
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();

    await act(async () => { resolveCustomers(customersOk([verified])); await customersRead; });
    await waitFor(() => expect(provider.hasAttribute("disabled")).toBe(false));
    fireEvent.click(provider);
    expect(page().getByRole("heading", { name: "Deposit ARS" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Review quote" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();
  });

  test("opens a matching pending order despite a failed provider-customer read only after selection", async () => {
    const requests: Array<{ path: string; method?: string }> = [];
    const order = { ...pendingRipioOrder(), region: "AR", assetId: "base:wars", paymentMethod: "bank_transfer" };
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string, options?: { method?: string }) => {
      requests.push({ path, method: options?.method });
      if (path.startsWith("/api/funding/providers?")) return providersOk([customerBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order };
      if (path.startsWith("/api/funding/orders/")) return { order };
      if (path.startsWith("/api/funding/provider-customers?")) throw new Error("CUSTOMERS_UNAVAILABLE");
      throw new Error(`unexpected request: ${path}`);
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const provider = await page().findByRole("button", { name: /Deposit ARS/ });
    await waitFor(() => expect(page().getByRole("alert").textContent).toContain("Home couldn't check your provider setup. Retry."));
    await waitFor(() => expect(provider.hasAttribute("disabled")).toBe(false));
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByText("Deposit pending")).toBeNull();
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();

    fireEvent.click(provider);
    expect(page().getByRole("heading", { name: "You have an open deposit" })).toBeTruthy();
    expect(page().queryByRole("button", { name: "Start new deposit" })).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Continue deposit" }));
    expect(await page().findByText("Deposit pending")).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();
    expect(requests.filter(({ method }) => method && method !== "GET")).toEqual([]);
    expect(requests.filter(({ path }) => path === "/api/funding/quotes" || path === "/api/funding/orders")).toEqual([]);
  });

  test.each(["network failure", "malformed response", "foreign-region response"] as const)("keeps a %s provider-customer read retryable before the flow opens", async (failure) => {
    let customerReads = 0;
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([customerBinding()]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path.startsWith("/api/funding/provider-customers?")) {
        customerReads += 1;
        if (customerReads === 1) {
          if (failure === "network failure") throw new Error("CUSTOMERS_UNAVAILABLE");
          if (failure === "foreign-region response") return customersOk([{ providerId: "ripio", region: "BR", state: "pending", verificationStartedAt: null, updatedAt: "2026-09-18T00:00:00.000Z" }]);
          return {};
        }
        return customersOk([]);
      }
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId="AR" />);
    const provider = await page().findByRole("button", { name: /Deposit ARS/ });
    await waitFor(() => expect(page().getByRole("alert").textContent).toContain("Home couldn't check your provider setup. Retry."));
    expect(provider.hasAttribute("disabled")).toBe(true);
    fireEvent.click(provider);
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();

    fireEvent.click(page().getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(customerReads).toBe(2));
    await waitFor(() => expect(provider.hasAttribute("disabled")).toBe(false));
    expect(page().queryByRole("alert")).toBeNull();
    fireEvent.click(provider);
    expect(page().getByRole("heading", { name: "Set up Ripio" })).toBeTruthy();
  });

  test("resumes pending setup only on the explicit verification return", async () => {
    const binding = customerBinding();
    const pending = { providerId: "ripio", region: "AR", state: "pending", verificationStartedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
    const wallet = { ...verifiedWallet(), fetchAccountResource: async (path: string) => {
      if (path.startsWith("/api/funding/providers")) return providersOk([binding]);
      if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
      if (path.startsWith("/api/funding/provider-customers?")) return customersOk([pending]);
      throw new Error("unexpected request");
    } };
    render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} returnedFromProvider returnedFromVerification initialStep="method" regionId="AR" />);
    expect(await page().findByRole("heading", { name: "Set up Ripio" })).toBeTruthy();
    expect(page().getByText(/Verification is pending/)).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back" }));
    await act(async () => { await getHomeQueryClient().refetchQueries({ queryKey: [dataOwnerKey(wallet.session!), "funding-provider-customers", "AR"] }); });
    expect(page().getByRole("heading", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("heading", { name: "Set up Ripio" })).toBeNull();
  });

  test("keeps Coinbase and IDRX usable when the customer endpoint would fail", async () => {
    for (const [binding, region] of [[applePayBinding(), "US"], [redirectBinding(), "ID"]] as const) {
      let customerGets = 0;
      const wallet = { ...verifiedWallet(), ownerKey: `owner-${region}`, fetchAccountResource: async (path: string) => {
        if (path.startsWith("/api/funding/providers")) return providersOk([binding]);
        if (path.startsWith("/api/funding/orders?")) return { version: FUNDING_OPEN_ORDER_VERSION, order: null };
        if (path.startsWith("/api/funding/provider-customers?")) { customerGets += 1; throw new Error("customer read unavailable"); }
        throw new Error("unexpected request");
      } };
      const view = render(<FundingExperienceForWallet wallet={wallet} navigateToRedirect={() => {}} regionId={region} />);
      expect(await page().findByRole("button", { name: new RegExp(`Deposit ${binding.currency}`) })).toBeTruthy();
      expect(customerGets).toBe(0);
      view.unmount();
      getHomeQueryClient().clear();
    }
  });
});
