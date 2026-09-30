import { parseAddress, parseHash32, type Address, type Hash32 } from "@/shared/chain/hex";

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  ACTIVITY_BASE_CHAIN_ID,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_WINDOW_DAYS,
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
export type ActivityResponse = ActivityPage & { version: typeof ACTIVITY_CONTRACT_VERSION };
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const uint256Max = (BigInt(1) << BigInt(256)) - BigInt(1);
const maxWindowMs = ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
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
  if (
    !isVerifiedActivitySession(expectedSession) ||
    !isRecord(value) ||
    value.version !== ACTIVITY_CONTRACT_VERSION
  ) {
    throw new ActivityResponseError();
  }

  const walletAddress = readAddress(value.walletAddress);
  if (
    walletAddress !==
      parseAddress(expectedSession.smartAccount.address) ||
    value.chainId !== ACTIVITY_BASE_CHAIN_ID ||
    !isActivityValuationCurrency(expectedCurrency) ||
    value.currency !== expectedCurrency ||
    !isRecord(value.window)
  ) {
    throw new ActivityResponseError();
  }

  const from = readTimestamp(value.window.from);
  const to = readTimestamp(value.window.to);
  if (
    to !== expectedWindowEnd ||
    new Date(from).getTime() >= new Date(to).getTime() ||
    new Date(to).getTime() - new Date(from).getTime() > maxWindowMs
  ) {
    throw new ActivityResponseError();
  }

  if (
    !Array.isArray(value.transfers) ||
    value.transfers.length > ACTIVITY_PAGE_SIZE ||
    (value.nextCursor !== null &&
      (typeof value.nextCursor !== "string" ||
        value.nextCursor.length === 0 ||
        value.nextCursor.length > 4096))
  ) {
    throw new ActivityResponseError();
  }
  if (value.onchainStatus === "unavailable"
    ? value.source !== null || value.nextCursor !== null || value.transfers.length !== 0 || value.cards === undefined
    : value.onchainStatus !== undefined || value.source === null) {
    throw new ActivityResponseError();
  }

  const transfers = value.transfers.map((transfer) =>
    parseTransfer(transfer, walletAddress, from, to, expectedCurrency),
  );
  assertStrictDescending(transfers);

  return {
    walletAddress,
    chainId: ACTIVITY_BASE_CHAIN_ID,
    window: { from, to },
    currency: expectedCurrency,
    transfers,
    ...(value.cards === undefined ? {} : { cards: parseCardPurchases(value.cards) }),
    nextCursor: value.nextCursor,
    source: value.onchainStatus === "unavailable" ? null : parseSource(value.source),
    ...(value.onchainStatus === "unavailable" ? { onchainStatus: "unavailable" as const } : {}),
  };
}

function parseTransfer(
  value: unknown,
  walletAddress: Address,
  from: string,
  to: string,
  expectedCurrency: FiatCurrencyCode,
): ParsedActivityTransfer {
  if (!isRecord(value)) {
    throw new ActivityResponseError();
  }

  const transferWallet = readAddress(value.walletAddress);
  const tokenAddress = readAddress(value.tokenAddress);
  const normalizedTokenAddress = tokenAddress;
  const asset = activityAssetsByContract.get(normalizedTokenAddress);
  const tokenMetadata = parseTokenMetadata(value, asset);
  const fromAddress = readAddress(value.fromAddress);
  const toAddress = readAddress(value.toAddress);
  const transactionHash = readHash(value.transactionHash);
  const blockHash = readHash(value.blockHash);
  const blockTimestamp = readTimestamp(value.blockTimestamp);
  const blockTime = new Date(blockTimestamp).getTime();
  const direction = value.direction;
  const normalizedWallet = walletAddress;
  const normalizedFrom = fromAddress;
  const normalizedTo = toAddress;
  const expectedDirection =
    normalizedFrom === normalizedWallet && normalizedTo === normalizedWallet
      ? "self"
      : normalizedTo === normalizedWallet
        ? "incoming"
        : normalizedFrom === normalizedWallet
          ? "outgoing"
          : null;

  if (
    typeof value.logId !== "string" ||
    value.logId.length === 0 ||
    value.logId.length > 256 ||
    value.id !== `${ACTIVITY_BASE_CHAIN_ID}:${normalizedTokenAddress}:${value.logId}` ||
    value.id.length > 512 ||
    value.chainId !== ACTIVITY_BASE_CHAIN_ID ||
    transferWallet !== normalizedWallet ||
    direction !== expectedDirection ||
    typeof value.amountBaseUnits !== "string" ||
    !decimalIntegerPattern.test(value.amountBaseUnits) ||
    BigInt(value.amountBaseUnits) > uint256Max ||
    typeof value.blockNumber !== "string" ||
    !decimalIntegerPattern.test(value.blockNumber) ||
    typeof value.logIndex !== "string" ||
    !decimalIntegerPattern.test(value.logIndex) ||
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
    tokenAddress: normalizedTokenAddress,
    tokenSymbol: tokenMetadata.tokenSymbol,
    tokenDecimals: tokenMetadata.tokenDecimals,
    tokenImageUrl: tokenMetadata.tokenImageUrl,
    walletAddress: transferWallet,
    fromAddress: fromAddress,
    toAddress: toAddress,
    direction: direction as ActivityTransfer["direction"],
    amountBaseUnits: value.amountBaseUnits as string,
    blockNumber: value.blockNumber as string,
    blockHash,
    transactionHash,
    logIndex: value.logIndex as string,
    blockTimestamp,
    valuation: parseActivityTransferValuation(
      value.valuation,
      {
        tokenAddress: normalizedTokenAddress,
        tokenDecimals: tokenMetadata.tokenDecimals,
        amountBaseUnits: value.amountBaseUnits as string,
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

function parseSource(value: unknown): ActivityPage["source"] {
  if (
    !isRecord(value) ||
    (value.provider !== "cdp-sql" &&
      value.provider !== "cdp-address-history") ||
    typeof value.cached !== "boolean" ||
    typeof value.stale !== "boolean" ||
    !Number.isSafeInteger(value.executionTimeMs) ||
    (value.executionTimeMs as number) < 0
  ) {
    throw new ActivityResponseError();
  }

  return {
    provider: value.provider,
    cached: value.cached,
    stale: value.stale,
    executionTimestamp: readTimestamp(value.executionTimestamp),
    executionTimeMs: value.executionTimeMs as number,
    fetchedAt: readTimestamp(value.fetchedAt),
  };
}

function assertStrictDescending(transfers: readonly ActivityTransfer[]) {
  const ids = new Set<string>();
  for (let index = 0; index < transfers.length; index += 1) {
    const current = transfers[index]!;
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

function readAddress(value: unknown): Address {
  const address = parseAddress(value);
  if (!address) throw new ActivityResponseError();
  return address;
}

function readHash(value: unknown): Hash32 {
  const hash = parseHash32(value);
  if (!hash) throw new ActivityResponseError();
  return hash;
}

function readTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw new ActivityResponseError();
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new ActivityResponseError();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
