import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { MarketPriceRange } from "@/server/market-data/codex/history-contract";

const { cleanup, render, waitFor, within } = await import("@testing-library/react");
const { usePriceHistory } = await import("./use-price-history");

const originalFetch = window.fetch;

function page() {
  return within(document.body);
}

function historyPayload(
  assetId: string,
  range: MarketPriceRange,
  points: readonly { time: string; value: string }[],
) {
  return {
    version: 1,
    provider: "codex",
    assetId,
    range,
    currency: "USD",
    fetchedAt: "2026-09-07T20:00:00.000Z",
    status: "ready" as const,
    points,
  };
}

function HookProbe({
  assetId,
  range,
}: {
  assetId: string;
  range: MarketPriceRange;
}) {
  const history = usePriceHistory(assetId, range);
  return (
    <div>
      <output data-testid="status">{history.status}</output>
      <output data-testid="count">{String(history.points.length)}</output>
      <output data-testid="first">{history.points[0]?.value ?? ""}</output>
    </div>
  );
}

afterEach(() => {
  cleanup();
  window.fetch = originalFetch;
});

describe("usePriceHistory", () => {
  test("keeps the last ready series while a new range for the same asset loads", async () => {
    window.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const range = url.includes("range=1D") ? "1D" : "1W";
      if (range === "1D") {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return Response.json(
        historyPayload("cbbtc", range, [
          {
            time: range === "1D" ? "2026-09-08T00:00:00.000Z" : "2026-09-01T00:00:00.000Z",
            value: range === "1D" ? "64100" : "62000",
          },
        ]),
      );
    }) as unknown as typeof fetch;

    const { rerender } = render(<HookProbe assetId="cbbtc" range="1W" />);
    await waitFor(() => expect(page().getByTestId("status").textContent).toBe("ready"));
    expect(page().getByTestId("first").textContent).toBe("62000");

    rerender(<HookProbe assetId="cbbtc" range="1D" />);
    expect(page().getByTestId("status").textContent).toBe("loading");
    expect(page().getByTestId("count").textContent).toBe("1");
    expect(page().getByTestId("first").textContent).toBe("62000");

    await waitFor(() => expect(page().getByTestId("status").textContent).toBe("ready"));
    expect(page().getByTestId("first").textContent).toBe("64100");
  });

  test("accepts a matching canonical dynamic Base response and rejects mismatched identity", async () => {
    const dynamicId = "base:0x1111111111111111111111111111111111111111";
    let mismatch = false;
    window.fetch = (async () =>
      Response.json(
        historyPayload(
          mismatch
            ? "base:0x2222222222222222222222222222222222222222"
            : dynamicId,
          mismatch ? "1D" : "1W",
          [{ time: "2026-09-09T00:00:00.000Z", value: "0.0123" }],
        ),
      )) as unknown as typeof fetch;

    const { rerender } = render(<HookProbe assetId={dynamicId} range="1W" />);
    await waitFor(() => expect(page().getByTestId("status").textContent).toBe("ready"));
    expect(page().getByTestId("first").textContent).toBe("0.0123");

    mismatch = true;
    rerender(<HookProbe assetId={dynamicId} range="1D" />);
    await waitFor(() => expect(page().getByTestId("status").textContent).toBe("error"));
    expect(page().getByTestId("count").textContent).toBe("0");
  });

  test("does not keep another asset’s series while the next history loads", async () => {
    window.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const assetId = url.includes("assetId=cbltc") ? "cbltc" : "cbbtc";
      if (assetId === "cbltc") {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return Response.json(
        historyPayload(assetId, "1W", [
          {
            time: "2026-09-01T00:00:00.000Z",
            value: assetId === "cbltc" ? "110" : "62000",
          },
        ]),
      );
    }) as unknown as typeof fetch;

    const { rerender } = render(<HookProbe assetId="cbbtc" range="1W" />);
    await waitFor(() => expect(page().getByTestId("status").textContent).toBe("ready"));
    expect(page().getByTestId("first").textContent).toBe("62000");

    rerender(<HookProbe assetId="cbltc" range="1W" />);
    expect(page().getByTestId("status").textContent).toBe("loading");
    expect(page().getByTestId("count").textContent).toBe("0");
  });
});
