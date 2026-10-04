import "@/client/account/dom-test-harness";
import { afterEach, expect, spyOn, test } from "bun:test";
import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence } from "motion/react";
import { getHomeQueryClient } from "@/client/query/query-client";
import { parseInvestSearchResponse } from "@/shared/invest/contracts/search";
import { searchFixture } from "@/tests/browser/feature-map/search-fixtures";
import { unavailableMarketData } from "@/shared/invest/invest-market";
const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { AssetSearch } = await import("./asset-search");
const { AssetSearchResults } = await import("./asset-search-results");
const { PrimaryNavigation } = await import("@/components/primary-navigation");
const { act } = await import("@testing-library/react");
const { InvestExperience } = await import("./invest-experience");
import type { AssetSearchState } from "./asset-search-results";
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); getHomeQueryClient().clear(); globalThis.fetch = originalFetch; window.history.replaceState(null, "", "/"); });
const markets = { stockMarket: unavailableMarketData, cryptoMarket: unavailableMarketData, memeMarket: unavailableMarketData };
const noop = () => {};
function searchScroll(view: ReturnType<typeof render>) {
  const scroll = view.container.querySelector<HTMLDivElement>("[data-asset-search-scroll]");
  if (!scroll) throw new Error("Expected results scroll container");
  Object.defineProperties(scroll, { scrollHeight: { configurable: true, value: 300 }, clientHeight: { configurable: true, value: 200 } });
  return scroll;
}

test("search field preserves literal device input and search keyboard hints", () => {
  const view = render(<AssetSearch initialQuery="" onInputReady={noop} onClose={noop} onQueryCommit={noop} onOpenAsset={noop} />);
  const input = view.getByRole("textbox", { name: "Search assets" });
  expect(Object.fromEntries(["autocomplete", "autocorrect", "autocapitalize", "spellcheck", "enterkeyhint", "inputmode"].map((attribute) => [attribute, input.getAttribute(attribute)]))).toEqual({
    autocomplete: "off", autocorrect: "off", autocapitalize: "none", spellcheck: "false", enterkeyhint: "search", inputmode: "search",
  });
});

test.each([false, true])("cold-return container keeps %s Shift+Tab inside the search surface", async (shiftKey) => {
  globalThis.fetch = Object.assign(async () => Response.json(searchFixture("ORB")), { preconnect: originalFetch.preconnect });
  const view = render(<><button>Background navigation</button><AssetSearch initialQuery="ORB" initialResultId="base:0x4444444444444444444444444444444444444444"
    onInputReady={noop} onClose={noop} onQueryCommit={noop} onOpenAsset={noop} /></>);
  const scroll = searchScroll(view);
  await waitFor(() => expect(document.activeElement === scroll).toBe(true));
  const rects = spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() => Object.assign([new DOMRect(0, 0, 40, 40)], { item: () => null }));
  try {
    const first = view.getAllByRole("button", { name: /Orbit/ })[0];
    if (!first) throw new Error("Expected first result");
    const last = view.getByRole("button", { name: "Close search" });
    expect(fireEvent.keyDown(scroll, { key: "Tab", shiftKey })).toBe(false);
    expect(document.activeElement).toBe(shiftKey ? last : first);
    (shiftKey ? first : last).focus();
    fireEvent.keyDown(document.activeElement ?? scroll, { key: "Tab", shiftKey });
    expect(document.activeElement).toBe(shiftKey ? last : first);
  } finally { rects.mockRestore(); }
});

test("saved result restoration survives a failed first read and Retry", async () => {
  let reads = 0;
  globalThis.fetch = Object.assign(async () => ++reads === 1 ? new Response(null, { status: 503 }) : Response.json(searchFixture("ORB")), { preconnect: originalFetch.preconnect });
  const view = render(<AssetSearch initialQuery="ORB" initialScrollTop={70} initialResultId="base:0x2222222222222222222222222222222222222222"
    onInputReady={noop} onClose={noop} onQueryCommit={noop} onOpenAsset={noop} />);
  const scroll = searchScroll(view);
  fireEvent.click(await view.findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(document.activeElement?.getAttribute("data-search-asset-id")).toBe("base:0x2222222222222222222222222222222222222222"));
  expect(scroll.scrollTop).toBe(70);
  expect(reads).toBe(2);
});
test("cached results restore scroll and focus after a pagination error", async () => {
  let reads = 0;
  globalThis.fetch = Object.assign(async () => ++reads === 1
    ? Response.json({ ...searchFixture("ORB"), nextOffset: 30 })
    : new Response(null, { status: 503 }), { preconnect: originalFetch.preconnect });
  const first = render(<AssetSearch initialQuery="ORB" onInputReady={noop} onClose={noop} onQueryCommit={noop} onOpenAsset={noop} />);
  searchScroll(first);
  await first.findAllByRole("button", { name: /Orbit/ });
  fireEvent.click(first.getByRole("button", { name: "Load more" }));
  await first.findByText("More results couldn’t load.");
  first.unmount();
  const view = render(<AssetSearch initialQuery="ORB" initialScrollTop={70} initialResultId="base:0x2222222222222222222222222222222222222222"
    onInputReady={noop} onClose={noop} onQueryCommit={noop} onOpenAsset={noop} />);
  const scroll = searchScroll(view);
  await waitFor(() => expect(document.activeElement?.getAttribute("data-search-asset-id")).toBe("base:0x2222222222222222222222222222222222222222"));
  expect(scroll.scrollTop).toBe(70);
});

test("cold return clamps scroll and focuses results without rebuilding missing pages", async () => {
  const offsets: number[] = [];
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    offsets.push(Number(new URL(String(input), "http://localhost").searchParams.get("offset")));
    return Response.json({ ...searchFixture("ORB"), nextOffset: 30 });
  }, { preconnect: originalFetch.preconnect });
  const view = render(<AssetSearch initialQuery="ORB" initialScrollTop={900} initialResultId="base:0x4444444444444444444444444444444444444444"
    onInputReady={noop} onClose={noop} onQueryCommit={noop} onOpenAsset={noop} />);
  const scroll = searchScroll(view);
  await waitFor(() => expect(document.activeElement === scroll).toBe(true));
  expect(scroll.scrollTop).toBe(100);
  expect(offsets).toEqual([0]);
  fireEvent.click(view.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(offsets).toEqual([0, 30]));
  expect(scroll.scrollTop).toBe(100);
});

test("user scrolling during loading cancels saved result restoration", async () => {
  let resolve: ((response: Response) => void) | undefined;
  let requested = false;
  globalThis.fetch = Object.assign(async () => { requested = true; return new Promise<Response>((done) => { resolve = done; }); }, { preconnect: originalFetch.preconnect });
  const view = render(<AssetSearch initialQuery="ORB" initialScrollTop={70} initialResultId="base:0x2222222222222222222222222222222222222222"
    onInputReady={noop} onClose={noop} onQueryCommit={noop} onOpenAsset={noop} />);
  const scroll = searchScroll(view);
  await waitFor(() => expect(requested).toBe(true));
  scroll.scrollTop = 13; fireEvent.scroll(scroll);
  if (!resolve) throw new Error("Expected pending results read");
  const finish = resolve;
  await act(async () => finish(Response.json(searchFixture("ORB"))));
  await view.findAllByRole("button", { name: /Orbit/ });
  expect(scroll.scrollTop).toBe(13);
  expect(document.activeElement).toBe(view.getByRole("dialog", { name: "Search assets" }));
});
function Journey({ committed, owner = "owner-a" }: { committed: string[]; owner?: string }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const commitQuery = useCallback((query: string) => committed.push(query), [committed]);
  return <><PrimaryNavigation activeNavigation="home" onNavigate={noop} onOpenSearch={(opener) => {
    openerRef.current = opener; flushSync(() => setOpen(true)); inputRef.current?.focus({ preventScroll: true });
  }} /><AnimatePresence key={owner}>{open ? <AssetSearch key="search" initialQuery="" onInputReady={(input) => { inputRef.current = input; }} onClose={() => { flushSync(() => setOpen(false)); openerRef.current?.focus({ preventScroll: true }); }}
    onQueryCommit={commitQuery} onOpenAsset={noop} /> : null}</AnimatePresence></>;
}
test("opening focuses in the click and retains the first typed characters until debounced commit", async () => {
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => Response.json(searchFixture(new URL(String(input), "http://localhost").searchParams.get("q") ?? "")), { preconnect: originalFetch.preconnect });
  const committed: string[] = [];
  const view = render(<Journey committed={committed} />);
  fireEvent.click(view.getByRole("button", { name: "Search assets" }));
  const input = view.getByRole("textbox", { name: "Search assets" });
  if (!(input instanceof HTMLInputElement)) throw new Error("Expected the search input");
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "B" } });
  fireEvent.change(input, { target: { value: "BTC" } });
  expect(input.value).toBe("BTC");
  expect(committed.filter(Boolean)).toEqual([]);
  await waitFor(() => expect(committed.filter(Boolean)).toEqual(["BTC"]));
});
test("Close and non-composing Escape restore the opener while composing Escape stays open", () => {
  const view = render(<Journey committed={[]} />);
  const opener = view.getByRole("button", { name: "Search assets" });
  fireEvent.click(opener);
  const input = view.getByRole("textbox", { name: "Search assets" });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  expect(view.getByRole("dialog", { name: "Search assets" })).toBeTruthy();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(view.queryByRole("dialog", { name: "Search assets" })).toBeNull();
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener);
  fireEvent.click(view.getByRole("button", { name: "Close search" }));
  expect(document.activeElement).toBe(opener);
});
test("close mid-enter is inert immediately and rapid reopen retains synchronous focus without stale input", async () => {
  globalThis.fetch = Object.assign(async () => Response.json(searchFixture("BTC")), { preconnect: originalFetch.preconnect });
  const committed: string[] = [];
  const view = render(<Journey committed={committed} />);
  const opener = view.getByRole("button", { name: "Search assets" });
  fireEvent.click(opener);
  const input = view.getByRole("textbox", { name: "Search assets" });
  fireEvent.change(input, { target: { value: "B" } });
  fireEvent.click(view.getByRole("button", { name: "Close search" }));
  expect(view.queryByRole("dialog", { name: "Search assets" })).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(committed.filter(Boolean)).toEqual([]);
  fireEvent.click(opener);
  const reopened = view.getByRole("textbox", { name: "Search assets" });
  if (!(reopened instanceof HTMLInputElement)) throw new Error("Expected the search input");
  expect(document.activeElement).toBe(reopened);
  expect(reopened.value).toBe("");
  fireEvent.change(reopened, { target: { value: "BTC" } });
  await waitFor(() => expect(committed.filter(Boolean)).toEqual(["BTC"]));
});
test.each([false, true])("settled query rapid reopen rejects old commits/results with composition %s", async (composing) => {
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => Response.json(searchFixture(new URL(String(input), "http://localhost").searchParams.get("q") ?? "")), { preconnect: originalFetch.preconnect });
  const committed: string[] = [];
  const view = render(<Journey committed={committed} />);
  const opener = view.getByRole("button", { name: "Search assets" });
  fireEvent.click(opener);
  const input = view.getByRole("textbox", { name: "Search assets" });
  fireEvent.change(input, { target: { value: "ORB" } });
  await waitFor(() => expect(committed.filter(Boolean)).toEqual(["ORB"]));
  await view.findAllByRole("button", { name: /Orbit/ });
  if (composing) fireEvent.compositionStart(input);
  committed.length = 0;
  fireEvent.click(view.getByRole("button", { name: "Close search" }));
  expect(input.isConnected).toBe(true);
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener);
  const reopened = view.getByRole("textbox", { name: "Search assets" });
  expect(reopened).toBe(input);
  if (!(reopened instanceof HTMLInputElement)) throw new Error("Expected the search input");
  expect(reopened.value).toBe("");
  expect(document.activeElement).toBe(reopened);
  expect(view.queryByRole("region", { name: "Search results" })).toBeNull();
  expect(committed.filter(Boolean)).toEqual([]);
  fireEvent.change(reopened, { target: { value: "B" } });
  expect(reopened.value).toBe("B");
  fireEvent.change(reopened, { target: { value: "BTC" } });
  await waitFor(() => expect(committed.filter(Boolean)).toEqual(["BTC"]));
  expect(await view.findByRole("button", { name: /Bitcoin/ })).toBeTruthy();
  expect(view.queryByRole("button", { name: /Orbit/ })).toBeNull();
  expect(document.activeElement).toBe(reopened);
});

test("retained reopen restores only the new query's result, even when the reset query is unchanged", async () => {
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => Response.json(searchFixture(new URL(String(input), "http://localhost").searchParams.get("q") ?? "")), { preconnect: originalFetch.preconnect });
  const commits: string[] = [];
  const commit = (query: string) => commits.push(query);
  function RestorationJourney() {
    const [open, setOpen] = useState(true);
    const [initialQuery, setInitialQuery] = useState("ORB");
    return <><button onClick={() => { setInitialQuery("BTC"); flushSync(() => setOpen(true)); }}>Reopen BTC</button>
      <AnimatePresence>{open ? <AssetSearch key="search" initialQuery={initialQuery} initialResultId={initialQuery === "BTC" ? "cbbtc" : null}
        onInputReady={noop} onClose={() => flushSync(() => setOpen(false))} onQueryCommit={commit} onOpenAsset={noop} /> : null}</AnimatePresence></>;
  }
  const view = render(<RestorationJourney />);
  await view.findAllByRole("button", { name: /Orbit/ });
  const input = view.getByRole("textbox", { name: "Search assets" });
  if (!(input instanceof HTMLInputElement)) throw new Error("Expected the search input");
  fireEvent.click(view.getByRole("button", { name: "Close search" }));
  commits.length = 0;
  fireEvent.click(view.getByRole("button", { name: "Reopen BTC" }));
  expect(commits.filter(Boolean)).toEqual([]);
  expect(input.value).toBe("BTC");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-search-asset-id")).toBe("cbbtc"));
  expect(commits.filter(Boolean)).toEqual(["BTC"]);
  fireEvent.click(view.getByRole("button", { name: "Close search" }));
  fireEvent.click(view.getByRole("button", { name: "Reopen BTC" }));
  await waitFor(() => expect(document.activeElement?.getAttribute("data-search-asset-id")).toBe("cbbtc"));
});

test("owner change discards the old entering surface and unmount leaves no input reference", () => {
  const committed: string[] = [];
  const view = render(<Journey committed={committed} />);
  fireEvent.click(view.getByRole("button", { name: "Search assets" }));
  const input = view.getByRole("textbox", { name: "Search assets" });
  fireEvent.change(input, { target: { value: "old" } });
  view.rerender(<Journey committed={committed} owner="owner-b" />);
  expect(input.isConnected).toBe(false);
  const replacement = view.getByRole("textbox", { name: "Search assets" });
  if (!(replacement instanceof HTMLInputElement)) throw new Error("Expected the search input");
  expect(replacement.value).toBe("");
  view.unmount();
  expect(replacement.isConnected).toBe(false);
  expect(committed.filter(Boolean)).toEqual([]);
});
const page = parseInvestSearchResponse(searchFixture("ORB"));
if (!page) throw new Error("Invalid search fixture");
const ready: AssetSearchState = { activeQuery: "ORB", status: "ready", results: [...page.results], snapshots: [...page.snapshots], partial: false, nextOffset: null,
  loadingMore: false, loadMoreError: false, retry: noop, loadMore: noop, retryLoadMore: noop };
for (const [name, state, expected] of [
  ["loading", { status: "loading", results: [] }, "Loading search results"],
  ["empty", { results: [] }, "No results"],
  ["error", { status: "error", results: [] }, "Search unavailable"],
  ["partial", { partial: true }, "Some results couldn’t load."],
] as const) test(`results preserve the ${name} state`, () => {
  const view = render(<AssetSearchResults query="ORB" composing={false} search={{ ...ready, ...state, results: "results" in state ? [] : ready.results }} markets={markets} assetMarkResolution={{}} onOpenAsset={noop} />);
  expect(name === "loading" ? view.getByLabelText(expected) : view.getAllByText(expected).length).toBeTruthy();
});
test("error and continuation controls retry only their own operation", () => {
  const calls: string[] = [];
  const view = render(<AssetSearchResults query="ORB" composing={false} search={{ ...ready, partial: true, nextOffset: 30, retry: () => calls.push("retry"), loadMore: () => calls.push("more") }} markets={markets} assetMarkResolution={{}} onOpenAsset={noop} />);
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  fireEvent.click(view.getByRole("button", { name: "Load more" }));
  expect(calls).toEqual(["retry", "more"]);
  view.rerender(<AssetSearchResults query="ORB" composing={false} search={{ ...ready, loadMoreError: true, retryLoadMore: () => calls.push("retry-more") }} markets={markets} assetMarkResolution={{}} onOpenAsset={noop} />);
  fireEvent.click(view.getByRole("button", { name: "Retry more" })); expect(calls.at(-1)).toBe("retry-more");
});
test("hidden assets stay out of search results", async () => {
  globalThis.fetch = Object.assign(async () => Response.json(searchFixture("BTC")), { preconnect: originalFetch.preconnect });
  const view = render(<AssetSearch initialQuery="BTC" onInputReady={noop} onClose={noop} onQueryCommit={noop} onOpenAsset={noop} investVisibility={{ hiddenCategories: [], hiddenAssets: ["cbbtc"] }} />);
  await waitFor(() => expect(view.getByText("No assets found for “BTC”.")).toBeTruthy());
  expect(view.queryByRole("button", { name: /Bitcoin/ })).toBeNull();
});
test("Search access is absent when the shell supplies no visible-shelf search slot", () => {
  const view = render(<PrimaryNavigation activeNavigation="home" onNavigate={noop} />);
  expect(view.queryByRole("button", { name: "Search assets" })).toBeNull();
});
test("asset detail Back from search traverses history", () => {
  const back = spyOn(window.history, "back").mockImplementation(noop);
  try {
    const view = render(<InvestExperience initialView={{ screen: "detail", assetId: "cbbtc", from: "search" }} />);
    fireEvent.click(view.getByRole("button", { name: "Back" })); expect(back).toHaveBeenCalledTimes(1);
  } finally { back.mockRestore(); }
});
