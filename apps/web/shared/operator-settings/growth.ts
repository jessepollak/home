import * as z from "zod/mini";
import { countryRegionIds } from "@/config/regions";
import { parseAddress, requireAddress } from "@/shared/chain/hex";

export const GROWTH_SETTINGS_DOMAIN = "growth" as const;
export const GROWTH_TERMS_MAX_LENGTH = 8_000;
export const GROWTH_MAX_HOLD_DAYS = 365;
export const GROWTH_MAX_PER_INVITER_CAP = 1_000;
export const USDC_ATOMS_PATTERN = /^(?:0|[1-9]\d{0,29})$/;

const catalog = new Set<string>(countryRegionIds);
const atomsSchema = z.string().check(z.regex(USDC_ATOMS_PATTERN));
const isoInstantSchema = z.string().check(z.refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value))));
const payoutAccountSchema = z.nullable(z.pipe(
  z.custom<string>((value) => parseAddress(value) !== null),
  z.transform((value) => requireAddress(value)),
));

const growthShapeSchema = z.strictObject({
  enabled: z.boolean(),
  countries: z.array(z.string().check(z.refine((code) => catalog.has(code)))).check(
    z.maxLength(300), z.refine((codes) => new Set(codes).size === codes.length)),
  acknowledgements: z.strictObject({ taxReporting: z.boolean(), sanctionsScreening: z.boolean() }),
  inviterRewardAtoms: atomsSchema,
  minDepositAtoms: atomsSchema,
  holdDays: z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 1 && value <= GROWTH_MAX_HOLD_DAYS)),
  perInviterCap: z.number().check(z.refine((value) => Number.isSafeInteger(value) && value >= 1 && value <= GROWTH_MAX_PER_INVITER_CAP)),
  budgetAtoms: atomsSchema,
  startsAt: z.nullable(isoInstantSchema),
  endsAt: z.nullable(isoInstantSchema),
  termsText: z.string().check(z.maxLength(GROWTH_TERMS_MAX_LENGTH), z.refine((text) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))),
  payoutAccount: payoutAccountSchema,
}).check(z.refine((value) => value.startsAt === null || value.endsAt === null || Date.parse(value.startsAt) < Date.parse(value.endsAt)));

const canonicalize = z.transform((value: z.output<typeof growthShapeSchema>) => ({
  ...value,
  countries: countryRegionIds.filter((code) => value.countries.includes(code)),
}));
const growthSchema = z.pipe(growthShapeSchema, canonicalize);

export type GrowthSettings = z.output<typeof growthSchema>;

export const GROWTH_SETTINGS_DEFAULTS: GrowthSettings = {
  enabled: false,
  countries: [],
  acknowledgements: { taxReporting: false, sanctionsScreening: false },
  inviterRewardAtoms: "0",
  minDepositAtoms: "25000000",
  holdDays: 30,
  perInviterCap: 10,
  budgetAtoms: "0",
  startsAt: null,
  endsAt: null,
  termsText: "",
  payoutAccount: null,
};

export type GrowthEnableBlocker =
  | "countries" | "acknowledgements" | "reward" | "minimum-deposit" | "budget" | "terms" | "payout-account";

export function growthEnableBlockers(value: GrowthSettings): GrowthEnableBlocker[] {
  const blockers: GrowthEnableBlocker[] = [];
  if (value.countries.length === 0) blockers.push("countries");
  if (!value.acknowledgements.taxReporting || !value.acknowledgements.sanctionsScreening) blockers.push("acknowledgements");
  const reward = BigInt(value.inviterRewardAtoms);
  if (reward <= BigInt(0)) blockers.push("reward");
  if (BigInt(value.minDepositAtoms) <= BigInt(0)) blockers.push("minimum-deposit");
  if (BigInt(value.budgetAtoms) < reward || BigInt(value.budgetAtoms) <= BigInt(0)) blockers.push("budget");
  if (value.termsText.trim() === "") blockers.push("terms");
  if (value.payoutAccount === null) blockers.push("payout-account");
  return blockers;
}

export function parseGrowthSettings(value: unknown): GrowthSettings | null {
  const result = growthSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseGrowthSettingsWrite(value: unknown): GrowthSettings | null {
  const parsed = parseGrowthSettings(value);
  if (!parsed) return null;
  return parsed.enabled && growthEnableBlockers(parsed).length > 0 ? null : parsed;
}

export function growthProgramActive(value: GrowthSettings, at: Date): boolean {
  if (!value.enabled) return false;
  if (value.startsAt !== null && at.getTime() < Date.parse(value.startsAt)) return false;
  if (value.endsAt !== null && at.getTime() >= Date.parse(value.endsAt)) return false;
  return true;
}
