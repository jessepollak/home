import * as z from "zod/mini";
import type { RegionId } from "@/config/regions";
import type { HomeBalancesPresentation } from "@/shared/balances/present";
import { isSafeQueryIdentity, ownerQueryCacheTtlMs, ownerQueryStorageKey } from "./query-client";

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
      z.object({ kind: z.literal("none") }), z.object({ kind: z.literal("unavailable") }),
      z.object({ ...amount, kind: z.literal("position"), rate: z.nullable(text),
        debts: z.array(z.object({ marketId: text, baseUnits: text })).check(z.maxLength(32)) }),
    ]),
  }),
});
const schema = z.object({ version: z.literal(1), owner: z.string().check(z.maxLength(200)), region: text, updatedAt: z.number(), presentation: presentationSchema });
const maxCharacters = 8 * 1024;

export function homeSummaryStorageKey(owner: string, region: RegionId): string {
  return `${ownerQueryStorageKey(owner)}:home-summary:${region}`;
}

export function readHomeSummary(storage: Pick<Storage, "getItem">, owner: string, region: RegionId, now = Date.now()): HomeBalancesPresentation | null {
  if (!isSafeQueryIdentity(owner)) return null;
  try {
    const value = storage.getItem(homeSummaryStorageKey(owner, region));
    if (!value || value.length > maxCharacters) return null;
    const parsed = schema.safeParse(JSON.parse(value));
    if (!parsed.success || parsed.data.owner !== owner || parsed.data.region !== region ||
      !Number.isFinite(parsed.data.updatedAt) || parsed.data.updatedAt <= 0 || parsed.data.updatedAt > now ||
      now - parsed.data.updatedAt > ownerQueryCacheTtlMs) return null;
    return { ...parsed.data.presentation, revalidating: true, cachedAt: parsed.data.updatedAt };
  } catch { return null; }
}

export function writeHomeSummary(storage: Pick<Storage, "setItem">, owner: string, region: RegionId, updatedAt: number, presentation: HomeBalancesPresentation): boolean {
  if (!isSafeQueryIdentity(owner) || !Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > Date.now()) return false;
  const parsed = schema.safeParse({ version: 1, owner, region, updatedAt, presentation });
  if (!parsed.success) return false;
  try {
    const value = JSON.stringify(parsed.data);
    if (value.length > maxCharacters) return false;
    storage.setItem(homeSummaryStorageKey(owner, region), value);
    return true;
  } catch { return false; }
}
