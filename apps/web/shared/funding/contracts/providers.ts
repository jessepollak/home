import * as z from "zod/mini";
import type { FundingDirection } from "@/shared/funding/provider-contract";

export const FUNDING_PROVIDERS_VERSION = 3 as const;

const bindingBase = {
  providerId: z.string(),
  displayName: z.string(),
  region: z.string(),
  assetId: z.string(),
  assetSymbol: z.string(),
  assetDecimals: z.int(),
  currency: z.string(),
};
const onrampBindingSchema = z.object({
  ...bindingBase,
  direction: z._default(z.literal("onramp"), "onramp"),
  paymentMethods: z.readonly(z.array(z.looseObject({ id: z.string(), label: z.string() }))),
  quotes: z.boolean(),
  customerSetup: z._default(z.nullable(z.strictObject({ hosted: z.literal(true) })), null),
  resumeOnly: z.optional(z.boolean()),
});
const atomicAmountSchema = z.string().check(z.regex(/^(0|[1-9]\d*)$/));
const offrampBindingSchema = z.object({
  ...bindingBase,
  direction: z.literal("offramp"),
  paymentMethods: z.readonly(z.array(z.looseObject({
    id: z.string(), label: z.string(), platform: z.string(), handleHint: z.string(),
    minimumAmountAtomic: atomicAmountSchema, maximumAmountAtomic: z.nullable(atomicAmountSchema),
    estimateSemantics: z.literal("approximate"), etaSemantics: z.literal("historical-not-guaranteed"),
    corridorConfirmedBy: z.string(),
  }))),
  quotes: z.literal(false),
  customerSetup: z._default(z.null(), null),
});
const offrampInputSchema = z.object({ ...offrampBindingSchema.shape, kyc: z.nullish(z.null()) });
const bindingSchema = z.union([onrampBindingSchema, z.pipe(offrampInputSchema, z.transform((value: z.output<typeof offrampInputSchema>) => {
  const { kyc: _kyc, ...binding } = value;
  return binding;
}))]);
const providersEnvelopeSchema = z.object({ providers: z.array(z.unknown()) });
const providersResponseSchema = z.object({
  version: z.literal(FUNDING_PROVIDERS_VERSION),
  direction: z.enum(["onramp", "offramp"]),
  providers: z.array(bindingSchema),
});

export type FundingOfframpBinding = z.output<typeof offrampBindingSchema>;
export type FundingBinding = z.output<typeof bindingSchema>;

export function assertFundingProvidersResponse(
  value: unknown,
  direction: FundingDirection,
  region: string,
): asserts value is { version: typeof FUNDING_PROVIDERS_VERSION; direction: FundingDirection; providers: unknown[] } {
  const result = providersResponseSchema.safeParse(value);
  if (!result.success || result.data.direction !== direction ||
    !result.data.providers.every((binding) => binding.direction === direction && binding.region === region)) {
    throw new Error("Invalid funding providers response");
  }
}

/** @public validates a parsed binding list against the requested region and direction, for restored and cached values */
export function isFundingBindingListFor(value: unknown, direction: FundingDirection, region: string): value is ReadonlyArray<FundingBinding> {
  const result = z.array(bindingSchema).safeParse(value);
  return result.success && result.data.every((binding) => binding.region === region && binding.direction === direction);
}

export function readProviderBindings(value: unknown): ReadonlyArray<FundingBinding> {
  const envelope = providersEnvelopeSchema.safeParse(value);
  if (!envelope.success) return [];
  return envelope.data.providers.flatMap((item) => {
    const result = bindingSchema.safeParse(item);
    if (!result.success) return [];
    return [result.data.direction === "onramp" ? { ...result.data, resumeOnly: result.data.resumeOnly === true } : result.data];
  });
}
