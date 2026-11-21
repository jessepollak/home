import * as z from "zod/mini";
import type { ConnectionCheckOutcome } from "@/shared/funding/provider-contract";

export const FUNDING_CONNECTIONS_VERSION = 1;
export type FundingConnectionStatus = ConnectionCheckOutcome | "not-configured" | "unsupported";
export type FundingConnectionResult = {
  providerId: string;
  checkedAt: string;
  status: FundingConnectionStatus;
  scopes: { regions: string[]; status: FundingConnectionStatus }[];
};

const providerId = z.string().check(z.regex(/^[a-z][a-z0-9-]{0,31}$/));
const status = z.enum(["connected", "rejected", "unreachable", "inconclusive", "not-configured", "unsupported"]);
const requestSchema = z.strictObject({ version: z.literal(FUNDING_CONNECTIONS_VERSION), providerId });
const responseSchema = z.strictObject({
  version: z.literal(FUNDING_CONNECTIONS_VERSION),
  providerId,
  checkedAt: z.string().check(z.refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)))),
  status,
  scopes: z.array(z.strictObject({
    regions: z.array(z.string().check(z.regex(/^[A-Z]{2}$/))).check(z.maxLength(250), z.refine((values) => new Set(values).size === values.length)),
    status,
  })).check(z.minLength(1), z.maxLength(250)),
});

export type FundingConnectionRequest = z.output<typeof requestSchema>;
export type FundingConnectionResponse = z.output<typeof responseSchema>;

export function parseFundingConnectionRequest(value: unknown): FundingConnectionRequest | null {
  const parsed = requestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseFundingConnectionResponse(value: unknown): FundingConnectionResponse | null {
  const parsed = responseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
