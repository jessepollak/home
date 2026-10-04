import * as z from "zod/mini";
import { parseAddress, parseHash32, type Hash32 } from "@/shared/chain/hex";
import type { BorrowAddress, BorrowAssetRef, BorrowMarketId } from "./config";
import { getBorrowMarketRef } from "./config";

export const BORROW_OVERVIEW_VERSION = "2" as const;
export const BORROW_MARKET_DETAIL_VERSION = "1" as const;

const addressSchema = z.custom<BorrowAddress>((value) => parseAddress(value) !== null);
const marketIdSchema = z.custom<BorrowMarketId>((value) => parseHash32(value) !== null);
const hashSchema = z.custom<Hash32>((value) => parseHash32(value) !== null);
const decimalSchema = z.string().check(z.regex(/^\d+$/));
const nullableDecimalSchema = z.nullable(decimalSchema);
const modeSchema = z.enum(["enabled", "reducing-only"]);
const assetSchema = z.looseObject({
  id: z.custom<BorrowAssetRef["id"]>((value) => typeof value === "string"),
  chainId: z.literal(8453), name: z.string(), symbol: z.string(), decimals: z.number(), address: addressSchema,
});
const marketSchema = z.looseObject({
  id: marketIdSchema, morpho: addressSchema, loanToken: assetSchema, collateralToken: assetSchema,
  oracle: addressSchema, irm: addressSchema, lltvWad: decimalSchema, rank: z.number(),
}).check(z.refine((value) => {
  const configured = getBorrowMarketRef(value.id);
  return Boolean(configured && parseHash32(value.id) === parseHash32(configured.marketId) &&
    parseAddress(value.morpho) === parseAddress(configured.morpho) &&
    parseAddress(value.oracle) === parseAddress(configured.oracle) &&
    parseAddress(value.irm) === parseAddress(configured.irm) &&
    value.lltvWad === configured.lltvWad.toString(10) && value.rank === configured.rank &&
    assetMatches(value.loanToken, configured.loanToken) && assetMatches(value.collateralToken, configured.collateralToken));
}));
const blockShape = {
  provider: z.literal("Base JSON-RPC"), blockNumber: decimalSchema, blockHash: hashSchema, blockTimestamp: decimalSchema,
};
const blockSchema = z.looseObject(blockShape);
const sourceSchema = z.looseObject({ ...blockShape, fetchedAt: z.string() });
const snapshotSchema = z.looseObject({
  version: z.literal(BORROW_MARKET_DETAIL_VERSION), chainId: z.literal(8453), walletAddress: addressSchema,
  market: marketSchema,
  eligibility: z.looseObject({ mode: modeSchema, newRisk: z.boolean(), reason: z.nullable(z.string()) }),
  source: sourceSchema,
  state: z.looseObject({
    oraclePriceRaw: decimalSchema, borrowRatePerSecondWad: decimalSchema, borrowAprWad: decimalSchema,
    totalSupplyAssetsRaw: decimalSchema, totalBorrowAssetsRaw: decimalSchema, totalBorrowSharesRaw: decimalSchema,
    liquidityAssetsRaw: decimalSchema, lastUpdateTimestamp: decimalSchema,
  }),
  wallet: z.looseObject({
    collateralBalanceRaw: decimalSchema, loanBalanceRaw: decimalSchema, collateralAllowanceRaw: decimalSchema, loanAllowanceRaw: decimalSchema,
  }),
  position: z.looseObject({
    collateralRaw: decimalSchema, borrowSharesRaw: decimalSchema, debtAssetsRaw: decimalSchema,
    rawBorrowCapacityAssetsRaw: decimalSchema, borrowCapacityAssetsRaw: decimalSchema,
    rawWithdrawableCollateralRaw: decimalSchema, withdrawableCollateralRaw: decimalSchema,
    healthFactorWad: nullableDecimalSchema, liquidationPriceRaw: nullableDecimalSchema,
  }),
}).check(z.refine((value) => {
  const configured = getBorrowMarketRef(value.market.id);
  return Boolean(configured && modeNotWider(value.eligibility.mode, configured.availability) &&
    value.eligibility.newRisk === (value.eligibility.mode === "enabled"));
}));
const availabilitySchema = z.discriminatedUnion("status", [
  z.looseObject({
    status: z.literal("available"), mode: modeSchema, reason: z.null(), source: sourceSchema, snapshot: snapshotSchema,
  }),
  z.looseObject({
    status: z.literal("unavailable"), mode: modeSchema, reason: z.string(), source: z.null(),
  }).check(z.refine((value) => !("snapshot" in value))),
]);
const opportunitySchema = z.looseObject({ market: marketSchema, availability: availabilitySchema }).check(z.refine((value) => {
  const configured = getBorrowMarketRef(value.market.id);
  if (!configured || !modeNotWider(value.availability.mode, configured.availability)) return false;
  if (value.availability.status === "unavailable") return true;
  const { snapshot, mode, source } = value.availability;
  return parseHash32(snapshot.market.id) === parseHash32(value.market.id) &&
    snapshot.eligibility.mode === mode && sameSource(snapshot.source, source);
}));
const positionSchema = z.looseObject({
  market: marketSchema, source: sourceSchema, collateralRaw: decimalSchema,
  borrowSharesRaw: decimalSchema, debtAssetsRaw: decimalSchema, healthFactorWad: nullableDecimalSchema,
});
const overviewSchema = z.looseObject({
  version: z.literal(BORROW_OVERVIEW_VERSION), chainId: z.literal(8453),
  owner: z.looseObject({ address: addressSchema, accountProvider: z.enum(["cdp-embedded", "base-account"]) }),
  discovery: z.looseObject({
    status: z.enum(["complete", "partial"]), sourceBlock: z.nullable(blockSchema),
    candidateCount: z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 0)),
    verifiedCount: z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 0)),
    reason: z.nullable(z.string()), fetchedAt: z.string(),
  }),
  opportunities: z.array(opportunitySchema), positions: z.array(positionSchema),
}).check(z.refine((value) => {
  const { discovery, opportunities, positions } = value;
  const available = opportunities.filter((entry) => entry.availability.status === "available");
  if (discovery.verifiedCount > discovery.candidateCount || opportunities.length !== discovery.candidateCount ||
    discovery.verifiedCount !== available.length || (discovery.sourceBlock === null) !== (available.length === 0)) return false;
  const sourceBlock = discovery.sourceBlock;
  if (available.some((entry) => entry.availability.status !== "available" ||
    parseAddress(entry.availability.snapshot.walletAddress) !== parseAddress(value.owner.address) ||
    (sourceBlock !== null && !sameBlock(entry.availability.source, sourceBlock)))) return false;
  const opportunityIds = new Set(opportunities.map((entry) => parseHash32(entry.market.id)));
  const positionIds = new Set(positions.map((entry) => parseHash32(entry.market.id)));
  return opportunityIds.size === opportunities.length && positionIds.size === positions.length && positions.every((entry) => {
    const opportunity = opportunities.find((candidate) => parseHash32(candidate.market.id) === parseHash32(entry.market.id));
    return opportunity?.availability.status === "available" && sameBlock(entry.source, opportunity.availability.source);
  });
}));
const parsedSnapshotSchema = z.pipe(snapshotSchema, z.transform(normalizedSnapshot));
const parsedOverviewSchema = z.pipe(overviewSchema, z.transform((value): BorrowOverviewResponse & ReturnType<typeof normalizedOverview> => normalizedOverview(value)));

export type BorrowMarketIdentity = z.output<typeof marketSchema>;
export type BorrowSourceBlock = z.output<typeof sourceSchema>;
export type BorrowMarketSnapshot = z.output<typeof snapshotSchema>;
export type ParsedBorrowMarketSnapshot = z.output<typeof parsedSnapshotSchema>;
export type BorrowOverviewOpportunity = z.output<typeof opportunitySchema>;
export type BorrowOverviewResponse = z.output<typeof overviewSchema>;
export type ParsedBorrowOverviewResponse = z.output<typeof parsedOverviewSchema>;
export type BorrowResponse = BorrowOverviewResponse;

export function parseSnapshot(value: unknown, expectedOwner: `0x${string}`): ParsedBorrowMarketSnapshot | null {
  const result = parsedSnapshotSchema.safeParse(value);
  return result.success && result.data.walletAddress === parseAddress(expectedOwner) ? result.data : null;
}

export function parseBorrowOverview(value: unknown, expectedOwner: `0x${string}`): ParsedBorrowOverviewResponse | null {
  const result = parsedOverviewSchema.safeParse(value);
  return result.success && result.data.owner.address === parseAddress(expectedOwner) ? result.data : null;
}

function modeNotWider(mode: "enabled" | "reducing-only", configured: "enabled" | "reducing-only"): boolean {
  return mode === "reducing-only" || configured === "enabled";
}
function assetMatches(value: BorrowAssetRef, expected: BorrowAssetRef): boolean {
  return value.id === expected.id && value.chainId === expected.chainId && parseAddress(value.address) === parseAddress(expected.address) &&
    value.symbol === expected.symbol && value.name === expected.name && value.decimals === expected.decimals;
}
function sameBlock(left: z.output<typeof blockSchema>, right: z.output<typeof blockSchema>): boolean {
  return left.blockNumber === right.blockNumber && parseHash32(left.blockHash) === parseHash32(right.blockHash) && left.blockTimestamp === right.blockTimestamp;
}
function sameSource(left: BorrowSourceBlock, right: BorrowSourceBlock): boolean {
  return sameBlock(left, right) && left.fetchedAt === right.fetchedAt;
}
function normalizedBlock(value: z.output<typeof blockSchema>) {
  return { ...value, blockHash: normalizedHash(value.blockHash) };
}
function normalizedSource(value: BorrowSourceBlock): BorrowSourceBlock {
  return { ...value, blockHash: normalizedHash(value.blockHash) };
}
function normalizedAddress(value: BorrowAddress) {
  const address = parseAddress(value);
  if (!address) throw new Error("borrow address must be validated before normalization");
  return address;
}
function normalizedHash(value: BorrowMarketId) {
  const hash = parseHash32(value);
  if (!hash) throw new Error("borrow hash must be validated before normalization");
  return hash;
}
function normalizedMarket(value: BorrowMarketIdentity) {
  return { ...value, id: normalizedHash(value.id), morpho: normalizedAddress(value.morpho),
    oracle: normalizedAddress(value.oracle), irm: normalizedAddress(value.irm),
    loanToken: { ...value.loanToken, address: normalizedAddress(value.loanToken.address) },
    collateralToken: { ...value.collateralToken, address: normalizedAddress(value.collateralToken.address) } };
}
function normalizedSnapshot(value: BorrowMarketSnapshot) {
  return { ...value, walletAddress: normalizedAddress(value.walletAddress), market: normalizedMarket(value.market), source: normalizedSource(value.source) };
}
function normalizedOverview(value: BorrowOverviewResponse) {
  return {
    ...value, owner: { ...value.owner, address: normalizedAddress(value.owner.address) },
    discovery: { ...value.discovery, sourceBlock: value.discovery.sourceBlock === null ? null : normalizedBlock(value.discovery.sourceBlock) },
    opportunities: value.opportunities.map((entry) => ({
      ...entry, market: normalizedMarket(entry.market),
      availability: entry.availability.status === "available"
        ? { ...entry.availability, source: normalizedSource(entry.availability.source), snapshot: normalizedSnapshot(entry.availability.snapshot) }
        : entry.availability,
    })),
    positions: value.positions.map((entry) => ({ ...entry, market: normalizedMarket(entry.market), source: normalizedSource(entry.source) })),
  };
}
