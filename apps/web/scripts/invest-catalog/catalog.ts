import holidayCalendar from "../../config/invest-sources/us-equity-holidays.json";
import stockSnapshot from "../../config/invest-sources/base-stocks.json";
import wrappedSnapshot from "../../config/invest-sources/coinbase-wrapped.json";

type Result<T> = { status: "ok"; value: T } | { status: "parse-failed" };
export type Address = `0x${string}`;
export type RosterRow = { tokenSymbol: string; contract: Address };
export type FeedRow = { description: string; proxy: Address; decimals: number; heartbeatSeconds: number };
export type Integration = { feeds: { description: string; proxy: Address }[]; oracleRegistry: Address };
export type WrappedRow = { sourceLabel: string; contract: Address };
export type SourceName = "roster" | "integration" | "feedDirectory" | "issuer";
export type ParsedSources = {
  roster: Result<RosterRow[]> | null;
  integration: Result<Integration> | null;
  feedDirectory: Result<FeedRow[]> | null;
  issuer: Result<WrappedRow[]> | null;
};
export type Change = { key: string; field: string; expected: string | number | null; actual: string | number | null };
export type SourceState = {
  status: "ok" | "unavailable" | "parse-failed";
  additions: string[];
  removals: string[];
  identityChanges: Change[];
};
export type CatalogReport = {
  sources: Record<SourceName, SourceState>;
  feedWithoutRosterAsset: string[];
  knownFeedWithoutRosterAsset: string[];
  calendar: CalendarState;
  onchain?: { status: "ok" | "unavailable"; block: string | null; identityChanges: Change[] };
};

export const CALENDAR_EXPIRY_WARNING_DAYS = 120;
export type CalendarState = { status: "ok" | "expiring" | "expired"; coversThrough: string; daysRemaining: number };

export function calendarState(calendar: { coversThrough: string }, onDate: string): CalendarState {
  const daysRemaining = Math.ceil((Date.parse(`${calendar.coversThrough}T00:00:00Z`) - Date.parse(`${onDate}T00:00:00Z`)) / 86_400_000);
  const status = daysRemaining < 0 ? "expired" : daysRemaining <= CALENDAR_EXPIRY_WARNING_DAYS ? "expiring" : "ok";
  return { status, coversThrough: calendar.coversThrough, daysRemaining };
}

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const address = (value: string): value is Address => addressPattern.test(value);
const failed = <T>(): Result<T> => ({ status: "parse-failed" });
const ok = <T>(value: T): Result<T> => ({ status: "ok", value });
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function unique<T>(rows: T[], key: (row: T) => string): Result<T[]> {
  if (!rows.length) return failed();
  const seen = new Map<string, T>();
  for (const row of rows) {
    const id = key(row).toLowerCase();
    const previous = seen.get(id);
    if (previous && JSON.stringify(previous).toLowerCase() !== JSON.stringify(row).toLowerCase()) return failed();
    seen.set(id, row);
  }
  return ok([...seen.values()]);
}

export function parseBaseStockRoster(html: string): Result<RosterRow[]> {
  const rows: RosterRow[] = [];
  for (const match of html.matchAll(/aria-label="View ([A-Za-z0-9]+) on BaseScan"[^>]*href="([^"]+)"/g)) {
    const contract = match[2]?.match(/^https:\/\/basescan\.org\/token\/([^/?#]+)/)?.[1];
    if (!contract || !address(contract)) return failed();
    rows.push({ tokenSymbol: match[1]!, contract });
  }
  return unique(rows, (row) => row.tokenSymbol);
}

export function parseBaseIntegrationDoc(markdown: string): Result<Integration> {
  const feeds: Integration["feeds"] = [];
  let oracleRegistry: Address | null = null;
  for (const line of markdown.split("\n")) {
    const columns = line.split("|").map((column) => column.trim());
    if (columns.length < 4) continue;
    const description = columns[1] ?? "";
    if (!/^Coinbase [A-Za-z0-9]+$/.test(description) && description !== "Onchain Registry") continue;
    const candidate = columns[2]?.replace(/^`|`$/g, "") ?? "";
    if (!address(candidate)) return failed();
    if (description === "Onchain Registry") {
      if (oracleRegistry && !sameAddress(oracleRegistry, candidate)) return failed();
      oracleRegistry = candidate;
    } else feeds.push({ description, proxy: candidate });
  }
  const distinct = unique(feeds, (row) => row.description);
  return oracleRegistry && distinct.status === "ok" ? ok({ feeds: distinct.value, oracleRegistry }) : failed();
}

export function parseChainlinkFeedDirectory(json: unknown): Result<FeedRow[]> {
  let input: unknown;
  try { input = typeof json === "string" ? JSON.parse(json) : json; } catch { return failed(); }
  if (!Array.isArray(input)) return failed();
  const rows: FeedRow[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return failed();
    const tokenized = "docs" in item && Boolean(item.docs) && typeof item.docs === "object" && item.docs !== null &&
      "productTypeCode" in item.docs && item.docs.productTypeCode === "primaryTokenizedPrice";
    const coinbaseNamed = "name" in item && typeof item.name === "string" && /^Coinbase [A-Za-z0-9]+$/.test(item.name);
    if (coinbaseNamed && !tokenized) return failed();
    if (!coinbaseNamed || !tokenized) continue;
    const { name, proxyAddress, decimals, heartbeat } = item as { name: string; proxyAddress?: unknown; decimals?: unknown; heartbeat?: unknown };
    if (typeof proxyAddress !== "string" || !address(proxyAddress) || !Number.isSafeInteger(decimals) || !Number.isSafeInteger(heartbeat) || Number(decimals) < 0 || Number(heartbeat) <= 0) return failed();
    rows.push({ description: name, proxy: proxyAddress, decimals: decimals as number, heartbeatSeconds: heartbeat as number });
  }
  return unique(rows, (row) => row.description);
}

function cellText(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").trim();
}

export function parseCoinbaseWrappedIssuerPage(html: string): Result<WrappedRow[]> {
  const rows: WrappedRow[] = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cellText(cell[1]!));
    if (cells[1] !== "Base") continue;
    if (!cells[0] || !cells[2] || !address(cells[2]) || !cells[3]?.toLowerCase().includes(cells[2].toLowerCase())) return failed();
    rows.push({ sourceLabel: cells[0], contract: cells[2] });
  }
  return unique(rows, (row) => row.sourceLabel);
}

function state<T>(source: Result<T> | null): SourceState {
  return { status: source?.status ?? "unavailable", additions: [], removals: [], identityChanges: [] };
}
function change(state: SourceState, key: string, field: string, expected: string | number, actual: string | number) {
  if (String(expected).toLowerCase() !== String(actual).toLowerCase()) state.identityChanges.push({ key, field, expected, actual });
}
function compare<T, U>(state: SourceState, expected: readonly T[], actual: readonly U[], expectedKey: (row: T) => string, actualKey: (row: U) => string, fields: (left: T, right: U, key: string) => void) {
  const known = new Map(expected.map((row) => [expectedKey(row).toLowerCase(), row]));
  const current = new Map(actual.map((row) => [actualKey(row).toLowerCase(), row]));
  for (const [key, row] of current) {
    const original = known.get(key);
    if (original) fields(original, row, key);
    else state.additions.push(key);
  }
  for (const key of known.keys()) if (!current.has(key)) state.removals.push(key);
}

export function diffCatalog(stocks: typeof stockSnapshot, wrapped: typeof wrappedSnapshot, parsed: ParsedSources, onDate: string): CatalogReport {
  const sources = { roster: state(parsed.roster), integration: state(parsed.integration), feedDirectory: state(parsed.feedDirectory), issuer: state(parsed.issuer) };
  if (parsed.roster?.status === "ok") {
    compare(sources.roster, stocks.stocks, parsed.roster.value, (row) => row.tokenSymbol, (row) => row.tokenSymbol,
      (left, right, key) => change(sources.roster, key, "contract", left.contract, right.contract));
    const oldByAddress = new Map(stocks.stocks.map((row) => [row.contract.toLowerCase(), row.tokenSymbol.toLowerCase()]));
    for (const row of parsed.roster.value) {
      const prior = oldByAddress.get(row.contract.toLowerCase());
      if (prior && prior !== row.tokenSymbol.toLowerCase()) change(sources.roster, row.contract.toLowerCase(), "tokenSymbol", prior, row.tokenSymbol);
    }
  }
  if (parsed.integration?.status === "ok") {
    compare(sources.integration, stocks.stocks, parsed.integration.value.feeds, (row) => row.feed.description, (row) => row.description,
      (left, right, key) => change(sources.integration, key, "proxy", left.feed.proxy, right.proxy));
    change(sources.integration, "oracleRegistry", "contract", stocks.oracleRegistry, parsed.integration.value.oracleRegistry);
  }
  if (parsed.feedDirectory?.status === "ok") {
    compare(sources.feedDirectory, [...stocks.stocks.map((row) => row.feed), ...stocks.knownFeedOnly], parsed.feedDirectory.value,
      (row) => row.description, (row) => row.description, (left, right, key) => {
        change(sources.feedDirectory, key, "proxy", left.proxy, right.proxy);
        if ("decimals" in left && typeof left.decimals === "number" && "heartbeatSeconds" in left && typeof left.heartbeatSeconds === "number") {
          change(sources.feedDirectory, key, "decimals", left.decimals, right.decimals);
          change(sources.feedDirectory, key, "heartbeatSeconds", left.heartbeatSeconds, right.heartbeatSeconds);
        }
      });
  }
  if (parsed.issuer?.status === "ok") {
    compare(sources.issuer, wrapped.assets, parsed.issuer.value, (row) => row.sourceLabel, (row) => row.sourceLabel,
      (left, right, key) => change(sources.issuer, key, "contract", left.contract, right.contract));
  }
  const roster = parsed.roster?.status === "ok" ? parsed.roster.value : null;
  const directory = parsed.feedDirectory?.status === "ok" ? parsed.feedDirectory.value : null;
  const absentFromRoster = roster && directory
    ? directory.filter((feed) => !roster.some((row) => `Coinbase ${row.tokenSymbol.replace(/c$/, "")}`.toLowerCase() === feed.description.toLowerCase()))
    : [];
  const isKnownFeedOnly = (feed: FeedRow) => stocks.knownFeedOnly.some((row) => row.description.toLowerCase() === feed.description.toLowerCase() && sameAddress(row.proxy, feed.proxy));
  const feedWithoutRosterAsset = absentFromRoster.filter((feed) => !isKnownFeedOnly(feed)).map((feed) => feed.description);
  const knownFeedWithoutRosterAsset = absentFromRoster.filter(isKnownFeedOnly).map((feed) => feed.description);
  for (const source of Object.values(sources)) {
    source.additions.sort(); source.removals.sort();
    source.identityChanges.sort((a, b) => `${a.key}:${a.field}`.localeCompare(`${b.key}:${b.field}`));
  }
  return { sources, feedWithoutRosterAsset: feedWithoutRosterAsset.sort(), knownFeedWithoutRosterAsset: knownFeedWithoutRosterAsset.sort(), calendar: calendarState(holidayCalendar, onDate) };
}

export function catalogExitCode(report: CatalogReport): 0 | 1 | 2 {
  if (Object.values(report.sources).some((source) => source.status !== "ok") || report.onchain?.status === "unavailable") return 2;
  if (report.calendar.status !== "ok") return 1;
  return Object.values(report.sources).some((source) => source.additions.length || source.removals.length || source.identityChanges.length)
    || report.feedWithoutRosterAsset.length || report.onchain?.identityChanges.length ? 1 : 0;
}
