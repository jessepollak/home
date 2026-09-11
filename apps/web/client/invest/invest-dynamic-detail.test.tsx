import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import type { InvestAsset } from "@/config/invest-assets";

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
  }),
}));

const { cleanup, render, within } = await import("@testing-library/react");
const {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
} = await import("@/client/account/cdp-client");
const { PresentationQuoteProvider } = await import("./presentation-quote");
const { InvestExperience } = await import("./invest-experience");

const dynamicId = "base:0x1111111111111111111111111111111111111111";
const dynamicAsset: InvestAsset = {
  id: dynamicId,
  category: "meme",
  displayName: "Higher",
  displaySymbol: "HIGHER",
  initials: "HI",
  chainId: 8453,
  contractAddress: "0x1111111111111111111111111111111111111111",
  availability: "informational",
  descriptor: "Trending on Base",
  representation: {
    tokenSymbol: "HIGHER",
    decimals: 18,
    relationship: "Base ERC-20 token.",
  },
  contractUrl:
    "https://basescan.org/token/0x1111111111111111111111111111111111111111",
};

const originalFetch = window.fetch;

function renderInvest(ui: ReactElement) {
  return render(
    <AccountWalletClientProvider
      client={createBlockedAccountWalletClient("unconfigured")}
    >
      {ui}
    </AccountWalletClientProvider>,
  );
}

function page() {
  return within(document.body);
}

const pendingHistoryFetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;

afterEach(() => {
  cleanup();
  window.fetch = originalFetch;
  window.history.replaceState({}, "", "/");
});

describe("dynamic Invest detail", () => {
  test("preserves a dynamic URL while the catalog loads, disappears, and reloads", () => {
    window.fetch = pendingHistoryFetch;
    const href = `/dashboard?panel=invest&asset=${encodeURIComponent(dynamicId)}`;
    window.history.replaceState({}, "", href);

    const view = renderInvest(
      <InvestExperience memeStatus="loading" memeAssets={[]} />,
    );
    expect(page().getByText("Loading asset details.")).toBeTruthy();
    expect(window.location.search).toContain(`asset=${encodeURIComponent(dynamicId)}`);
    expect(page().queryByRole("heading", { name: "Invest" })).toBeNull();

    view.rerender(
      <AccountWalletClientProvider
        client={createBlockedAccountWalletClient("unconfigured")}
      >
        <InvestExperience memeStatus="ready" memeAssets={[dynamicAsset]} />
      </AccountWalletClientProvider>,
    );
    expect(page().getByRole("heading", { name: "Higher" })).toBeTruthy();
    expect(page().getByText("USD")).toBeTruthy();

    view.rerender(
      <AccountWalletClientProvider
        client={createBlockedAccountWalletClient("unconfigured")}
      >
        <InvestExperience memeStatus="error" memeAssets={[]} />
      </AccountWalletClientProvider>,
    );
    expect(page().getByText("This Base asset is currently unavailable.")).toBeTruthy();
    expect(window.location.search).toContain(`asset=${encodeURIComponent(dynamicId)}`);

    cleanup();
    renderInvest(<InvestExperience memeStatus="ready" memeAssets={[dynamicAsset]} />);
    expect(page().getByRole("heading", { name: "Higher" })).toBeTruthy();
  });

  test("keeps the local fiat header while labeling historical chart values as USD", () => {
    window.fetch = pendingHistoryFetch;
    window.history.replaceState(
      {},
      "",
      `/dashboard?panel=invest&asset=${encodeURIComponent(dynamicId)}`,
    );

    renderInvest(
      <PresentationQuoteProvider
        value={{
          valueCurrency: "IDR",
          quoteUnitsPerUsd: { atoms: "16425", scale: 0 },
        }}
      >
        <InvestExperience
          memeStatus="ready"
          memeAssets={[dynamicAsset]}
          memeMarket={{
            status: "ready",
            snapshots: [
              {
                assetId: dynamicId,
                displayPrice: "$1",
                asOf: "2026-09-09T12:00:00.000Z",
                sourceLabel: "Codex",
              },
            ],
          }}
        />
      </PresentationQuoteProvider>,
    );

    expect(page().getByText("Rp 16,425.00")).toBeTruthy();
    expect(page().getByText("Price history")).toBeTruthy();
    expect(page().getByText("USD")).toBeTruthy();
    expect(page().queryByText("$1.00")).toBeNull();
  });
});
