import * as z from "zod/mini";
import type { RegionId } from "@/config/regions";
import type { HomeBalancesPresentation } from "./present";
import { OWNER_SESSION_RETENTION_MS } from "@/shared/account/session-types";

const text = z.string().check(z.maxLength(160));
const status = z.enum(["complete", "partial", "unavailable"]);
const amount = { status, value: z.nullable(text) };
const count = z.number().check(z.int(), z.minimum(0), z.maximum(1_000_000));
const presentationSchema = z.object({
  status: z.literal("ready"), displayTotal: z.nullable(text), totalStatus: z.optional(status), statusLabel: z.optional(text), needsCountry: z.optional(z.literal(true)),
  breakdown: z.array(z.object({
    id: z.enum(["borrow", "cash", "pending-cash-out", "investments"]),
    label: z.enum(["Borrow", "Cash", "Pending cash-out", "Investments"]),
    value: text, weight: z.number().check(z.minimum(0)),
  })).check(z.maxLength(4)),
  summary: z.object({
    cash: z.object(amount), investments: z.object({ ...amount, assetCount: count, ownedCount: count }),
    borrow: z.union([
      z.object({ kind: z.literal("none"), hasCollateral: z.boolean() }), z.object({ kind: z.literal("unavailable") }),
      z.object({ ...amount, kind: z.literal("position"), rate: z.nullable(text),
        debts: z.array(z.object({ marketId: text, baseUnits: text })).check(z.maxLength(32)) }),
    ]),
  }),
});
const rateSchema = z.object({ value: z.nullable(text), updatedAt: z.number() });
export type HomeRateObservation = { value: string | null; updatedAt: number; pending: boolean };
export type HomeRateLabels = { cash?: { value: string | null; updatedAt: number }; borrow?: { value: string | null; updatedAt: number } };
const schema = z.object({ version: z.literal(1), owner: z.string().check(z.maxLength(200)), region: text, updatedAt: z.number(), presentation: presentationSchema, rates: z.optional(z.object({ cash: z.optional(rateSchema), borrow: z.optional(rateSchema) })) });
const maxCharacters = 8 * 1024;

export type HomeSummaryRecord = z.infer<typeof schema>;
export const homeSummaryCookieName = "home.display-summary.v1";
export function parseHomeSummaryRecord(value: string | undefined, owner: string, region: RegionId, now = Date.now()): HomeSummaryRecord | null {
  if (!value || value.length > maxCharacters) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    if (!parsed.success || parsed.data.owner !== owner || parsed.data.region !== region ||
      !Number.isFinite(parsed.data.updatedAt) || parsed.data.updatedAt <= 0 || parsed.data.updatedAt > now ||
      now - parsed.data.updatedAt > OWNER_SESSION_RETENTION_MS) return null;
    return { ...parsed.data, rates: recentHomeRates(parsed.data.rates, now) };
  } catch { return null; }
}
export function recentHomeRates(rates: HomeRateLabels | undefined, now = Date.now()): HomeRateLabels {
  const result: HomeRateLabels = {};
  for (const key of ["cash", "borrow"] as const) {
    const rate = rates?.[key];
    if (rate && Number.isFinite(rate.updatedAt) && rate.updatedAt > 0 && rate.updatedAt <= now && now - rate.updatedAt <= 5 * 60_000) result[key] = rate;
  }
  return result;
}
export function homeSummaryPresentation(record: HomeSummaryRecord): HomeBalancesPresentation {
  return { ...record.presentation, revalidating: true, cachedAt: record.updatedAt };
}
export function encodeHomeSummaryCookie(record: HomeSummaryRecord): string | null {
  const value = encodeURIComponent(JSON.stringify(record));
  return value.length <= 3_500 ? value : null;
}
export function parseHomeSummaryCookie(value: string | undefined, owner: string, region: RegionId, now = Date.now()): HomeSummaryRecord | null {
  if (!value || value.length > 3_500) return null;
  try { return parseHomeSummaryRecord(value.startsWith("{") ? value : decodeURIComponent(value), owner, region, now); } catch { return null; }
}
