import * as z from "zod/mini";
import { presentationRegions } from "@/config/regions";
import { investAssets } from "@/config/invest-assets";

export const MARKET_PRICES_VERSION = 1 as const;
export const MARKET_PRICE_FRESHNESS_MS = 5 * 60_000;
export const MARKET_PRICE_DISPLAY_FRESHNESS_MS = 24 * 60 * 60 * 1_000;

const presentationFiatCodes = Object.values(presentationRegions).flatMap((region) =>
  region.currency.code ? [region.currency.code] : [],
);
const marketPriceAssetIds = new Set<string>(investAssets.map((asset) => asset.id));
const stockAssetIds = new Set<string>(investAssets.flatMap((asset) => asset.category === "stock" ? [asset.id] : []));
const dateSchema = z.string().check(z.refine((value) => Number.isFinite(Date.parse(value))));
const optionalTextSchema = z.optional(z.pipe(z.unknown(), z.transform((value) => typeof value === "string" ? value : undefined)));
const exactScaleSchema = z.object({
  atoms: z.string().check(z.regex(/^(?:0|[1-9]\d*)$/)),
  scale: z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 0 && value <= 10_000)),
});
const marketPricesFxQuoteSchema = z.pipe(
  z.object({
    quoteCurrency: z.enum(presentationFiatCodes),
    quoteUnitsPerUsd: z.optional(z.nullable(exactScaleSchema)),
    status: z.enum(["fresh", "unavailable"]),
  }).check(z.refine((quote) => quote.status === "fresh" ? quote.quoteUnitsPerUsd != null : quote.quoteUnitsPerUsd == null)),
  z.transform((quote) => ({ ...quote, quoteUnitsPerUsd: quote.quoteUnitsPerUsd ?? null })),
);
const snapshotSchema = z.pipe(
  z.object({
    assetId: z.string().check(z.refine((value) => marketPriceAssetIds.has(value))),
    displayPrice: z.string().check(z.minLength(1)),
    asOf: dateSchema,
    sourceLabel: z.string().check(z.minLength(1)),
    sourceUrl: z.optional(z.string()),
    changeLabel: optionalTextSchema,
    session: z.optional(z.enum(["open", "closed", "paused", "stale"])),
    checkedAt: z.optional(dateSchema),
  }).check(z.refine((snapshot) => snapshot.session === undefined
    ? snapshot.checkedAt === undefined
    : stockAssetIds.has(snapshot.assetId) && snapshot.checkedAt !== undefined)),
  z.transform((snapshot) => ({
    assetId: snapshot.assetId,
    displayPrice: snapshot.displayPrice,
    asOf: snapshot.asOf,
    sourceLabel: snapshot.sourceLabel,
    ...(snapshot.sourceUrl !== undefined ? { sourceUrl: snapshot.sourceUrl } : {}),
    ...(snapshot.changeLabel !== undefined ? { changeLabel: snapshot.changeLabel } : {}),
    ...(snapshot.session !== undefined ? { session: snapshot.session, checkedAt: snapshot.checkedAt } : {}),
  })),
);
const marketStateSchema = z.union([
  z.object({ status: z.literal("unavailable") }),
  z.object({ status: z.literal("loading") }),
  z.pipe(
    z.object({ status: z.literal("error"), message: optionalTextSchema }),
    z.transform((market) => ({ status: market.status, ...(market.message !== undefined ? { message: market.message } : {}) })),
  ),
  z.object({ status: z.literal("ready"), snapshots: z.readonly(z.array(snapshotSchema)) }),
]);
const marketPricesResponseSchema = z.pipe(
  z.object({
    version: z.literal(MARKET_PRICES_VERSION),
    provider: z.literal("codex"),
    fetchedAt: z.nullable(dateSchema),
    unavailableReason: z.optional(z.pipe(z.unknown(), z.transform((value) => value === "not-configured" ? "not-configured" as const : undefined))),
    markets: z.readonly(z.record(z.string(), marketStateSchema)),
    fx: z.optional(z.readonly(z.array(marketPricesFxQuoteSchema))),
  }),
  z.transform((response) => ({
    version: response.version,
    provider: response.provider,
    fetchedAt: response.fetchedAt,
    ...(response.unavailableReason !== undefined ? { unavailableReason: response.unavailableReason } : {}),
    markets: response.markets,
    ...(response.fx !== undefined ? { fx: response.fx } : {}),
  })),
);

export type MarketPricesFxQuote = z.output<typeof marketPricesFxQuoteSchema>;
export type MarketPricesResponse = z.output<typeof marketPricesResponseSchema>;

export function parseMarketPricesResponse(value: unknown): MarketPricesResponse | null {
  const result = marketPricesResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
