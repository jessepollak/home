import {
  BASE_CHAIN_ID,
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  isConfiguredMorphoVault,
} from "@/shared/savings/config";
import {
  MORPHO_API_VERSION,
  type Address,
  type MorphoSource,
  type MorphoVaultCandidate,
} from "@/shared/savings/types";

export class MorphoSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MorphoSchemaError";
  }
}

export function normalizeVaultCandidate(
  value: unknown,
  source: MorphoSource,
): MorphoVaultCandidate | null {
  const vault = asRecord(value, "vault");

  if (!("state" in vault) && ("avgNetApy" in vault || "totalAssets" in vault)) {
    throw new MorphoSchemaError(
      "Received a Morpho Vault V2 shape while the adapter is configured for V1.",
    );
  }

  const address = readAddress(vault.address, "vault.address");
  const chain = asRecord(vault.chain, "vault.chain");
  const asset = asRecord(vault.asset, "vault.asset");
  const chainId = readSafeInteger(chain.id, "vault.chain.id");
  const assetAddress = readAddress(asset.address, "vault.asset.address");
  const decimals = readSafeInteger(asset.decimals, "vault.asset.decimals");

  if (
    chainId !== BASE_CHAIN_ID ||
    assetAddress.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase() ||
    decimals !== BASE_USDC_DECIMALS ||
    !isConfiguredMorphoVault(address)
  ) {
    return null;
  }

  const state = vault.state === null ? null : asRecord(vault.state, "vault.state");
  const liquidity =
    vault.liquidity === null || vault.liquidity === undefined
      ? null
      : asRecord(vault.liquidity, "vault.liquidity");

  return {
    version: MORPHO_API_VERSION,
    vaultAddress: address,
    name: readString(vault.name, "vault.name"),
    symbol: readString(vault.symbol, "vault.symbol"),
    listed: readBoolean(vault.listed, "vault.listed"),
    chainId: BASE_CHAIN_ID,
    asset: {
      address: BASE_USDC_ADDRESS,
      symbol: "USDC",
      decimals: BASE_USDC_DECIMALS,
    },
    curatorAddress: state
      ? readNullableAddress(state.curator, "vault.state.curator")
      : null,
    grossApy: state ? readNullableRate(state.apy, "vault.state.apy") : null,
    netApy: state ? readNullableRate(state.netApy, "vault.state.netApy") : null,
    feeRate: state ? readNullableRate(state.fee, "vault.state.fee") : null,
    totalAssetsRaw: state
      ? readNullableUnsignedInteger(state.totalAssets, "vault.state.totalAssets")
      : null,
    liquidityRaw: liquidity
      ? readNullableUnsignedInteger(
          liquidity.underlying,
          "vault.liquidity.underlying",
        )
      : null,
    stateAsOf: state
      ? readNullableUnixTimestamp(state.timestamp, "vault.state.timestamp")
      : null,
    blockNumber: state
      ? readNullableUnsignedInteger(state.blockNumber, "vault.state.blockNumber")
      : null,
    source,
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MorphoSchemaError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new MorphoSchemaError(`${label} must be a string.`);
  }
  return value;
}

function readBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new MorphoSchemaError(`${label} must be a boolean.`);
  }
  return value;
}

function readAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new MorphoSchemaError(`${label} must be an EVM address.`);
  }
  return value as Address;
}

function readNullableAddress(value: unknown, label: string): Address | null {
  if (value === null || value === undefined) return null;
  return readAddress(value, label);
}

function readSafeInteger(value: unknown, label: string) {
  const raw = readUnsignedInteger(value, label);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new MorphoSchemaError(`${label} exceeds the safe integer range.`);
  }
  return parsed;
}

function readUnsignedInteger(value: unknown, label: string) {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw new MorphoSchemaError(`${label} must be an unsigned integer.`);
}

function readNullableUnsignedInteger(value: unknown, label: string) {
  if (value === null || value === undefined) return null;
  return readUnsignedInteger(value, label);
}

function readNullableRate(value: unknown, label: string) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
  } else if (
    typeof value === "string" &&
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value)
  ) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  throw new MorphoSchemaError(`${label} must be a finite number.`);
}

function readUnixTimestamp(value: unknown, label: string) {
  const seconds = readSafeInteger(value, label);
  const date = new Date(seconds * 1_000);
  if (Number.isNaN(date.valueOf())) {
    throw new MorphoSchemaError(`${label} is not a valid Unix timestamp.`);
  }
  return date.toISOString();
}

function readNullableUnixTimestamp(value: unknown, label: string) {
  if (value === null || value === undefined) return null;
  return readUnixTimestamp(value, label);
}
