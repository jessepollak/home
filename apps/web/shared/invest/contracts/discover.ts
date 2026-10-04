import * as z from "zod/mini";
import { parseAddress, requireAddress } from "@/shared/chain/hex";

import { investAssets, type InvestAsset } from "@/config/invest-assets";
import { assetKeyForErc20 } from "@/config/portfolio-assets";
import { resolveMarketPriceAssetIdentity } from "./market-price-history";
import { unavailableMarketData, type MarketDataState } from "@/shared/invest/invest-market";

export const INVEST_DISCOVER_VERSION = 1 as const;

const investDiscoverStatusSchema = z.enum(["ready", "empty", "error", "unavailable"]);
const assetFields = {
  id: z.string(),
  displayName: z.string(),
  displaySymbol: z.string(),
  initials: z.string(),
  chainId: z.literal(8453),
  descriptor: z.string(),
  contractUrl: z.string(),
};

export const investAssetWireSchema = z.object({
  ...assetFields,
  category: z.enum(["stock", "crypto", "meme"]),
  listing: z.optional(z.enum(["listed", "removed"])),
  contractAddress: z.templateLiteral(["0x", z.string()]),
  availability: z.enum(["restricted", "informational"]),
  representation: z.object({
    tokenSymbol: z.string(),
    decimals: z.optional(z.number()),
    issuer: z.optional(z.string()),
    relationship: z.string(),
  }),
  valuation: z.optional(z.object({
    kind: z.literal("tokenized-equity-feed"),
    feedProxy: z.templateLiteral(["0x", z.string()]),
    feedDecimals: z.literal(8),
    heartbeatSeconds: z.number(),
  })),
  imageUrl: z.optional(z.string()),
  projectUrl: z.optional(z.string()),
});

export const assetSnapshotSchema = z.pipe(z.object({
  assetId: z.string(),
  displayPrice: z.string().check(z.minLength(1)),
  asOf: z.string(),
  sourceLabel: z.string(),
  sourceUrl: z.optional(z.unknown()),
  changeLabel: z.optional(z.unknown()),
}), z.transform(({ sourceUrl, changeLabel, ...snapshot }) => ({
  ...snapshot,
  ...(typeof sourceUrl === "string" ? { sourceUrl } : {}),
  ...(typeof changeLabel === "string" ? { changeLabel } : {}),
})));

export const dynamicInvestAssetSchema = z.pipe(z.object({
  ...assetFields,
  category: z.literal("meme"),
  contractAddress: z.pipe(
    z.string().check(z.refine((value) => parseAddress(value) !== null)),
    z.transform((value: string) => requireAddress(value)),
  ),
  availability: z.literal("informational"),
  representation: z.object({
    tokenSymbol: z.string(),
    decimals: z.optional(z.unknown()),
    relationship: z.optional(z.unknown()),
  }),
  imageUrl: z.optional(z.unknown()),
  projectUrl: z.optional(z.unknown()),
}).check(z.refine((asset) => {
  const identity = resolveMarketPriceAssetIdentity(asset.id);
  return identity !== null && identity.chainId === asset.chainId &&
    parseAddress(identity.contractAddress) === asset.contractAddress;
})), z.transform(({ representation, imageUrl, projectUrl, ...asset }) => ({
  ...asset,
  representation: {
    tokenSymbol: representation.tokenSymbol,
    ...(typeof representation.decimals === "number" ? { decimals: representation.decimals } : {}),
    relationship: typeof representation.relationship === "string"
      ? representation.relationship : "Base ERC-20 token.",
  },
  ...(typeof imageUrl === "string" ? { imageUrl } : {}),
  ...(typeof projectUrl === "string" ? { projectUrl } : {}),
})));

const iconMapSchema = z.record(z.string(), z.nullable(z.string()));
const paginationFields = {
  nextOffset: z.nullable(z.number().check(z.refine((offset) => Number.isSafeInteger(offset) && offset >= 0))),
  exhausted: z.boolean(),
};
const validPagination = (page: { nextOffset: number | null; exhausted: boolean }) =>
  page.exhausted ? page.nextOffset === null : page.nextOffset !== null;
const investDiscoverResponseSchema = z.object({
  version: z.literal(INVEST_DISCOVER_VERSION),
  provider: z.literal("codex"),
  fetchedAt: z.nullable(z.string()),
  icons: iconMapSchema,
  memes: z.object({
    status: investDiscoverStatusSchema,
    message: z.optional(z.string()),
    assets: z.array(investAssetWireSchema),
    snapshots: z.array(assetSnapshotSchema),
    ...paginationFields,
  }).check(z.refine(validPagination)),
});
const parsedDiscoverResponseSchema = z.object({
  version: z.literal(INVEST_DISCOVER_VERSION),
  provider: z.literal("codex"),
  icons: iconMapSchema,
  memes: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ready"),
      assets: z.array(dynamicInvestAssetSchema),
      snapshots: z.array(assetSnapshotSchema),
      ...paginationFields,
    }).check(z.refine(validPagination), z.refine((memes) => {
      const ids = new Set(memes.assets.map((asset) => asset.id));
      return memes.snapshots.every((snapshot) => ids.has(snapshot.assetId));
    })),
    z.object({
      status: z.enum(["empty", "error", "unavailable"]),
      ...paginationFields,
    }).check(z.refine(validPagination)),
  ]),
});

export type InvestDiscoverStatus = z.output<typeof investDiscoverStatusSchema>;
export type InvestDiscoverResponse = z.output<typeof investDiscoverResponseSchema>;
export type ParsedDynamicInvestAsset = z.output<typeof dynamicInvestAssetSchema>;
export type ParsedInvestDiscoverState = InvestDiscoverState & { memeAssets: readonly ParsedDynamicInvestAsset[] };
export type AssetMarkResolution = {
  images?: Readonly<Record<string, string | null>>;
  pending?: boolean;
};
export type MemePagination = {
  nextOffset: number | null;
  exhausted: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  autoLoadPaused: boolean;
  consecutiveEmptyPages: number;
};
export type InvestDiscoverState = {
  memeAssets: readonly InvestAsset[];
  memeStatus: InvestDiscoverStatus | "loading";
  memeMarket: MarketDataState;
  assetMarkResolution: AssetMarkResolution;
  memePagination: MemePagination;
};

const discoverEmptyPagination: MemePagination = {
  nextOffset: null, exhausted: true, loadingMore: false, loadMoreError: false,
  autoLoadPaused: false, consecutiveEmptyPages: 0,
};

export function parseDiscoverResponse(
  value: unknown,
): ParsedInvestDiscoverState | null {
  const result = parsedDiscoverResponseSchema.safeParse(value);
  if (!result.success) return null;
  const { icons, memes } = result.data;
  const pagination = { nextOffset: memes.nextOffset, exhausted: memes.exhausted };
  if (memes.status !== "ready") {
    return {
      memeAssets: [],
      memeStatus: memes.status,
      memeMarket:
        memes.status === "error"
          ? { status: "error", message: "Trending memes are unavailable." }
          : memes.status === "unavailable"
            ? unavailableMarketData
            : { status: "ready", snapshots: [] },
      assetMarkResolution: assetMarkResolutionFromDiscover({ icons }),
      memePagination: { ...discoverEmptyPagination, ...pagination },
    };
  }

  return {
    memeAssets: memes.assets,
    memeStatus: memes.assets.length > 0 ? "ready" : "empty",
    memeMarket: { status: "ready", snapshots: memes.snapshots },
    assetMarkResolution: assetMarkResolutionFromDiscover({ icons, memeAssets: memes.assets }),
    memePagination: { ...discoverEmptyPagination, ...pagination },
  };
}

function assetMarkResolutionFromDiscover({
  icons,
  memeAssets = [],
  pending = false,
}: {
  icons: Readonly<Record<string, string | null>>;
  memeAssets?: readonly InvestAsset[];
  pending?: boolean;
}): AssetMarkResolution {
  const images: Record<string, string | null> = {};
  const assetsById = new Map<string, InvestAsset>(
    [...investAssets, ...memeAssets].map((asset) => [asset.id, asset]),
  );
  for (const [assetId, imageUrl] of Object.entries(icons)) {
    const asset = assetsById.get(assetId);
    if (!asset) continue;
    images[assetKeyForErc20(asset.contractAddress)] = imageUrl?.trim() || null;
  }
  for (const asset of memeAssets) {
    if (asset.imageUrl === undefined) continue;
    images[assetKeyForErc20(asset.contractAddress)] = asset.imageUrl?.trim() || null;
  }
  return { images, pending };
}
