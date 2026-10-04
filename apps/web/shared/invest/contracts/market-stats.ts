import * as z from "zod/mini";
import { resolveMarketPriceAssetIdentity } from "./market-price-history";

export const MARKET_STATS_VERSION = 1 as const;

const exactDecimalSchema = z.object({
  atoms: z.string().check(z.regex(/^(?:0|[1-9]\d*)$/)),
  scale: z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 0 && value <= 36)),
});
const marketStatsSchema = z.object({
  marketCapUsd: z.optional(exactDecimalSchema),
  volume24hUsd: z.optional(exactDecimalSchema),
  liquidityUsd: z.optional(exactDecimalSchema),
});
const assetIdSchema = z.pipe(
  z.string(),
  z.transform((value, context) => {
    const identity = resolveMarketPriceAssetIdentity(value);
    if (identity) return identity.assetId;
    context.issues.push({ code: "custom", input: value, message: "Unknown market asset" });
    return z.NEVER;
  }),
);
const marketStatsResponseSchema = z.pipe(z.object({
  version: z.literal(MARKET_STATS_VERSION),
  provider: z.literal("codex"),
  assetId: z.nullable(assetIdSchema),
  currency: z.literal("USD"),
  fetchedAt: z.nullable(z.string().check(z.refine((value) => Number.isFinite(Date.parse(value))))),
  status: z.enum(["ready", "unavailable", "error"]),
  stats: z.pipe(marketStatsSchema, z.transform((stats) => ({
    ...(stats.marketCapUsd !== undefined ? { marketCapUsd: stats.marketCapUsd } : {}),
    ...(stats.volume24hUsd !== undefined ? { volume24hUsd: stats.volume24hUsd } : {}),
    ...(stats.liquidityUsd !== undefined ? { liquidityUsd: stats.liquidityUsd } : {}),
  }))),
  unavailableReason: z.optional(z.enum(["not-configured", "unknown-asset", "unsupported-asset"])),
}).check(
  z.refine((response) => response.status === "ready" || Object.keys(response.stats).length === 0),
  z.refine((response) => response.unavailableReason === undefined || response.status === "unavailable"),
), z.transform((response) => ({
  version: response.version,
  provider: response.provider,
  assetId: response.assetId,
  currency: response.currency,
  fetchedAt: response.fetchedAt,
  status: response.status,
  stats: response.stats,
  ...(response.unavailableReason !== undefined ? { unavailableReason: response.unavailableReason } : {}),
})));

export type MarketStats = z.output<typeof marketStatsSchema>;
export type MarketStatsResponse = z.output<typeof marketStatsResponseSchema>;

export function parseMarketStatsResponse(value: unknown): MarketStatsResponse | null {
  const result = marketStatsResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
