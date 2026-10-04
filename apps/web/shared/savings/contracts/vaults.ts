import * as z from "zod/mini";
import { parseAddress } from "@/shared/chain/hex";
import {
  BASE_USDC_ADDRESS,
  BASE_USDC_DECIMALS,
  MORPHO_V1_CANDIDATE_ADDRESSES,
} from "@/shared/savings/config";

export type Address = `0x${string}`;
export const MORPHO_API_VERSION = "v1" as const;

const timestampSchema = z.string().check(z.refine((value) => Number.isFinite(Date.parse(value))));
export const morphoSourceSchema = z.union([
  z.looseObject({
    provider: z.literal("Morpho GraphQL"),
    endpoint: z.literal("https://api.morpho.org/graphql"),
    query: z.enum(["vaults", "vaultPosition"]),
    fetchedAt: timestampSchema,
  }),
  z.looseObject({
    provider: z.literal("Base JSON-RPC"),
    blockNumber: z.string().check(z.regex(/^\d+$/)),
    fetchedAt: timestampSchema,
  }),
]);
const vaultsSourceSchema = morphoSourceSchema.check(z.refine((source) =>
  source.provider === "Morpho GraphQL" && source.query === "vaults"));
const savingsAssetSchema = z.looseObject({
  address: z.custom<Address>((value) => typeof value === "string" &&
    value.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase()),
  symbol: z.literal("USDC"),
  decimals: z.literal(BASE_USDC_DECIMALS),
});
const addressSchema = z.custom<Address>((value) =>
  typeof value === "string" && parseAddress(value.toLowerCase()) !== null);
const amountSchema = z.string().check(z.regex(/^(?:0|[1-9]\d*)$/));
const apySchema = z.number().check(z.refine((value) =>
  Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER / 100));
const feeRateSchema = z.number().check(z.refine((value) =>
  Number.isFinite(value) && value >= 0 && value <= 1));
const vaultCandidateSchema = z.looseObject({
  version: z.literal(MORPHO_API_VERSION),
  vaultAddress: z.custom<Address>((value) => typeof value === "string" &&
    MORPHO_V1_CANDIDATE_ADDRESSES.some((address) => address.toLowerCase() === value.toLowerCase())),
  name: z.string(),
  symbol: z.string(),
  listed: z.boolean(),
  chainId: z.literal(8453),
  asset: savingsAssetSchema,
  curatorAddress: z.nullable(addressSchema),
  grossApy: z.nullable(apySchema),
  netApy: z.nullable(apySchema),
  feeRate: z.nullable(feeRateSchema),
  totalAssetsRaw: z.nullable(amountSchema),
  liquidityRaw: z.nullable(amountSchema),
  stateAsOf: z.nullable(timestampSchema),
  blockNumber: z.nullable(amountSchema),
  source: vaultsSourceSchema,
});
const vaultsResultSchema = z.looseObject({
  version: z.literal(MORPHO_API_VERSION),
  chainId: z.literal(8453),
  asset: savingsAssetSchema,
  candidates: z.array(vaultCandidateSchema),
  source: vaultsSourceSchema,
  stale: z.boolean(),
}).check(z.refine((result) => {
  const addresses = result.candidates.map((candidate) => candidate.vaultAddress.toLowerCase());
  return new Set(addresses).size === addresses.length;
}));

export type MorphoSource = z.output<typeof morphoSourceSchema>;
export type MorphoVaultCandidate = z.output<typeof vaultCandidateSchema>;
export type MorphoVaultsResult = z.output<typeof vaultsResultSchema>;

export function parseVaultsResult(value: unknown): MorphoVaultsResult | null {
  const result = vaultsResultSchema.safeParse(value);
  return result.success ? result.data : null;
}
