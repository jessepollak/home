import "@/client/account/dom-test-harness";

import React from "react";
import { afterEach, expect, test } from "bun:test";
import { getHomeQueryClient } from "@/client/query/query-client";
import type { MarketPriceRange } from "@/shared/invest/contracts/market-price-history";

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { AssetChart } = await import("./asset-chart");
const originalFetch = window.fetch;
const now = Date.now();
const clock = { value: now, read: () => now, refresh: () => {} };
window.matchMedia = ((query: string) => ({
  matches: query === "(prefers-reduced-motion: reduce)", media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  dispatchEvent: () => true,
})) as typeof window.matchMedia;

function payload(range: MarketPriceRange, values: number[] = [100, 120]) {
  return { version: 1, provider: "codex", assetId: "cbbtc", range, currency: "USD",
    fetchedAt: new Date(now).toISOString(), status: values.length ? "ready" : "empty",
    points: values.map((value, index) => ({ time: new Date(now - (values.length - index) * 3600000).toISOString(), value: String(value) })) };
}
function Harness() {
  const [range, setRange] = React.useState<MarketPriceRange>("1W");
  const [resting, setResting] = React.useState({ change: "", pending: true });
  const [readout, setReadout] = React.useState("");
  const onResting = React.useCallback((change: string | null, pending: boolean) =>
    setResting((old) => old.change === (change ?? "") && old.pending === pending ? old : { change: change ?? "", pending }), []);
  const onReadout = React.useCallback((value: { value: string; time: string } | null) =>
    setReadout(value ? `${value.value} ${value.time}` : ""), []);
  return <>
    <output data-testid="range">{range}</output>
    <output data-testid="change">{resting.pending ? "pending" : resting.change}</output>
    <output data-testid="readout">{resting.pending ? "" : readout}</output>
    <AssetChart assetId="cbbtc" range={range} clock={clock} onRangeChange={(value) => {
      setReadout(""); setResting({ change: "", pending: true }); setRange(value);
    }} onReadout={onReadout} onResting={onResting} />
  </>;
}
afterEach(() => { cleanup(); getHomeQueryClient().clear(); window.fetch = originalFetch; });

test("a rapid second range switch never shows the previous change or scrub under a new label", async () => {
  let resolveDay!: (response: Response) => void;
  const day = new Promise<Response>((resolve) => { resolveDay = resolve; });
  window.fetch = (async (input: RequestInfo | URL) => {
    const range = new URL(String(input), "http://localhost").searchParams.get("range") as MarketPriceRange;
    return range === "1D" ? day : Response.json(payload(range, range === "1W" || range === "1M" ? [100, 120] : []));
  }) as typeof fetch;
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByRole("group", { name: /1 week price history/ })).toBeTruthy());
  fireEvent.keyDown(view.getByRole("group", { name: /1 week price history/ }), { key: "End" });
  expect(view.getByTestId("readout").textContent).toContain("120");
  fireEvent.click(view.getByRole("button", { name: "1D" }));
  expect(view.getByTestId("change").textContent).toBe("pending");
  expect(view.getByTestId("readout").textContent).toBe("");
  fireEvent.click(view.getByRole("button", { name: "1M" }));
  expect(view.getByTestId("change").textContent).toBe("pending");
  expect(view.queryByRole("group", { name: /1 month price history/ })).toBeNull();
  resolveDay(Response.json(payload("1D")));
  await waitFor(() => expect(view.getByRole("group", { name: /1 month price history/ })).toBeTruthy());
  await waitFor(() => expect(view.getByTestId("change").textContent).toContain("since"));
});

test("prefetch waits for the resting active plot and browser idle, then a cached switch retains the pending transition", async () => {
  const originalIdle = window.requestIdleCallback;
  const originalCancel = window.cancelIdleCallback;
  let runIdle: IdleRequestCallback | undefined;
  window.requestIdleCallback = ((callback: IdleRequestCallback) => { runIdle = callback; return 1; }) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = (() => { runIdle = undefined; }) as typeof window.cancelIdleCallback;
  const requests: Array<{ range: MarketPriceRange; speculative: boolean }> = [];
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const range = new URL(String(input), "http://localhost").searchParams.get("range") as MarketPriceRange;
    requests.push({ range, speculative: new Headers(init?.headers).get("x-home-history-priority") === "prefetch" });
    return Response.json(payload(range));
  }) as typeof fetch;
  try {
    const view = render(<Harness />);
    await waitFor(() => expect(view.getByRole("group", { name: /1 week price history/ })).toBeTruthy());
    expect(requests).toEqual([{ range: "1W", speculative: false }]);
    await waitFor(() => expect(runIdle).toBeDefined());
    runIdle!({ didTimeout: false, timeRemaining: () => 50 });
    await waitFor(() => expect(requests).toHaveLength(5));
    expect(requests.filter(({ speculative }) => speculative).map(({ range }) => range).sort())
      .toEqual((["1D", "1M", "3M", "1Y"] satisfies MarketPriceRange[]).sort());
    await waitFor(() => expect(view.container.querySelector('[data-layer-range="1M"][data-layer-state="ready"]')).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "1M" }));
    expect(view.getByTestId("change").textContent).toBe("pending");
    await waitFor(() => expect(view.getByRole("group", { name: /1 month price history/ })).toBeTruthy());
    expect(requests).toHaveLength(5);
  } finally {
    window.requestIdleCallback = originalIdle;
    window.cancelIdleCallback = originalCancel;
  }
});

test("failed history offers Try again and retry refetches; empty history shows no plot", async () => {
  let calls = 0;
  window.fetch = (async (input: RequestInfo | URL) => {
    const range = new URL(String(input), "http://localhost").searchParams.get("range") as MarketPriceRange;
    if (range === "1W" && ++calls === 1) return Response.json({ invalid: true });
    return Response.json(payload(range, []));
  }) as typeof fetch;
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByRole("button", { name: "Try again" })).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(calls).toBe(2));
  await waitFor(() => expect(view.getByText("No price history for this range.")).toBeTruthy());
  expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
});
