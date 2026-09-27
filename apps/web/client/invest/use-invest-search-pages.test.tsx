import "@/client/account/dom-test-harness";
import { afterEach, expect, test } from "bun:test";
import { page } from "@/tests/helpers/dom";
import { getHomeQueryClient } from "@/client/query/query-client";
import { searchFixture } from "@/tests/browser/feature-map/search-fixtures";
import { rankInvestSearchResults, type InvestSearchMatch, type InvestSearchWireResult } from "@/shared/invest/contracts/search";
const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { useInvestSearch } = await import("./use-invest-search");
const fixture = searchFixture("ORB");
const firstPage = { ...fixture, results: fixture.results.slice(0, 1), nextOffset: 20 };
const secondPage = { ...fixture, offset: 20, results: fixture.results.slice(0, 2), nextOffset: null };

function dynamicMatch(digit: string, match: InvestSearchMatch): InvestSearchWireResult {
  const template = fixture.results[0];
  if (!template || template.kind !== "dynamic") throw new Error("Missing search fixture");
  const address = `0x${digit.repeat(40)}` as `0x${string}`;
  const symbol = match === "exact" ? "ORB" : match === "prefix" ? "ORBIT" : "DORB";
  return { ...template, match, asset: { ...template.asset, id: `base:${address}`, displayName: `Token ${digit}`, displaySymbol: symbol, contractAddress: address, contractUrl: `https://basescan.org/token/${address}`, representation: { ...template.asset.representation, tokenSymbol: symbol } } };
}
afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

function Probe({ fetchImpl }: { fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }) {
  const search = useInvestSearch("ORB", false, { fetchImpl });
  return <div><output data-testid="assets">{search.results.map((result) => result.asset.id).join(",")}</output><output data-testid="error">{search.loadMoreError ? "yes" : "no"}</output><button onClick={search.loadMore}>Load more</button><button onClick={search.retryLoadMore}>Retry more</button></div>;
}

test("merges pages by contract and keeps distinct contracts with the same name and symbol", async () => {
  const offsets: number[] = [];
  render(<Probe fetchImpl={async (input) => {
    const offset = Number(new URL(String(input), "http://localhost").searchParams.get("offset") ?? 0);
    offsets.push(offset);
    return Response.json(offset ? secondPage : firstPage);
  }} />);
  await waitFor(() => expect(page().getByTestId("assets").textContent).toBe("base:0x1111111111111111111111111111111111111111"));
  fireEvent.click(page().getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(page().getByTestId("assets").textContent).toBe("base:0x1111111111111111111111111111111111111111,base:0x2222222222222222222222222222222222222222"));
  expect(offsets).toEqual([0, 20]);
});

test("re-ranks all loaded pages while preserving incoming order within each tier", async () => {
  const rankedFirst = { ...firstPage, results: [dynamicMatch("1", "prefix"), dynamicMatch("2", "prefix"), dynamicMatch("3", "partial")] };
  const rankedSecond = { ...secondPage, results: [dynamicMatch("5", "exact"), dynamicMatch("4", "prefix"), dynamicMatch("6", "partial")] };
  render(<Probe fetchImpl={async (input) => {
    const offset = Number(new URL(String(input), "http://localhost").searchParams.get("offset") ?? 0);
    return Response.json(offset ? rankedSecond : rankedFirst);
  }} />);
  const ids = (digits: string[]) => digits.map((digit) => `base:0x${digit.repeat(40)}`).join(",");
  await waitFor(() => expect(page().getByTestId("assets").textContent).toBe(ids(["1", "2", "3"])));
  fireEvent.click(page().getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(page().getByTestId("assets").textContent).toBe(ids(["5", "1", "2", "4", "3", "6"])));
});

test("the shared rank preserves incoming order within equal tiers without mutating input", () => {
  const incoming = [
    { id: "first", match: "prefix" as const, source: "indexed" as const },
    { id: "second", match: "prefix" as const, source: "indexed" as const },
    { id: "exact", match: "exact" as const, source: "indexed" as const },
    { id: "third", match: "prefix" as const, source: "indexed" as const },
  ];
  expect(rankInvestSearchResults(incoming).map(({ id }) => id)).toEqual(["exact", "first", "second", "third"]);
  expect(incoming.map(({ id }) => id)).toEqual(["first", "second", "exact", "third"]);
});

test("a failed next page keeps the first page visible until retry succeeds", async () => {
  let fail = true;
  render(<Probe fetchImpl={async (input) => {
    const offset = Number(new URL(String(input), "http://localhost").searchParams.get("offset") ?? 0);
    return offset ? fail ? new Response(null, { status: 503 }) : Response.json(secondPage) : Response.json(firstPage);
  }} />);
  await waitFor(() => expect(page().getByTestId("assets").textContent).toBe("base:0x1111111111111111111111111111111111111111"));
  fireEvent.click(page().getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(page().getByTestId("error").textContent).toBe("yes"));
  expect(page().getByTestId("assets").textContent).toBe("base:0x1111111111111111111111111111111111111111");
  fail = false;
  fireEvent.click(page().getByRole("button", { name: "Retry more" }));
  await waitFor(() => expect(page().getByTestId("assets").textContent).toContain("base:0x2222222222222222222222222222222222222222"));
});
