import * as z from "zod/mini";
import { parseAddress } from "@/shared/chain/hex";
import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { assetSnapshotSchema, dynamicInvestAssetSchema, investAssetWireSchema } from "./discover";

export const INVEST_SEARCH_VERSION = 1 as const;
export const INVEST_SEARCH_QUERY_MAX_LENGTH = 64;
export const INVEST_SEARCH_PAGE_SIZE = 20;
export const INVEST_SEARCH_MAX_OFFSET = 100;
export const INVEST_SEARCH_MAX_CONFIGURED_RESULTS = 8;

const investSearchMatchSchema = z.enum(["contract", "exact", "prefix", "partial"]);
const investSearchSourceSchema = z.enum(["configured", "indexed", "onchain"]);
export type InvestSearchMatch = z.output<typeof investSearchMatchSchema>;
export type InvestSearchSource = z.output<typeof investSearchSourceSchema>;

export function investSearchRank(match: InvestSearchMatch, source: InvestSearchSource): number {
  if (match === "contract") return 0;
  return ({ exact: 1, prefix: 3, partial: 5 } as const)[match] + (source === "configured" ? 0 : 1);
}

export function rankInvestSearchResults<T extends { match: InvestSearchMatch; source: InvestSearchSource }>(results: readonly T[]): T[] {
  return results.map((result, index) => ({ result, index }))
    .sort((a, b) => investSearchRank(a.result.match, a.result.source) - investSearchRank(b.result.match, b.result.source) || a.index - b.index)
    .map(({ result }) => result);
}

const investSearchProviderSchema = z.enum(["ok", "skipped", "unavailable", "error"]);
const configuredResultSchema = z.object({
  kind: z.literal("configured"),
  assetId: z.string(),
  match: investSearchMatchSchema,
});
const investSearchWireResultSchema = z.discriminatedUnion("kind", [
  configuredResultSchema,
  z.object({
    kind: z.literal("dynamic"),
    asset: investAssetWireSchema,
    match: investSearchMatchSchema,
    source: z.enum(["indexed", "onchain"]),
  }),
]);
const searchResponseFields = {
  version: z.literal(INVEST_SEARCH_VERSION),
  query: z.string(),
  offset: z.number().check(z.refine((offset) => Number.isSafeInteger(offset) && offset >= 0)),
  snapshots: z.readonly(z.array(assetSnapshotSchema)),
  provider: investSearchProviderSchema,
  coverage: z.enum(["complete", "partial"]),
  nextOffset: z.nullable(z.number().check(z.refine(Number.isSafeInteger))),
};
const validSearchPage = (page: { offset: number; nextOffset: number | null; provider: InvestSearchProviderStatus; coverage: "complete" | "partial" }) =>
  (page.nextOffset === null || (page.nextOffset > page.offset && page.nextOffset <= INVEST_SEARCH_MAX_OFFSET)) &&
  ((page.provider !== "error" && page.provider !== "unavailable") || page.coverage === "partial");
const investSearchResponseSchema = z.object({
  ...searchResponseFields,
  results: z.readonly(z.array(investSearchWireResultSchema)),
}).check(z.refine(validSearchPage));
const parsedSearchResultSchema = z.union([
  z.pipe(configuredResultSchema, z.transform((result, ctx) => {
    const asset = configuredById.get(result.assetId);
    const address = parseAddress(asset?.contractAddress);
    if (!asset || !address) {
      ctx.issues.push({ code: "custom", input: result, message: "Unknown configured asset" });
      return z.NEVER;
    }
    return { asset: { ...asset, contractAddress: address }, match: result.match, source: result.kind };
  })),
  z.pipe(z.object({
    kind: z.literal("dynamic"),
    asset: dynamicInvestAssetSchema,
    match: investSearchMatchSchema,
    source: z.enum(["indexed", "onchain"]),
  }), z.transform(({ asset, match, source }) => ({ asset, match, source }))),
]);
const parsedSearchPageSchema = z.pipe(z.object({
  ...searchResponseFields,
  results: z.array(parsedSearchResultSchema),
}).check(z.refine(validSearchPage)), z.transform(({ version: _version, ...page }) => {
  const seen = new Set<string>();
  const results = page.results.filter((result) => {
    if (seen.has(result.asset.contractAddress)) return false;
    seen.add(result.asset.contractAddress);
    return true;
  });
  const dynamicIds = new Set(results.filter((result) => result.source !== "configured").map((result) => result.asset.id));
  return { ...page, results, snapshots: page.snapshots.filter((snapshot) => dynamicIds.has(snapshot.assetId)) };
}));
const investSearchRequestSchema = z.object({
  query: z.pipe(
    z.string().check(z.maxLength(INVEST_SEARCH_QUERY_MAX_LENGTH * 4)),
    z.pipe(z.transform((value: string) => normalizeInvestSearchQuery(value)), z.string().check(z.minLength(1))),
  ),
  offset: z.pipe(
    z.nullable(z.string()).check(z.refine((offset) => offset === null || offset === "" || /^(?:0|[1-9]\d*)$/.test(offset))),
    z.pipe(
      z.transform((offset: string | null) => offset === null || offset === "" ? 0 : Number(offset)),
      z.number().check(z.refine((offset) => Number.isSafeInteger(offset) && offset >= 0 && offset <= INVEST_SEARCH_MAX_OFFSET && offset % INVEST_SEARCH_PAGE_SIZE === 0)),
    ),
  ),
});

export type InvestSearchProviderStatus = z.output<typeof investSearchProviderSchema>;
export type InvestSearchWireResult = z.output<typeof investSearchWireResultSchema>;
export type InvestSearchResponse = z.output<typeof investSearchResponseSchema>;
export type ParsedInvestSearchPage = z.output<typeof parsedSearchPageSchema>;
export type InvestSearchResult = { asset: InvestAsset; match: InvestSearchMatch; source: InvestSearchSource };
export type InvestSearchPage = Omit<InvestSearchResponse, "version" | "results"> & { results: readonly InvestSearchResult[] };
export type InvestSearchRequest = z.output<typeof investSearchRequestSchema>;

const configuredById = new Map<string, InvestAsset>(
  investAssets.map((asset) => [asset.id, asset]),
);

export function normalizeInvestSearchQuery(raw: string): string | null {
  const normalized = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized.length <= INVEST_SEARCH_QUERY_MAX_LENGTH ? normalized : null;
}

export function isInvestSearchAddressQuery(query: string): boolean {
  return parseAddress(query.toLowerCase()) !== null;
}

export function parseInvestSearchRequest(
  params: URLSearchParams,
): InvestSearchRequest | null {
  const result = investSearchRequestSchema.safeParse({ query: params.get("q"), offset: params.get("offset") });
  return result.success ? result.data : null;
}

export function investSearchSearchParams({
  query,
  offset,
}: InvestSearchRequest): URLSearchParams {
  const params = new URLSearchParams({ q: query });
  if (offset > 0) params.set("offset", String(offset));
  return params;
}

export function parseInvestSearchResponse(
  value: unknown,
): ParsedInvestSearchPage | null {
  const result = parsedSearchPageSchema.safeParse(value);
  return result.success ? result.data : null;
}
