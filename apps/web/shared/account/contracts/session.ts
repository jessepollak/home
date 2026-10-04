import * as z from "zod/mini";
import { BASE_CHAIN_ID } from "@/shared/account/session-types";
import { parseAddress, type Address } from "@/shared/chain/hex";

export const SESSION_VERSION = 1 as const;

const addressSchema = z.pipe(z.transform(parseAddress), z.custom<Address>((value) => value !== null));
const sessionResponseSchema = z.object({
  version: z.literal(SESSION_VERSION),
  user: z.object({ subject: z.string().check(z.refine((value) => value.trim().length > 0)) }),
  smartAccount: z.nullable(z.object({ address: addressSchema, chainId: z.literal(BASE_CHAIN_ID) })),
  accountProvider: z.enum(["cdp-embedded", "base-account"]),
}).check(z.refine((value) => value.accountProvider !== "base-account" || value.smartAccount !== null));

export type SessionResponse = z.output<typeof sessionResponseSchema>;

export function parseSession(value: unknown): SessionResponse | null {
  const result = sessionResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
