import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import type { MarketDataState } from "./invest-market";

const pushCalls: string[] = [];
const replaceCalls: string[] = [];
let backCalls = 0;

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => pushCalls.push(href),
    replace: (href: string) => replaceCalls.push(href),
    back: () => {
      backCalls += 1;
    },
  }),
}));

const { cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const {
  AccountWalletClientProvider,
  createBlockedAccountWalletClient,
} = await import("@/features/account/cdp-client");
const { InvestExperience } = await import("./invest-experience");

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

afterEach(() => {
  cleanup();
  window.fetch = originalFetch;
  pushCalls.length = 0;
  replaceCalls.length = 0;
  backCalls = 0;
});

const originalFetch = window.fetch;

describe("invest discovery flow", () => {
  test("opens Stocks category from See all and lists the full curated catalog", async () => {
    renderInvest(<InvestExperience />);

    expect(page().getByText("Amazon")).toBeTruthy();
    expect(page().getByText("Microsoft")).toBeTruthy();
    expect(page().queryByText("Tesla")).toBeNull();

    fireEvent.click(page().getAllByRole("button", { name: "See all ›" })[0]!);
    await waitFor(() =>
      expect(page().getByRole("heading", { name: "Stocks" })).toBeTruthy(),
    );
    expect(pushCalls).toEqual(["/dashboard?panel=invest&shelf=stocks"]);
    expect(page().getByText("Tesla")).toBeTruthy();
    expect(page().getByText("Strategy")).toBeTruthy();
    expect(page().getByText("SanDisk")).toBeTruthy();
    expect(page().getByText("SpaceX")).toBeTruthy();
    expect(page().queryByText("Buy")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Back to Invest" }));
    expect(backCalls).toBe(1);
    expect(page().getByRole("heading", { name: "Invest" })).toBeTruthy();
    expect(page().queryByText("Tesla")).toBeNull();
  });

  test("opens Crypto category from See all and includes Cardano", async () => {
    renderInvest(<InvestExperience cryptoMarket={readyCrypto} />);

    fireEvent.click(page().getAllByRole("button", { name: "See all ›" })[1]!);
    await waitFor(() =>
      expect(page().getByRole("heading", { name: "Crypto" })).toBeTruthy(),
    );
    expect(pushCalls).toEqual(["/dashboard?panel=invest&shelf=crypto"]);
    expect(page().getByText("Cardano")).toBeTruthy();
    expect(page().getByText("ADA")).toBeTruthy();
    expect(page().queryByText("Buy")).toBeNull();
    expect(page().queryByText("Sell")).toBeNull();
    fireEvent.click(page().getByRole("button", { name: "Back to Invest" }));
    expect(backCalls).toBe(1);
    expect(replaceCalls).toEqual([]);
    expect(page().getByRole("heading", { name: "Invest" })).toBeTruthy();
    expect(page().queryByText("Cardano")).toBeNull();
  });

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
    fireEvent.click(page().getByRole("button", { name: "Bitcoin details" }));
    await waitFor(() =>
      expect(page().getByRole("heading", { name: "Bitcoin" })).toBeTruthy(),
    );

    fireEvent.click(page().getByRole("button", { name: "Back" }));
    expect(backCalls).toBe(1);
    expect(replaceCalls).toEqual([]);
    expect(page().getByRole("heading", { name: "Crypto" })).toBeTruthy();

    fireEvent.click(page().getByRole("button", { name: "Back to Invest" }));
    expect(backCalls).toBe(2);
    expect(replaceCalls).toEqual([]);
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
    expect(backCalls).toBe(0);
    expect(replaceCalls).toEqual(["/dashboard?panel=invest"]);
    expect(page().getByRole("heading", { name: "Invest" })).toBeTruthy();
  });

  test("keeps a pending price muted instead of a hero-ink dash", () => {
    renderInvest(<InvestExperience />);
    fireEvent.click(page().getByRole("button", { name: "Bitcoin details" }));
    const pending = page().getByText("Price unavailable");
    expect(pending.getAttribute("data-tone")).toBe("muted");
    expect(page().queryByText("—", { selector: "strong" })).toBeNull();
  });

  test("opens Bitcoin detail with compact header, chart ranges, and trade CTA only there", async () => {
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
    fireEvent.click(page().getByRole("button", { name: "Bitcoin details" }));

    await waitFor(() =>
      expect(page().getByRole("heading", { name: "Bitcoin" })).toBeTruthy(),
    );
    expect(pushCalls).toEqual(["/dashboard?panel=invest&asset=cbbtc"]);
    const readyPrice = page().getByText("$64,210.00");
    expect(readyPrice).toBeTruthy();
    expect(readyPrice.getAttribute("data-tone")).toBe("ready");
    expect(page().getByText("-0.67%")).toBeTruthy();
    expect(page().getByText("cbBTC · Base")).toBeTruthy();
    expect(page().getByRole("group", { name: "Price range" }).textContent).toContain(
      "1D",
    );
    expect(page().getByRole("group", { name: "Price range" }).textContent).toContain(
      "1Y",
    );
    expect(page().getByRole("button", { name: "Buy" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Sell" })).toBeTruthy();
    await waitFor(() =>
      expect(page().getByText("No price history for this range.")).toBeTruthy(),
    );
  });

  test("renders a real history series and never substitutes a fake line", async () => {
    window.fetch = (async () =>
      Response.json({
        version: 1,
        provider: "codex",
        assetId: "cbbtc",
        range: "1W",
        fetchedAt: "2026-09-07T20:00:00.000Z",
        status: "ready",
        points: [
          { time: "2026-09-01T00:00:00.000Z", value: "62000" },
          { time: "2026-09-07T00:00:00.000Z", value: "64210" },
        ],
      })) as unknown as typeof fetch;

    renderInvest(<InvestExperience cryptoMarket={readyCrypto} />);
    fireEvent.click(page().getByRole("button", { name: "Bitcoin details" }));

    await waitFor(() =>
      expect(page().getByRole("img", { name: "1W price history" })).toBeTruthy(),
    );
    expect(page().queryByText("No price history for this range.")).toBeNull();
  });

  test("uses initials as the safe mark when metadata has no image", () => {
    renderInvest(<InvestExperience />);
    expect(page().getByRole("img", { name: "NVIDIA icon" }).textContent).toBe("NV");
    expect(page().getByRole("img", { name: "Bitcoin icon" }).textContent).toBe("BT");
    expect(page().getByRole("img", { name: "NVIDIA icon" }).querySelector("svg")).toBeNull();
    expect(page().queryByText("Degen")).toBeNull();
  });

  test("holds hub, category, and detail marks on 32px shimmer while icons are pending", async () => {
    renderInvest(<InvestExperience iconsPending />);
    const amazon = page().getByRole("img", { name: "Amazon icon" });
    expect(amazon.querySelector("[data-shimmer='mark']")).toBeTruthy();
    expect(amazon.textContent).toBe("");
    expect(amazon.querySelector("img")).toBeNull();

    fireEvent.click(page().getAllByRole("button", { name: "See all ›" })[0]!);
    await waitFor(() =>
      expect(page().getByRole("heading", { name: "Stocks" })).toBeTruthy(),
    );
    const tesla = page().getByRole("img", { name: "Tesla icon" });
    expect(tesla.querySelector("[data-shimmer='mark']")).toBeTruthy();
    expect(tesla.textContent).toBe("");

    fireEvent.click(page().getByRole("button", { name: "Amazon details" }));
    await waitFor(() =>
      expect(page().getByRole("heading", { name: "Amazon" })).toBeTruthy(),
    );
    const detail = page().getByRole("img", { name: "Amazon icon" });
    expect(detail.querySelector("[data-shimmer='mark']")).toBeTruthy();
    expect(detail.textContent).toBe("");
  });

  test("renders a resolved metadata image instead of a shipped SVG mark", () => {
    renderInvest(
      <InvestExperience
        assetIcons={{ cbbtc: "https://icons.example.test/cbbtc.png" }}
      />,
    );
    const bitcoin = page().getByRole("img", { name: "Bitcoin icon" });
    expect(bitcoin.querySelector("img")?.getAttribute("src")).toBe(
      "https://icons.example.test/cbbtc.png",
    );
    expect(bitcoin.querySelector("svg")).toBeNull();
    expect(bitcoin.textContent).toBe("");
  });

  test("shows Codex trending memes on the Memes shelf", () => {
    renderInvest(
      <InvestExperience
        memeStatus="ready"
        memeAssets={[
          {
            id: "base:0x1111111111111111111111111111111111111111",
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
            imageUrl: "https://icons.example.test/higher.png",
          },
        ]}
      />,
    );
    expect(page().getByText("Higher")).toBeTruthy();
    expect(page().getByRole("img", { name: "Higher icon" }).querySelector("img")?.getAttribute("src")).toBe(
      "https://icons.example.test/higher.png",
    );
  });

  test("keeps signed meme Δ% labels on the Memes shelf", () => {
    renderInvest(
      <InvestExperience
        memeStatus="ready"
        memeAssets={[
          {
            id: "base:0x1111111111111111111111111111111111111111",
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
          },
          {
            id: "base:0x2222222222222222222222222222222222222222",
            category: "meme",
            displayName: "Lower",
            displaySymbol: "LOWER",
            initials: "LO",
            chainId: 8453,
            contractAddress: "0x2222222222222222222222222222222222222222",
            availability: "informational",
            descriptor: "Trending on Base",
            representation: {
              tokenSymbol: "LOWER",
              decimals: 18,
              relationship: "Base ERC-20 token.",
            },
            contractUrl:
              "https://basescan.org/token/0x2222222222222222222222222222222222222222",
          },
        ]}
        memeMarket={{
          status: "ready",
          snapshots: [
            {
              assetId: "base:0x1111111111111111111111111111111111111111",
              displayPrice: "$0.0123",
              asOf: "2026-09-07T20:00:00.000Z",
              sourceLabel: "Codex",
              changeLabel: "+5.00%",
            },
            {
              assetId: "base:0x2222222222222222222222222222222222222222",
              displayPrice: "$0.0045",
              asOf: "2026-09-07T20:00:00.000Z",
              sourceLabel: "Codex",
              changeLabel: "-1.25%",
            },
          ],
        }}
      />,
    );
    expect(page().getByText("+5.00%")).toBeTruthy();
    expect(page().getByText("-1.25%")).toBeTruthy();
  });

  test("fail-closes the Memes shelf when trending is unavailable", () => {
    renderInvest(<InvestExperience memeStatus="error" />);
    expect(page().getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(page().queryByText("Degen")).toBeNull();
  });
});
