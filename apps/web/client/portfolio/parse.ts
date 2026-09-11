import {
  PORTFOLIO_BASE_CHAIN_ID,
  PORTFOLIO_BASE_USDC_ADDRESS,
  type PortfolioAssetBalance,
  type PortfolioSnapshot,
  type VerifiedPortfolioSession,
} from "./types";

const UINT256_MAX =
  (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const blockHashPattern = /^0x[0-9a-fA-F]{64}$/;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;

export class PortfolioResponseError extends Error {
  constructor() {
    super("The portfolio response is invalid.");
    this.name = "PortfolioResponseError";
  }
}

export function parsePortfolioSnapshot(
  value: unknown,
  expectedSession: VerifiedPortfolioSession,
): PortfolioSnapshot {
  if (!isRecord(value)) {
    throw new PortfolioResponseError();
  }

  const walletAddress = readAddress(value.walletAddress);
  if (
    expectedSession.chainId !== PORTFOLIO_BASE_CHAIN_ID ||
    !addressPattern.test(expectedSession.smartAccountAddress) ||
    walletAddress.toLowerCase() !==
      expectedSession.smartAccountAddress.toLowerCase() ||
    value.chainId !== PORTFOLIO_BASE_CHAIN_ID
  ) {
    throw new PortfolioResponseError();
  }

  const blockNumber = readDecimalInteger(value.blockNumber);
  const blockTimestamp = readDecimalInteger(value.blockTimestamp);
  if (
    typeof value.blockHash !== "string" ||
    !blockHashPattern.test(value.blockHash) ||
    typeof value.fetchedAt !== "string" ||
    !isCanonicalIsoTimestamp(value.fetchedAt) ||
    !Array.isArray(value.assets) ||
    value.assets.length !== 2
  ) {
    throw new PortfolioResponseError();
  }

  const assets = value.assets.map(parseAsset);
  const usdc = assets.find((asset) => asset.id === "usdc");
  const eth = assets.find((asset) => asset.id === "eth");
  if (!usdc || !eth || new Set(assets.map((asset) => asset.id)).size !== 2) {
    throw new PortfolioResponseError();
  }

  return {
    walletAddress: walletAddress.toLowerCase() as `0x${string}`,
    chainId: PORTFOLIO_BASE_CHAIN_ID,
    blockNumber,
    blockHash: value.blockHash.toLowerCase() as `0x${string}`,
    blockTimestamp,
    fetchedAt: value.fetchedAt,
    assets,
  };
}

export function isVerifiedPortfolioSession(
  value: VerifiedPortfolioSession | null,
): value is VerifiedPortfolioSession {
  return Boolean(
    value &&
      typeof value.subject === "string" &&
      value.subject.trim().length > 0 &&
      addressPattern.test(value.smartAccountAddress) &&
      value.chainId === PORTFOLIO_BASE_CHAIN_ID,
  );
}

function parseAsset(value: unknown): PortfolioAssetBalance {
  if (!isRecord(value)) {
    throw new PortfolioResponseError();
  }
  const balanceBaseUnits = readUint256Decimal(value.balanceBaseUnits);

  if (
    value.id === "usdc" &&
    value.symbol === "USDC" &&
    value.decimals === 6 &&
    value.kind === "erc20" &&
    typeof value.tokenAddress === "string" &&
    value.tokenAddress.toLowerCase() ===
      PORTFOLIO_BASE_USDC_ADDRESS.toLowerCase()
  ) {
    return {
      id: "usdc",
      symbol: "USDC",
      decimals: 6,
      kind: "erc20",
      tokenAddress: PORTFOLIO_BASE_USDC_ADDRESS,
      balanceBaseUnits,
    };
  }

  if (
    value.id === "eth" &&
    value.symbol === "ETH" &&
    value.decimals === 18 &&
    value.kind === "native" &&
    !("tokenAddress" in value)
  ) {
    return {
      id: "eth",
      symbol: "ETH",
      decimals: 18,
      kind: "native",
      balanceBaseUnits,
    };
  }

  throw new PortfolioResponseError();
}

function readAddress(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new PortfolioResponseError();
  }
  return value as `0x${string}`;
}

function readDecimalInteger(value: unknown): string {
  if (typeof value !== "string" || !decimalIntegerPattern.test(value)) {
    throw new PortfolioResponseError();
  }
  return value;
}

function readUint256Decimal(value: unknown): string {
  const decimal = readDecimalInteger(value);
  if (BigInt(decimal) > UINT256_MAX) {
    throw new PortfolioResponseError();
  }
  return decimal;
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
