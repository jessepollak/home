import * as z from "zod/mini";
import { parseHash32, type Hash32 } from "@/shared/chain/hex";
import type { AccountProvider, VerifiedAccountSession } from "@/shared/account/session-types";
import type { CashoutProgressState } from "@/shared/funding/contracts/cash-out-progress";

export const ACTIVITY_ORDERS_CONTRACT_VERSION = 1 as const;
export const ACTIVITY_ORDERS_LIMIT = 50;

const statusSchema = z.enum([
  "waiting-customer", "waiting-provider", "waiting-chain", "waiting-home", "confirmed",
  "failed", "expired", "ambiguous", "reversed", "refunded",
]);
const fundingStageSchema = z.enum([
  "awaiting-payment", "provider-processing", "arriving", "received",
  "expired", "cancelled", "cleared", "failed", "refunded", "unconfirmed",
]);
const instructionKindSchema = z.enum(["redirect", "embed", "bank-transfer", "qr", "payment-key"]);
const cashoutStateValues = [
  "submitted", "awaiting-buyer", "matched", "delivering", "delivered", "returned", "failed", "unknown",
] as const satisfies readonly CashoutProgressState[];
const cashoutStateSchema = z.enum(cashoutStateValues);
const atomicPattern = /^(?:0|[1-9][0-9]*)$/;
const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const textSchema = z.string().check(z.minLength(1));
const timestampSchema = z.string().check(z.refine((value) => Number.isFinite(Date.parse(value))));
const atomicSchema = z.string().check(z.regex(atomicPattern));
const hashSchema = z.pipe(
  z.string().check(z.refine((value) => parseHash32(value) !== null)),
  z.transform((value: string): Hash32 => parseHash32(value) as Hash32),
);
const decimalsSchema = z.int().check(z.nonnegative());

const fundingOrderSchema = z.object({
  kind: z.literal("funding"),
  id: textSchema,
  region: textSchema,
  providerId: textSchema,
  providerName: textSchema,
  paymentMethodLabel: textSchema,
  status: statusSchema,
  stage: fundingStageSchema,
  instruction: z.nullable(instructionKindSchema),
  resumable: z.boolean(),
  fiatAmount: z.string().check(z.regex(decimalPattern)),
  fiatCurrency: textSchema,
  asset: z.object({ id: textSchema, symbol: textSchema, decimals: decimalsSchema }),
  tokenAmountAtomic: z.nullable(atomicSchema),
  sandbox: z.boolean(),
  expiresAt: z.nullable(timestampSchema),
  clearableAt: z.nullable(timestampSchema),
  transactionHash: z.nullable(hashSchema),
  logIndex: z.nullable(atomicSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).check(z.refine((order) => order.transactionHash !== null || order.logIndex === null));

const cashoutOrderSchema = z.object({
  kind: z.literal("cash-out"),
  id: textSchema,
  orderId: z.nullable(textSchema),
  region: textSchema,
  providerId: textSchema,
  providerName: textSchema,
  platform: textSchema,
  platformLabel: textSchema,
  status: statusSchema,
  state: cashoutStateSchema,
  decimals: decimalsSchema,
  amountAtomic: atomicSchema,
  filledAtomic: atomicSchema,
  returnedAtomic: atomicSchema,
  remainingAtomic: atomicSchema,
  withdrawable: z.boolean(),
  settledAt: z.nullable(timestampSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const orderSchema = z.discriminatedUnion("kind", [fundingOrderSchema, cashoutOrderSchema]);
const responseSchema = z.object({
  version: z.literal(ACTIVITY_ORDERS_CONTRACT_VERSION),
  owner: z.object({
    subject: z.string(),
    accountProvider: z.enum(["cdp-embedded", "base-account"] as const satisfies readonly AccountProvider[]),
  }),
  orders: z.pipe(z.array(z.unknown()), z.transform((items): ActivityOrder[] => items.flatMap((item) => {
    const result = orderSchema.safeParse(item);
    return result.success ? [result.data] : [];
  }))),
});

export type ActivityOrderStatus = z.output<typeof statusSchema>;
export type ActivityFundingOrderStage = z.output<typeof fundingStageSchema>;
export type ActivityFundingOrder = z.output<typeof fundingOrderSchema>;
export type ActivityCashoutOrder = z.output<typeof cashoutOrderSchema>;
export type ActivityOrder = z.output<typeof orderSchema>;
export type ActivityOrdersResponse = z.output<typeof responseSchema>;

export class ActivityOrdersResponseError extends Error {
  constructor() {
    super("The activity orders response is invalid.");
    this.name = "ActivityOrdersResponseError";
  }
}

export function isActivityOrdersResponse(value: unknown): value is {
  version: typeof ACTIVITY_ORDERS_CONTRACT_VERSION;
  owner: unknown;
  orders: unknown[];
} {
  return responseSchema.safeParse(value).success;
}

export function parseActivityOrders(value: unknown, session: VerifiedAccountSession): ActivityOrder[] {
  const result = responseSchema.safeParse(value);
  if (!result.success || result.data.owner.subject !== session.user.subject ||
    result.data.owner.accountProvider !== session.accountProvider) throw new ActivityOrdersResponseError();
  return result.data.orders;
}
