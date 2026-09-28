import { expect, test } from "bun:test";
import stocks from "../../config/invest-sources/base-stocks.json";
import wrapped from "../../config/invest-sources/coinbase-wrapped.json";
import { calendarState, catalogExitCode, diffCatalog, parseBaseStockRoster, parseBaseIntegrationDoc, parseChainlinkFeedDirectory, parseCoinbaseWrappedIssuerPage, type ParsedSources } from "./catalog";

import rosterFixture from "./fixtures/roster.html" with { type: "text" };
import integration from "./fixtures/integration.md" with { type: "text" };
import directoryRows from "./fixtures/directory.json";
import issuerFixture from "./fixtures/issuer.html" with { type: "text" };
const directory = JSON.stringify(directoryRows);
const roster = rosterFixture as unknown as string;
const issuer = issuerFixture as unknown as string;
const parse = (sources: [string | null, string | null, string | null, string | null]): ParsedSources => ({
  roster: sources[0] === null ? null : parseBaseStockRoster(sources[0]),
  integration: sources[1] === null ? null : parseBaseIntegrationDoc(sources[1]),
  feedDirectory: sources[2] === null ? null : parseChainlinkFeedDirectory(sources[2]),
  issuer: sources[3] === null ? null : parseCoinbaseWrappedIssuerPage(sources[3]),
});
const baseline: [string, string, string, string] = [roster, integration, directory, issuer];
const address = "0x1111111111111111111111111111111111111111";

const today = "2026-09-28";
for (const { name, modify, expectedCode, source, field } of [
  { name: "in sync", modify: (rows: typeof baseline) => rows, expectedCode: 0, source: "roster", field: "status" },
  { name: "addition", modify: (rows: typeof baseline) => [`${rows[0]}<a aria-label="View NFLXc on BaseScan" href="https://basescan.org/token/${address}"></a>`, rows[1], rows[2], rows[3]], expectedCode: 1, source: "roster", field: "additions" },
  { name: "removal", modify: (rows: typeof baseline) => [rows[0].split("\n").slice(1).join("\n"), rows[1], rows[2], rows[3]], expectedCode: 1, source: "roster", field: "removals" },
  { name: "address change is a remade asset", modify: (rows: typeof baseline) => [rows[0].replace(stocks.stocks[0]!.contract, address), rows[1], rows[2], rows[3]], expectedCode: 1, source: "roster", field: "identityChanges" },
  { name: "feed-only instrument", modify: (rows: typeof baseline) => [rows[0], rows[1], rows[2].replace(/\]\s*$/, `,{"name":"Coinbase NFLX","proxyAddress":"${address}","decimals":8,"heartbeat":86400,"docs":{"productTypeCode":"primaryTokenizedPrice"}}]`), rows[3]], expectedCode: 1, source: "feedDirectory", field: "additions" },
  { name: "source unavailable", modify: (rows: typeof baseline) => [rows[0], rows[1], rows[2], null], expectedCode: 2, source: "issuer", field: "status" },
  { name: "parse failure", modify: (rows: typeof baseline) => [rows[0], rows[1], rows[2], "<table></table>"], expectedCode: 2, source: "issuer", field: "status" },
] as const) {
  test(`catalog classifier: ${name}`, () => {
    const frozenStock = JSON.stringify(stocks);
    const frozenWrapped = JSON.stringify(wrapped);
    const inputs = modify(baseline) as [string | null, string | null, string | null, string | null];
    const report = diffCatalog(stocks, wrapped, parse(inputs), today);
    expect(report).toEqual(diffCatalog(stocks, wrapped, parse(inputs), today));
    expect(catalogExitCode(report)).toBe(expectedCode);
    expect(JSON.stringify(stocks)).toBe(frozenStock);
    expect(JSON.stringify(wrapped)).toBe(frozenWrapped);
    if (report.sources.feedDirectory.status === "ok" && report.sources.roster.status === "ok") expect(report.knownFeedWithoutRosterAsset).toEqual(["Coinbase COIN", "Coinbase CRCL", "Coinbase INTC"]);
    if (field === "status") expect(report.sources[source].status).toBe(expectedCode === 0 ? "ok" : expectedCode === 2 && source === "issuer" && name === "source unavailable" ? "unavailable" : "parse-failed");
    else expect(report.sources[source][field].length).toBeGreaterThan(0);
    if (name === "feed-only instrument") expect(report.feedWithoutRosterAsset).toEqual(["Coinbase NFLX"]);
    if (name === "address change is a remade asset") {
      expect(report.sources.roster.identityChanges).toContainEqual({ key: "nvdac", field: "contract", expected: stocks.stocks[0]!.contract, actual: address });
      expect(report.sources.roster.additions).toEqual([]);
      expect(report.sources.roster.removals).toEqual([]);
    }
  });
}
test("onchain failures and mismatches have distinct exit states", () => {
  const report = diffCatalog(stocks, wrapped, parse(baseline), today);
  expect(catalogExitCode({ ...report, onchain: { status: "unavailable", block: null, identityChanges: [] } })).toBe(2);
  expect(catalogExitCode({ ...report, onchain: { status: "ok", block: "51886274", identityChanges: [{ key: "NVDAc", field: "decimals", expected: 8, actual: 18 }] } })).toBe(1);
});



test("calendar coverage is reported and gates the drift check", () => {
  const calendar = { coversThrough: "2028-12-31" };
  expect(calendarState(calendar, "2026-09-28")).toEqual({ status: "ok", coversThrough: "2028-12-31", daysRemaining: 825 });
  expect(calendarState(calendar, "2028-09-02")).toEqual({ status: "expiring", coversThrough: "2028-12-31", daysRemaining: 120 });
  expect(calendarState(calendar, "2028-09-01")).toEqual({ status: "ok", coversThrough: "2028-12-31", daysRemaining: 121 });
  expect(calendarState(calendar, "2028-10-01").status).toBe("expiring");
  expect(calendarState(calendar, "2029-01-01").status).toBe("expired");
  const report = diffCatalog(stocks, wrapped, parse(baseline), "2026-09-28");
  expect(catalogExitCode(report)).toBe(0);
  expect(catalogExitCode({ ...report, calendar: calendarState(calendar, "2029-01-01") })).toBe(1);
});
test("parsers fail on zero rows, malformed addresses and conflicting duplicates", () => {
  for (const result of [
    parseBaseStockRoster(""), parseBaseStockRoster(roster.replace(stocks.stocks[0]!.contract, "0x123")),
    parseBaseStockRoster(`${roster}<a aria-label="View NVDAc on BaseScan" href="https://basescan.org/token/${address}"></a>`),
    parseBaseIntegrationDoc(""), parseBaseIntegrationDoc(integration.replace(stocks.stocks[0]!.feed.proxy, "0x123")),
    parseBaseIntegrationDoc(`${integration}| Coinbase NVDA | \`${address}\` |`),
    parseChainlinkFeedDirectory("[]"), parseChainlinkFeedDirectory(directory.replace(stocks.stocks[0]!.feed.proxy, "0x123")),
    parseChainlinkFeedDirectory(directory.replace(/\]\s*$/, `,{"name":"Coinbase NVDA","proxyAddress":"${address}","decimals":8,"heartbeat":86400,"docs":{"productTypeCode":"primaryTokenizedPrice"}}]`)),
    parseChainlinkFeedDirectory(directory.replace(/\]\s*$/, `,{"name":"Coinbase NFLX","proxyAddress":"${address}","decimals":8,"heartbeat":86400}]`)),
    parseCoinbaseWrappedIssuerPage(""), parseCoinbaseWrappedIssuerPage(issuer.replace(wrapped.assets[0]!.contract, "0x123")),
    parseCoinbaseWrappedIssuerPage(`${issuer}<tr><td>cbBTC</td><td>Base</td><td>${address}</td><td>https://basescan.org/token/${address}</td></tr>`),
  ]) expect(result.status).toBe("parse-failed");
});
