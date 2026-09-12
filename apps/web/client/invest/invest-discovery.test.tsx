import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import type { MarketDataState } from "@/shared/invest/invest-market";

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
  }),
}));

const { cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
} = await import("@/client/account/cdp-client");
const { InvestExperience } = await import("./invest-experience");

type TestIntersectionEntry = { isIntersecting: boolean };
type TestIntersectionCallback = (
  entries: TestIntersectionEntry[],
  observer: unknown,
) => void;

const intersectionObserverInstances: TestIntersectionObserver[] = [];

class TestIntersectionObserver {
  connected = true;
  callback: TestIntersectionCallback;

  constructor(callback: TestIntersectionCallback) {
    this.callback = callback;
    intersectionObserverInstances.push(this);
  }

  observe() {}
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

function renderInvest(ui: ReactElement) {
  return render(
    <AccountWalletClientProvider
      client={createBlockedAccountWalletClient("unconfigured")}
    >
      {ui}
    </AccountWalletClientProvider>,
  );
}

function renderInvestInShell(ui: ReactElement) {
  return render(
    <AccountWalletClientProvider
      client={createBlockedAccountWalletClient("unconfigured")}
    >
      <main className="app-main app-main-authenticated">{ui}</main>
    </AccountWalletClientProvider>,
  );
}

function seeAllInShelf(title: string) {
  const shelf = page().getByRole("heading", { name: title }).closest("section");
  expect(shelf).toBeTruthy();
  return within(shelf as HTMLElement).getByRole("button", { name: "See all ›" });
}

const readyCrypto: MarketDataState = {
  status: "ready",
  snapshots: [
    {
      assetId: "cbbtc",
      displayPrice: "$64210",
      asOf: "2026-09-07T20:00:00.000Z",
      sourceLabel: "Codex",
      changeLabel: "-0.667%",
    },
  ],
};

beforeEach(() => {
  window.history.replaceState({}, "", "/dashboard?panel=invest");
});

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
  window.fetch = originalFetch;
  intersectionObserverInstances.length = 0;
});

const originalFetch = window.fetch;

describe("invest discovery flow", () => {
  test("pops stacked in-app category and detail without replacing the hub", async () => {
    window.fetch = (async () =>
      Response.json({
        version: 1,
        provider: "codex",
        assetId: "cbbtc",
        range: "1W",
        fetchedAt: "2026-09-07T20:00:00.000Z",
        status: "empty",
        points: [],
      })) as unknown as typeof fetch;

    renderInvest(<InvestExperience cryptoMarket={readyCrypto} />);
    fireEvent.click(page().getAllByRole("button", { name: "See all ›" })[1]!);
    await waitFor(() =>
      expect(page().getByRole("heading", { name: "Crypto" })).toBeTruthy(),
    );
    fireEvent.click(page().getByRole("button", { name: /^Bitcoin/ }));
    await waitFor(() =>
      expect(page().getByRole("heading", { name: "Bitcoin" })).toBeTruthy(),
    );

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(page().getByRole("heading", { name: "Crypto" })).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Back to Invest" }));
    expect(page().getByRole("heading", { name: "Invest" })).toBeTruthy();
  });

  test("replaces a deep-linked category back to the hub", async () => {
    renderInvest(
      <InvestExperience
        cryptoMarket={readyCrypto}
        initialView={{ screen: "category", shelfId: "crypto" }}
      />,
    );

    expect(page().getByRole("heading", { name: "Crypto" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Back to Invest" }));
    expect(window.location.search).toBe("?panel=invest");
    expect(page().getByRole("heading", { name: "Invest" })).toBeTruthy();
  });


});

describe("Memes detail incremental loading", () => {
  const higher = {
    id: "base:0x1111111111111111111111111111111111111111",
    category: "meme" as const,
    displayName: "Higher",
    displaySymbol: "HIGHER",
    initials: "HI",
    chainId: 8453 as const,
    contractAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    availability: "informational" as const,
    descriptor: "Trending on Base",
    representation: {
      tokenSymbol: "HIGHER",
      decimals: 18,
      relationship: "Base ERC-20 token.",
    },
    contractUrl:
      "https://basescan.org/token/0x1111111111111111111111111111111111111111",
  };

  test("auto-loads the next page from the Memes category sentinel", async () => {
    const onLoadMoreMemes = mock(() => {});
    renderInvestInShell(
      <InvestExperience
        memeStatus="ready"
        memeMarket={{ status: "ready", snapshots: [] }}
        memeAssets={[higher]}
        memePagination={{
          nextOffset: 24,
          exhausted: false,
          loadingMore: false,
          loadMoreError: false,
          autoLoadPaused: false,
          consecutiveEmptyPages: 0,
        }}
        onLoadMoreMemes={onLoadMoreMemes}
      />,
    );

    fireEvent.click(seeAllInShelf("Memes"));
    await waitFor(() =>
      expect(page().getByText("Higher")).toBeTruthy(),
    );
    // No manual load button in the healthy auto-load state.
    expect(page().queryByRole("button", { name: "Load more memes" })).toBeNull();
    expect(
      page().queryByRole("button", { name: "Continue loading memes" }),
    ).toBeNull();

    const observer = activeIntersectionObserver();
    expect(observer).toBeTruthy();
    observer!.trigger();
    expect(onLoadMoreMemes).toHaveBeenCalledTimes(1);
  });

  test("offers a manual retry when a page fails", async () => {
    const onRetryLoadMoreMemes = mock(() => {});
    renderInvestInShell(
      <InvestExperience
        memeStatus="ready"
        memeMarket={{ status: "ready", snapshots: [] }}
        memeAssets={[higher]}
        memePagination={{
          nextOffset: 24,
          exhausted: false,
          loadingMore: false,
          loadMoreError: true,
          autoLoadPaused: false,
          consecutiveEmptyPages: 0,
        }}
        onRetryLoadMoreMemes={onRetryLoadMoreMemes}
      />,
    );

    fireEvent.click(seeAllInShelf("Memes"));
    await waitFor(() =>
      expect(page().getByText(/More memes could not be loaded/)).toBeTruthy(),
    );
    const retry = page().getByRole("button", { name: "Retry loading memes" });
    expect(retry).toBeTruthy();
    fireEvent.click(retry);
    expect(onRetryLoadMoreMemes).toHaveBeenCalledTimes(1);
  });


});
