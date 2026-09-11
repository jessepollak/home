import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  ACTIVITY_BASE_CHAIN_ID,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_WINDOW_DAYS,
  activityAssets,
  type ActivityAsset,
  type ActivityPage,
  type ActivityTransfer,
} from "./types";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const uint256Max = (BigInt(1) << BigInt(256)) - BigInt(1);
const maxWindowMs = ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const assetsByContract = new Map<string, ActivityAsset>(
  activityAssets.map((asset) => [asset.tokenAddress.toLowerCase(), asset]),
);

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
      addressPattern.test(value.smartAccount.address) &&
      value.smartAccount.chainId === ACTIVITY_BASE_CHAIN_ID,
  );
}

export function parseActivityPage(
  value: unknown,
  expectedSession: VerifiedAccountSession,
  expectedWindowEnd: string,
): ActivityPage {
  if (!isVerifiedActivitySession(expectedSession) || !isRecord(value)) {
    throw new ActivityResponseError();
  }

  const walletAddress = readAddress(value.walletAddress);
  if (
    walletAddress.toLowerCase() !==
      expectedSession.smartAccount.address.toLowerCase() ||
    value.chainId !== ACTIVITY_BASE_CHAIN_ID ||
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

  const transfers = value.transfers.map((transfer) =>
    parseTransfer(transfer, walletAddress, from, to),
  );
  assertStrictDescending(transfers);

  return {
    walletAddress: walletAddress.toLowerCase() as `0x${string}`,
    chainId: ACTIVITY_BASE_CHAIN_ID,
    window: { from, to },
    transfers,
    nextCursor: value.nextCursor,
    source: parseSource(value.source),
  };
}

function parseTransfer(
  value: unknown,
  walletAddress: `0x${string}`,
  from: string,
  to: string,
): ActivityTransfer {
  if (!isRecord(value)) {
    throw new ActivityResponseError();
  }

  const transferWallet = readAddress(value.walletAddress);
  const tokenAddress = readAddress(value.tokenAddress);
  const normalizedTokenAddress = tokenAddress.toLowerCase();
  const asset = assetsByContract.get(normalizedTokenAddress);
  const expectedAssetId = asset?.id ?? null;
  const expectedSymbol = asset?.symbol ?? null;
  const expectedDecimals = asset?.decimals ?? null;
  const fromAddress = readAddress(value.fromAddress);
  const toAddress = readAddress(value.toAddress);
  const transactionHash = readHash(value.transactionHash);
  const blockHash = readHash(value.blockHash);
  const blockTimestamp = readTimestamp(value.blockTimestamp);
  const blockTime = new Date(blockTimestamp).getTime();
  const direction = value.direction;
  const normalizedWallet = walletAddress.toLowerCase();
  const normalizedFrom = fromAddress.toLowerCase();
  const normalizedTo = toAddress.toLowerCase();
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
    value.assetId !== expectedAssetId ||
    value.tokenSymbol !== expectedSymbol ||
    value.tokenDecimals !== expectedDecimals ||
    transferWallet.toLowerCase() !== normalizedWallet ||
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
    assetId: expectedAssetId,
    tokenAddress: normalizedTokenAddress as `0x${string}`,
    tokenSymbol: expectedSymbol,
    tokenDecimals: expectedDecimals,
    walletAddress: transferWallet.toLowerCase() as `0x${string}`,
    fromAddress: fromAddress.toLowerCase() as `0x${string}`,
    toAddress: toAddress.toLowerCase() as `0x${string}`,
    direction: direction as ActivityTransfer["direction"],
    amountBaseUnits: value.amountBaseUnits as string,
    blockNumber: value.blockNumber as string,
    blockHash,
    transactionHash,
    logIndex: value.logIndex as string,
    blockTimestamp,
  };
}

function parseSource(value: unknown): ActivityPage["source"] {
  if (
    !isRecord(value) ||
    value.provider !== "cdp-sql" ||
    typeof value.cached !== "boolean" ||
    typeof value.stale !== "boolean" ||
    !Number.isSafeInteger(value.executionTimeMs) ||
    (value.executionTimeMs as number) < 0
  ) {
    throw new ActivityResponseError();
  }

  return {
    provider: "cdp-sql",
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
  ] as const;
  for (const [leftValue, rightValue] of numericComparisons) {
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1;
  }
  if (left.transactionHash !== right.transactionHash) {
    return left.transactionHash > right.transactionHash ? 1 : -1;
  }
  const leftLog = BigInt(left.logIndex);
  const rightLog = BigInt(right.logIndex);
  if (leftLog !== rightLog) return leftLog > rightLog ? 1 : -1;
  if (left.id === right.id) return 0;
  return left.id > right.id ? 1 : -1;
}

function readAddress(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new ActivityResponseError();
  }
  return value as `0x${string}`;
}

function readHash(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    throw new ActivityResponseError();
  }
  return value.toLowerCase() as `0x${string}`;
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
