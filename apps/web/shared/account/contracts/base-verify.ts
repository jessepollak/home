import * as z from "zod/mini";
import { parseAddress, type Address } from "@/shared/chain/hex";
import { BASE_CHAIN_ID } from "@/shared/account/session-types";

export const NATIVE_BASE_VERIFY_VERSION = 1 as const;

const addressSchema = z.pipe(z.transform(parseAddress), z.custom<Address>((value) => value !== null));
const nativeBaseVerifyResponseSchema = z.object({
  version: z.literal(NATIVE_BASE_VERIFY_VERSION),
  user: z.object({ subject: z.string().check(z.minLength(1)) }),
  smartAccount: z.object({ address: addressSchema, chainId: z.literal(BASE_CHAIN_ID) }),
  accountProvider: z.literal("base-account"),
});

export type NativeBaseVerifyResponse = z.output<typeof nativeBaseVerifyResponseSchema>;

export function parseNativeBaseSession(value: unknown): NativeBaseVerifyResponse | null {
  const result = nativeBaseVerifyResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
