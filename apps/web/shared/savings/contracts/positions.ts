import * as z from "zod/mini";
import { parseAddress } from "@/shared/chain/hex";
import { MORPHO_API_VERSION, morphoSourceSchema, type Address } from "./vaults";

export { MORPHO_API_VERSION } from "./vaults";

const addressSchema = z.custom<Address>((value) =>
  typeof value === "string" && parseAddress(value.toLowerCase()) !== null);
const amountSchema = z.string().check(z.regex(/^(?:0|[1-9]\d*)$/));
const positionSchema = z.object({
  version: z.literal(MORPHO_API_VERSION),
  accountAddress: addressSchema,
  vaultAddress: addressSchema,
  assetsRaw: z.nullable(amountSchema),
  sharesRaw: amountSchema,
  indexedAt: z.string().check(z.refine((value) => Number.isFinite(Date.parse(value)))),
  source: morphoSourceSchema.check(z.refine((source) =>
    source.provider === "Base JSON-RPC" || source.query === "vaultPosition")),
  withdrawableRaw: z.null(),
  withdrawableNote: z.string(),
});

export type MorphoVaultPosition = z.output<typeof positionSchema>;

export function parseVaultPosition(value: unknown): MorphoVaultPosition | null {
  const result = positionSchema.safeParse(value);
  return result.success ? result.data : null;
}
