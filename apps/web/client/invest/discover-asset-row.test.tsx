import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { unavailableMarketData, type MarketDataState } from "@/shared/invest/invest-market";
import { investAssets } from "@/config/invest-assets";
import { DiscoverAssetRow } from "./discover-asset-row";
import { CurrencyMark } from "@/components/currency-mark";

function asset(id: string) {
  const asset = investAssets.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`Missing fixture asset: ${id}`);
  return asset;
}

function readyMarket(changes: Record<string, string>): MarketDataState {
  return {
    status: "ready",
    snapshots: Object.entries(changes).map(([assetId, changeLabel]) => ({
      assetId,
      displayPrice: "$170.30",
      asOf: "2026-09-13T12:00:00.000Z",
      sourceLabel: "Fixture",
      changeLabel,
    })),
  };
}

afterEach(() => {
  cleanup();
});

describe("DiscoverAssetRow", () => {
  test("loading markets render stable Skeleton placeholders, not a finished em dash", () => {
    const view = render(
      <DiscoverAssetRow asset={asset("nvdac")} market={{ status: "loading" }} onOpen={() => {}} />,
    );

    const row = view.container.querySelector("li")!;
    // Known asset identity stays; only the unknown values are skeletons.
    expect(row.textContent).toContain("NVIDIA");
    expect(row.textContent).not.toContain("—");
    expect(row.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(row.querySelector('[data-shimmer="price"]')).not.toBeNull();
    expect(row.querySelector('[data-shimmer="change"]')).not.toBeNull();
    // Skeleton bars occupy the settled row's text dimensions (text-sm line boxes).
    for (const skeleton of row.querySelectorAll<HTMLElement>('[data-slot="skeleton"]')) {
      expect(skeleton.className).toContain("h-5");
      expect(skeleton.className).toContain("animate-pulse");
    }
  });

  test("ready markets keep price and signed change labels", () => {
    const view = render(
      <DiscoverAssetRow asset={asset("nvdac")} market={readyMarket({ nvdac: "+1.5" })} onOpen={() => {}} />,
    );

    expect(view.container.textContent).toContain("NVIDIA");
    expect(view.container.querySelector('[data-money-change="positive"]')).not.toBeNull();
  });

  test("non-loading fallback states keep the existing em dash presentation", () => {
    const view = render(
      <DiscoverAssetRow asset={asset("nvdac")} market={unavailableMarketData} onOpen={() => {}} />,
    );

    expect(view.container.textContent).toContain("—");
    expect(view.container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });
});

describe("CurrencyMark pending shimmer", () => {
  test("pending marks pulse through the owned component, not legacy global shimmer CSS", () => {
    const view = render(<CurrencyMark currency="USD" symbol="USD" pending />);
    const mark = view.container.querySelector("[data-mark='shimmer']")!;
    expect(mark).not.toBeNull();
    expect(mark.className).toContain("animate-pulse");
    expect(mark.className).toContain("motion-reduce:animate-none");
    expect(mark.className).not.toContain("shimmer");
  });

  test("settled marks do not pulse", () => {
    // No flag and no image: the glyph fallback renders settled immediately.
    const view = render(<CurrencyMark currency="XYZ" symbol="XYZ" />);
    const mark = view.container.querySelector("[data-mark]")!;
    expect(mark.className).not.toContain("animate-pulse");
  });
});
