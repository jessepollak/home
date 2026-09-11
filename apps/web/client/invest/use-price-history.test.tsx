import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { MarketPriceRange } from "@/shared/invest/history-contract";

const { cleanup, render, waitFor, within } = await import("@testing-library/react");
const { usePriceHistory } = await import("./use-price-history");

const originalFetch = window.fetch;

function page() {
  return within(document.body);
}

function historyPayload(
  assetId: string,
  range: MarketPriceRange,
  points: readonly { time: string; value: unknown }[],
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

  test.each([
    ["zero integer", "0"],
    ["zero decimal with a positive exponent", "0.0e+123"],
    ["zero with an uppercase negative exponent", "0E-7"],
    ["negative", "-1"],
    ["malformed", "1e"],
    ["non-string", 1],
  ] as const)("rejects %s history values", async (_description, value) => {
    window.fetch = (async () =>
      Response.json(
        historyPayload("cbbtc", "1W", [
          { time: "2026-09-09T00:00:00.000Z", value },
        ]),
      )) as unknown as typeof fetch;

    render(<HookProbe assetId="cbbtc" range="1W" />);

    await waitFor(() => expect(page().getByTestId("status").textContent).toBe("error"));
    expect(page().getByTestId("count").textContent).toBe("0");
    expect(page().getByTestId("first").textContent).toBe("");
  });

  test.each([
    ["positive decimal", "0.0123"],
    ["lowercase scientific", "1.25e-7"],
    ["uppercase scientific", "6.02E+23"],
  ] as const)("preserves an exact %s history value", async (_description, value) => {
    window.fetch = (async () =>
      Response.json(
        historyPayload("cbbtc", "1W", [
          { time: "2026-09-09T00:00:00.000Z", value },
        ]),
      )) as unknown as typeof fetch;

    render(<HookProbe assetId="cbbtc" range="1W" />);

    await waitFor(() => expect(page().getByTestId("status").textContent).toBe("ready"));
    expect(page().getByTestId("count").textContent).toBe("1");
    expect(page().getByTestId("first").textContent).toBe(value);
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

describe("point value validation", () => {
  // Mutation-sensitive: old code used !/[1-9]/.test(point.value) on the full string,
  // so exponent digits (e.g. the "1" in "0.0e+1") would satisfy the check, letting
  // zero-priced points through. New code splits on /[eE]/ and tests mantissa only.

  test("rejects '0.0e+1' — zero mantissa, exponent digit '1' fools old full-string check", async () => {
    // old: !/[1-9]/.test("0.0e+1") → false (1 found) → point kept → status "ready"
    // new: !/[1-9]/.test("0.0")    → true  (none)    → return null → status "error"
    window.fetch = (async () =>
      Response.json(
        historyPayload("cbbtc", "1W", [
          { time: "2026-09-01T00:00:00.000Z", value: "0.0e+1" },
        ]),
      )) as unknown as typeof fetch;
    render(<HookProbe assetId="cbbtc" range="1W" />);
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("error"),
    );
    expect(page().getByTestId("count").textContent).toBe("0");
  });

  test("rejects '0.0e+5' — zero mantissa, exponent digit '5' fools old full-string check", async () => {
    // old: !/[1-9]/.test("0.0e+5") → false (5 found) → point kept → status "ready"
    // new: !/[1-9]/.test("0.0")    → true  (none)    → return null → status "error"
    window.fetch = (async () =>
      Response.json(
        historyPayload("cbbtc", "1W", [
          { time: "2026-09-01T00:00:00.000Z", value: "0.0e+5" },
        ]),
      )) as unknown as typeof fetch;
    render(<HookProbe assetId="cbbtc" range="1W" />);
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("error"),
    );
    expect(page().getByTestId("count").textContent).toBe("0");
  });

  test("accepts '1.23e-4' — non-zero mantissa is correctly kept", async () => {
    window.fetch = (async () =>
      Response.json(
        historyPayload("cbbtc", "1W", [
          { time: "2026-09-01T00:00:00.000Z", value: "1.23e-4" },
        ]),
      )) as unknown as typeof fetch;
    render(<HookProbe assetId="cbbtc" range="1W" />);
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("ready"),
    );
    expect(page().getByTestId("count").textContent).toBe("1");
    expect(page().getByTestId("first").textContent).toBe("1.23e-4");
  });

  test("rejects '0e0' — zero with zero exponent, no [1-9] in mantissa or full string", async () => {
    window.fetch = (async () =>
      Response.json(
        historyPayload("cbbtc", "1W", [
          { time: "2026-09-01T00:00:00.000Z", value: "0e0" },
        ]),
      )) as unknown as typeof fetch;
    render(<HookProbe assetId="cbbtc" range="1W" />);
    await waitFor(() =>
      expect(page().getByTestId("status").textContent).toBe("error"),
    );
    expect(page().getByTestId("count").textContent).toBe("0");
  });
});
