import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { AssetMarkResolution } from "@/client/asset-mark/presentation";
import { assetKeyForErc20 } from "@/config/portfolio-assets";
import type { BalanceRowModel } from "@/shared/balances/present";
import { HomeBalancesList } from "./balances-panel";

const CBBTC_KEY = assetKeyForErc20("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf");
const RESOLVED_CBBTC_IMAGE = "https://assets.example.invalid/cbbtc.png";
const CATALOG_IMAGE = "https://assets.example.invalid/aero.png";

const rows: BalanceRowModel[] = [
  { key: "cash", group: "cash", name: "US dollar", mark: { kind: "flag", currency: "USD" }, primary: "$12.34", secondary: null, tone: "default" },
  { key: "catalog", group: "asset", name: "Aerodrome", mark: { kind: "image", url: "https://assets.example.invalid/aero.png", fallbackSymbol: "AERO" }, primary: "$18.20", secondary: "12.5 AERO", tone: "default" },
  { key: "registry", group: "asset", name: "Bitcoin", mark: { kind: "symbol", symbol: "cbBTC" }, primary: "0.0010 cbBTC", secondary: null, tone: "muted" },
  { key: "unavailable", group: "cash", name: "Euro", mark: { kind: "flag", currency: "EUR" }, primary: "Unavailable", secondary: null, tone: "error" },
];

afterEach(cleanup);

describe("HomeBalanceRowView", () => {
  test("resolves registry symbols while preserving symbol and catalog image fallbacks", () => {
    const registryRow: BalanceRowModel = {
      key: CBBTC_KEY,
      group: "asset",
      name: "Bitcoin",
      mark: { kind: "symbol", symbol: "cbBTC" },
      primary: "0.0010 cbBTC",
      secondary: null,
      tone: "muted",
    };
    const resolution: AssetMarkResolution = {
      images: { [CBBTC_KEY]: RESOLVED_CBBTC_IMAGE },
    };
    const view = render(
      <HomeBalancesList
        rows={[registryRow]}
        assetMarkResolution={resolution}
        isLoading={false}
      />,
    );

    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      RESOLVED_CBBTC_IMAGE,
    );

    view.rerender(
      <HomeBalancesList rows={[registryRow]} isLoading={false} />,
    );
    expect(view.container.querySelector("img")).toBeNull();
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
      <HomeBalancesList
        rows={[catalogRow]}
        assetMarkResolution={{ images: { [catalogRow.key]: RESOLVED_CBBTC_IMAGE } }}
        isLoading={false}
      />,
    );
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(CATALOG_IMAGE);
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
