import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { assetKeyForErc20 } from "@/config/portfolio-assets";
import {
  buildBalancesSnapshotFixture,
  catalogHolding,
  priced,
} from "@/shared/balances/fixtures";
import {
  presentBalances,
  type BalanceRowModel,
  type BalancesPresentation,
} from "@/shared/balances/present";
import { BalancesPage } from "./balances-panel";
import { HomeBalancesList } from "./balances-list";
import { showSmallBalancesPreferenceKey } from "./use-show-small-balances";

const CBBTC_KEY = assetKeyForErc20("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf");
const CBBTC_IMAGE = "https://assets.example.invalid/cbbtc.png";
const CATALOG_IMAGE = "https://assets.example.invalid/aero.png";

const rows: BalanceRowModel[] = [
  { key: "cash", group: "cash", name: "US dollar", mark: { kind: "flag", currency: "USD" }, primary: "$12.34", secondary: null, tone: "default" },
  { key: "catalog", group: "asset", name: "Aerodrome", mark: { kind: "image", url: CATALOG_IMAGE, fallbackSymbol: "AERO" }, primary: "$18.20", secondary: "12.5 AERO", tone: "default" },
  { key: "registry", group: "asset", name: "Bitcoin", mark: { kind: "symbol", symbol: "cbBTC" }, primary: "0.0010 cbBTC", secondary: null, tone: "muted" },
  { key: "unavailable", group: "cash", name: "Euro", mark: { kind: "flag", currency: "EUR" }, primary: "Unavailable", secondary: null, tone: "error" },
];

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderBalancesPage(assetBalances: BalancesPresentation) {
  return render(
    <BalancesPage
      active
      assetBalances={assetBalances}
      showSmallBalances={false}
      revealSmallBalances={false}
      onRevealSmallBalancesChange={() => {}}
      isChecking={false}
      revealedCount={10}
      onRevealMore={() => {}}
    />,
  );
}

describe("HomeBalanceRowView", () => {
  test("uses holding images and renders configured initials immediately without a pending disc", () => {
    const registryImageRow: BalanceRowModel = {
      key: CBBTC_KEY,
      group: "asset",
      name: "Bitcoin",
      mark: { kind: "image", url: CBBTC_IMAGE, fallbackSymbol: "cbBTC" },
      primary: "$60.00",
      secondary: "0.0010 cbBTC",
      tone: "default",
    };
    const view = render(
      <HomeBalancesList rows={[registryImageRow]} isLoading={false} />,
    );

    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(CBBTC_IMAGE);

    const registryInitialsRow: BalanceRowModel = {
      ...registryImageRow,
      mark: { kind: "symbol", symbol: "cbBTC" },
    };
    view.rerender(
      <HomeBalancesList rows={[registryInitialsRow]} isLoading={false} />,
    );
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector("[data-shimmer='mark']")).toBeNull();
    expect(view.container.querySelector("[data-mark]")?.textContent).toBe("BT");

    const catalogRow: BalanceRowModel = {
      key: "eip155:8453/erc20:0x940181a94a35a4569e4529a3cdfb74e38fd98631",
      group: "asset",
      name: "Aerodrome",
      mark: { kind: "image", url: CATALOG_IMAGE, fallbackSymbol: "AERO" },
      primary: "$18.20",
      secondary: "12.5 AERO",
      tone: "default",
    };
    view.rerender(
      <HomeBalancesList rows={[catalogRow]} isLoading={false} />,
    );
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(CATALOG_IMAGE);
  });

  test("preserves the exact accessible monetary value when the label and amount are long", () => {
    const exactValue = "$123,456,789,012,345,678,901,234.56 USD";
    const longRow: BalanceRowModel = {
      key: "long-value",
      group: "asset",
      name: "International diversified treasury reserve position",
      mark: { kind: "symbol", symbol: "RESERVE" },
      primary: exactValue,
      secondary: "99,999,999,999.0000 RESERVE",
      tone: "default",
    };

    const view = render(<HomeBalancesList rows={[longRow]} isLoading={false} />);
    const ticker = view.getByRole("img", { name: exactValue });

    expect(ticker.getAttribute("aria-label")).toBe(exactValue);
    expect(ticker.querySelector('[aria-hidden="true"]')?.textContent).toBe("$1.23457e23 USD");
    expect(view.getByText(longRow.name).textContent).toBe(longRow.name);
  });

  test("the small-balances affordance reveals without writing the device preference", () => {
    const snapshot = buildBalancesSnapshotFixture({
      catalog: [catalogHolding({
        address: "0x7777777777777777777777777777777777777777",
        name: "Dust Token",
        symbol: "DUST",
        decimals: 18,
      }, "1", priced("USD", "9", 3))],
    });

    function TransientBalancesPage() {
      const [revealSmallBalances, setRevealSmallBalances] = useState(false);
      const presentation = presentBalances(
        { status: "ready", snapshot, error: null },
        { showSmallBalances: revealSmallBalances },
      );
      return (
        <BalancesPage
          active
          assetBalances={presentation}
          showSmallBalances={false}
          revealSmallBalances={revealSmallBalances}
          onRevealSmallBalancesChange={setRevealSmallBalances}
          isChecking={false}
          revealedCount={10}
          onRevealMore={() => {}}
        />
      );
    }

    const view = render(<TransientBalancesPage />);
    expect(view.queryByText("Dust Token")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Show" }));
    expect(view.getByText("Dust Token")).toBeTruthy();
    expect(window.localStorage.getItem(showSmallBalancesPreferenceKey)).toBeNull();

    view.unmount();
    const freshPageLoad = render(<TransientBalancesPage />);
    expect(freshPageLoad.queryByText("Dust Token")).toBeNull();
    expect(freshPageLoad.getByText("1 small balance hidden", { exact: false })).toBeTruthy();
  });

  test("keeps a cached stale balance quiet while background revalidation runs", () => {
    const snapshot = {
      ...buildBalancesSnapshotFixture({ fetchedAt: "2026-09-13T12:00:00.000Z" }),
      stale: true as const,
    };
    const view = renderBalancesPage(presentBalances(
      { status: "ready", snapshot, error: null, revalidating: true },
      { showSmallBalances: false },
    ));

    expect(view.queryByText(/Updated|ago/)).toBeNull();
    expect(view.container.querySelector("[data-total-status]")).toBeNull();
    // Rows still render where the removed label used to sit, leaving no blank gap.
    expect(view.container.querySelectorAll("li").length).toBeGreaterThan(0);
  });

  test("keeps the unavailable recovery label on the balances page", () => {
    const view = renderBalancesPage(presentBalances(
      { status: "error", snapshot: null, error: "balances-unavailable" },
      { showSmallBalances: false },
    ));

    expect(view.getByText("Balance unavailable")).toBeTruthy();
    expect(
      view.container.querySelector("[data-total-status]")?.getAttribute("data-total-status"),
    ).toBe("unavailable");
  });

  test("renders every balance source through the same row anatomy", () => {
    const view = render(<HomeBalancesList rows={rows} isLoading={false} />);
    const listItems = view.container.querySelectorAll("li");
    expect(listItems).toHaveLength(4);
    const text = [...listItems].map((item) => item.textContent ?? "");
    expect(text[0]).toContain("US dollar");
    expect(text[0]).toContain("$12.34");
    expect(text[1]).toContain("Aerodrome");
    expect(text[1]).toContain("12.5 AERO");
    expect(text[1]).toContain("$18.20");
    expect(text[2]).toContain("Bitcoin");
    expect(text[2]).toContain("0.0010 cbBTC");
    expect(text[3]).toContain("Euro");
    expect(text[3]).toContain("Unavailable");
    expect(view.container.querySelectorAll('[data-tone="mark"]')).toHaveLength(4);
    expect(view.container.querySelectorAll('[data-mark], [data-shimmer="mark"]')).toHaveLength(4);
    expect(view.container.textContent).not.toContain("Updating…");
  });
});
