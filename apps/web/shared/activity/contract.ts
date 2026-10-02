import * as z from "zod/mini";
import { parseAddress, parseHash32, type Address, type Hash32 } from "@/shared/chain/hex";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  ACTIVITY_BASE_CHAIN_ID,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_HISTORY_START,
  type ActivityAsset,
  type ActivityPage,
  type ActivityTransfer,
} from "@/shared/activity/types";
import {
  activityAssetsByContract,
  sanitizeDynamicActivityTokenMetadata,
  sanitizeActivityTokenImageUrl,
} from "@/shared/activity/metadata";
import {
  isActivityValuationCurrency,
  parseActivityTransferValuation,
} from "@/shared/activity/valuation";
import type { FiatCurrencyCode } from "@/config/regions";
import { parseCardPurchases } from "@/shared/cards/transactions-contract";

export const ACTIVITY_CONTRACT_VERSION = 1;
export type ParsedActivityTransfer = ActivityTransfer & {
  tokenAddress: Address; walletAddress: Address; fromAddress: Address; toAddress: Address;
  blockHash: Hash32; transactionHash: Hash32;
};
export type ParsedActivityPage = ActivityPage & { walletAddress: Address; transfers: ParsedActivityTransfer[] };
export type ActivityResponse = z.input<typeof pageSchema> & ActivityPage;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const uint256Max = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressSchema = z.pipe(
  z.string().check(z.refine((value) => parseAddress(value) !== null)),
  z.transform((value: string): Address => parseAddress(value) as Address),
);
const hashSchema = z.pipe(
  z.string().check(z.refine((value) => parseHash32(value) !== null)),
  z.transform((value: string): Hash32 => parseHash32(value) as Hash32),
);
const timestampSchema = z.string().check(z.refine((value) =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
));
const decimalIntegerSchema = z.string().check(z.regex(decimalIntegerPattern));
const transferSchema = z.object({
  id: z.string().check(z.maxLength(512)),
  logId: z.string().check(z.minLength(1), z.maxLength(256)),
  chainId: z.literal(ACTIVITY_BASE_CHAIN_ID),
  assetId: z.unknown(),
  tokenAddress: addressSchema,
  tokenSymbol: z.unknown(),
  tokenDecimals: z.unknown(),
  tokenImageUrl: z.optional(z.unknown()),
  walletAddress: addressSchema,
  fromAddress: addressSchema,
  toAddress: addressSchema,
  direction: z.enum(["incoming", "outgoing", "self"]),
  amountBaseUnits: decimalIntegerSchema,
  blockNumber: decimalIntegerSchema,
  blockHash: hashSchema,
  transactionHash: hashSchema,
  logIndex: decimalIntegerSchema,
  blockTimestamp: timestampSchema,
  valuation: z.optional(z.unknown()),
});
type ActivityWireTransfer = z.output<typeof transferSchema>;
const sourceSchema = z.object({
  provider: z.enum(["cdp-sql", "cdp-address-history"]),
  cached: z.boolean(),
  stale: z.boolean(),
  executionTimestamp: timestampSchema,
  executionTimeMs: z.int().check(z.nonnegative()),
  fetchedAt: timestampSchema,
});
const pageSchema = z.object({
  version: z.literal(ACTIVITY_CONTRACT_VERSION),
  walletAddress: addressSchema,
  chainId: z.literal(ACTIVITY_BASE_CHAIN_ID),
  window: z.object({ from: timestampSchema, to: timestampSchema }),
  currency: z.string(),
  transfers: z.array(transferSchema).check(z.maxLength(ACTIVITY_PAGE_SIZE)),
  cards: z.optional(z.unknown()),
  nextCursor: z.nullable(z.string().check(z.minLength(1), z.maxLength(4096))),
  source: z.nullable(sourceSchema),
  onchainStatus: z.optional(z.literal("unavailable")),
});
export class ActivityResponseError extends Error {
  constructor() {
    super("The activity response is invalid.");
    this.name = "ActivityResponseError";
  }
}

export function isVerifiedActivitySession(
  value: VerifiedAccountSession | null,
): value is VerifiedAccountSession & {
  smartAccount: NonNullable<VerifiedAccountSession["smartAccount"]>;
} {
  return Boolean(
    value &&
      typeof value.user?.subject === "string" &&
      value.user.subject.trim().length > 0 &&
      (value.accountProvider === "cdp-embedded" ||
        value.accountProvider === "base-account") &&
      value.smartAccount &&
      parseAddress(value.smartAccount.address) !== null &&
      value.smartAccount.chainId === ACTIVITY_BASE_CHAIN_ID,
  );
}

export function parseActivityPage(
  value: unknown,
  expectedSession: VerifiedAccountSession,
  expectedWindowEnd: string,
  expectedCurrency: FiatCurrencyCode = "USD",
): ParsedActivityPage {
  const result = pageSchema.safeParse(value);
  if (!isVerifiedActivitySession(expectedSession) || !result.success) {
    throw new ActivityResponseError();
  }
  const wire = result.data;
  const walletAddress = wire.walletAddress;
  const { from, to } = wire.window;
  if (
    walletAddress !== parseAddress(expectedSession.smartAccount.address) ||
    wire.chainId !== ACTIVITY_BASE_CHAIN_ID ||
    !isActivityValuationCurrency(expectedCurrency) ||
    wire.currency !== expectedCurrency ||
    to !== expectedWindowEnd ||
    new Date(from).getTime() >= new Date(to).getTime() ||
    new Date(from).getTime() < Date.parse(ACTIVITY_HISTORY_START)
  ) {
    throw new ActivityResponseError();
  }
  if (wire.onchainStatus === "unavailable"
    ? wire.source !== null || wire.nextCursor !== null || wire.transfers.length !== 0 || wire.cards === undefined
    : wire.source === null) {
    throw new ActivityResponseError();
  }

  const transfers = wire.transfers.map((transfer) =>
    parseTransfer(transfer, walletAddress, from, to, expectedCurrency),
  );
  assertStrictDescending(transfers);

  return {
    walletAddress,
    chainId: ACTIVITY_BASE_CHAIN_ID,
    window: { from, to },
    currency: expectedCurrency,
    transfers,
    ...(wire.cards === undefined ? {} : { cards: parseCardPurchases(wire.cards) }),
    nextCursor: wire.nextCursor,
    source: wire.onchainStatus === "unavailable" ? null : wire.source,
    ...(wire.onchainStatus === "unavailable" ? { onchainStatus: wire.onchainStatus } : {}),
  };
}

function parseTransfer(
  value: ActivityWireTransfer,
  walletAddress: Address,
  from: string,
  to: string,
  expectedCurrency: FiatCurrencyCode,
): ParsedActivityTransfer {
  const transferWallet = value.walletAddress;
  const tokenAddress = value.tokenAddress;
  const asset = activityAssetsByContract.get(tokenAddress);
  const tokenMetadata = parseTokenMetadata(value, asset);
  const fromAddress = value.fromAddress;
  const toAddress = value.toAddress;
  const { transactionHash, blockHash, blockTimestamp, direction } = value;
  const blockTime = new Date(blockTimestamp).getTime();
  const expectedDirection =
    fromAddress === walletAddress && toAddress === walletAddress
      ? "self"
      : toAddress === walletAddress
        ? "incoming"
        : fromAddress === walletAddress
          ? "outgoing"
          : null;

  if (
    value.id !== `${ACTIVITY_BASE_CHAIN_ID}:${tokenAddress}:${value.logId}` ||
    transferWallet !== walletAddress ||
    direction !== expectedDirection ||
    BigInt(value.amountBaseUnits) > uint256Max ||
    blockTime < new Date(from).getTime() ||
    blockTime >= new Date(to).getTime()
  ) {
    throw new ActivityResponseError();
  }

  return {
    id: value.id,
    logId: value.logId,
    chainId: ACTIVITY_BASE_CHAIN_ID,
    assetId: tokenMetadata.assetId,
    tokenAddress,
    tokenSymbol: tokenMetadata.tokenSymbol,
    tokenDecimals: tokenMetadata.tokenDecimals,
    tokenImageUrl: tokenMetadata.tokenImageUrl,
    walletAddress: transferWallet,
    fromAddress,
    toAddress,
    direction,
    amountBaseUnits: value.amountBaseUnits,
    blockNumber: value.blockNumber,
    blockHash,
    transactionHash,
    logIndex: value.logIndex,
    blockTimestamp,
    valuation: parseActivityTransferValuation(
      value.valuation,
      {
        tokenAddress,
        tokenDecimals: tokenMetadata.tokenDecimals,
        amountBaseUnits: value.amountBaseUnits,
        blockTimestamp,
      },
      expectedCurrency,
    ),
  };
}

function parseTokenMetadata(
  value: Record<string, unknown>,
  asset: ActivityAsset | undefined,
): Pick<ActivityTransfer, "assetId" | "tokenSymbol" | "tokenDecimals" | "tokenImageUrl"> {
  const image = value.tokenImageUrl;
  const tokenImageUrl = image === undefined || image === null
    ? null
    : sanitizeActivityTokenImageUrl(image, asset ? "registry" : "dynamic");
  if (image !== undefined && image !== null &&
    (typeof image !== "string" || tokenImageUrl === null || image !== tokenImageUrl)
  ) throw new ActivityResponseError();
  if (asset) {
    if (
      value.assetId !== asset.id ||
      value.tokenSymbol !== asset.symbol ||
      value.tokenDecimals !== asset.decimals
    ) {
      throw new ActivityResponseError();
    }
    return {
      assetId: asset.id,
      tokenSymbol: asset.symbol,
      tokenDecimals: asset.decimals,
      tokenImageUrl,
    };
  }

  if (value.assetId !== null) throw new ActivityResponseError();
  if (value.tokenSymbol === null && value.tokenDecimals === null) {
    if (tokenImageUrl !== null) throw new ActivityResponseError();
    return { assetId: null, tokenSymbol: null, tokenDecimals: null, tokenImageUrl: null };
  }
  if (value.tokenSymbol === null || value.tokenDecimals === null) {
    throw new ActivityResponseError();
  }
  const sanitized = sanitizeDynamicActivityTokenMetadata({
    symbol: value.tokenSymbol,
    decimals: value.tokenDecimals,
  });
  if (
    sanitized.tokenSymbol === null ||
    sanitized.tokenSymbol !== value.tokenSymbol ||
    sanitized.tokenDecimals !== value.tokenDecimals
  ) {
    throw new ActivityResponseError();
  }
  return { ...sanitized, tokenImageUrl };
}

function assertStrictDescending(transfers: readonly ActivityTransfer[]) {
  const ids = new Set<string>();
  for (let index = 0; index < transfers.length; index += 1) {
    const current = transfers[index];
    if (!current) throw new ActivityResponseError();
    if (ids.has(current.id)) {
      throw new ActivityResponseError();
    }
    ids.add(current.id);
    const previous = transfers[index - 1];
    if (previous && compareActivityTransferKeys(previous, current) <= 0) {
      throw new ActivityResponseError();
    }
  }
}

export function compareActivityTransferKeys(
  left: ActivityTransfer,
  right: ActivityTransfer,
): number {
  const numericComparisons = [
    [BigInt(left.blockNumber), BigInt(right.blockNumber)],
    [BigInt(left.logIndex), BigInt(right.logIndex)],
  ] as const;
  for (const [leftValue, rightValue] of numericComparisons) {
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1;
  }
  if (left.transactionHash !== right.transactionHash) {
    return left.transactionHash > right.transactionHash ? 1 : -1;
  }
  if (left.id === right.id) return 0;
  return left.id > right.id ? 1 : -1;
}
