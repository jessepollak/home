import * as z from "zod/mini";
import { investAssets } from "@/config/invest-assets";
import { assetSnapshotSchema, dynamicInvestAssetSchema, investAssetWireSchema } from "./discover";
import { resolveMarketPriceAssetIdentity } from "./market-price-history";

export const ASSET_RESOLUTION_VERSION = 1 as const;

const assetIdSchema = z.string().check(z.refine((assetId) => resolveMarketPriceAssetIdentity(assetId) !== null));
const assetResolutionFields = {
  version: z.literal(ASSET_RESOLUTION_VERSION),
  assetId: assetIdSchema,
  source: z.nullable(z.enum(["configured", "indexed", "onchain"])),
  provider: z.enum(["ok", "skipped", "unavailable", "error"]),
};
const assetResolutionResponseSchema = z.object({
  ...assetResolutionFields,
  asset: z.nullable(investAssetWireSchema),
  snapshot: z.nullable(assetSnapshotSchema),
});
const parsedAssetResolutionSchema = z.pipe(z.object({
  ...assetResolutionFields,
  asset: z.optional(z.unknown()),
  snapshot: z.optional(z.unknown()),
}), z.transform((record, ctx) => {
  if (record.asset === null) {
    if (record.source === null && record.snapshot === null) {
      return { ...record, asset: null, source: null, snapshot: null };
    }
  } else {
    const configured = investAssets.find((asset) => asset.id === record.assetId);
    const dynamic = record.source === "configured" ? null : dynamicInvestAssetSchema.safeParse(record.asset);
    const asset = record.source === "configured" ? configured : dynamic?.success ? dynamic.data : null;
    const snapshot = record.snapshot === null ? null : assetSnapshotSchema.safeParse(record.snapshot);
    if (asset && asset.id === record.assetId && record.source !== null &&
        (record.snapshot === null || (snapshot?.success && snapshot.data.assetId === asset.id && record.source === "indexed"))) {
      return { ...record, asset, snapshot: snapshot?.success ? snapshot.data : null };
    }
  }
  ctx.issues.push({ code: "custom", input: record, message: "Invalid asset resolution" });
  return z.NEVER;
}));

export type AssetResolutionResponse = z.output<typeof assetResolutionResponseSchema>;

export function parseAssetResolutionRequest(params: URLSearchParams): string | null {
  const result = assetIdSchema.safeParse(params.get("assetId"));
  return result.success ? result.data : null;
}

export function parseAssetResolutionResponse(value: unknown): AssetResolutionResponse | null {
  const result = parsedAssetResolutionSchema.safeParse(value);
  return result.success ? result.data : null;
}
