import "server-only";

import { readDatabaseUrl } from "@/server/config/env";

import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { cache } from "react";
import { getSqlExecutor } from "@/server/db/sql";
import { BRAND_DEFAULTS, BRAND_SETTINGS_DOMAIN, deriveBrandTokens, parseBrandSettings, type BrandSettings } from "@/shared/operator-branding/contract";
import { brandCopyName } from "@/shared/operator-branding/theme";
import { OperatorSettingsStore } from "./store";

type BrandStore = Pick<OperatorSettingsStore, "read">;
export type BrandResolution = { settings: BrandSettings; tokens: ReturnType<typeof deriveBrandTokens>; source: "stored" | "default" | "fallback" };

export const BRAND_CACHE_TAG = "operator-brand";
const BRAND_READ_DEADLINE_MS = 750;
const BRAND_READ_LIFE = { stale: 300, revalidate: 60, expire: 3600 } as const;
const BRAND_RETRY_LIFE = { stale: 300, revalidate: 5, expire: 3600 } as const;

async function readCachedBrandEntry(): Promise<{ value: unknown; source: "stored" | "default" } | null> {
  "use cache";
  cacheTag(BRAND_CACHE_TAG);
  if (!readDatabaseUrl()) {
    cacheLife(BRAND_RETRY_LIFE);
    return null;
  }
  try {
    const { settings } = await new OperatorSettingsStore(getSqlExecutor()).read(BRAND_SETTINGS_DOMAIN, { timeoutMs: BRAND_READ_DEADLINE_MS });
    cacheLife(BRAND_READ_LIFE);
    return { value: settings.value, source: settings.source };
  } catch {
    cacheLife(BRAND_RETRY_LIFE);
    return null;
  }
}

export function invalidateBrand(): void {
  revalidateTag(BRAND_CACHE_TAG, { expire: 0 });
}

export const resolveBrand = cache(async (deps: { store?: () => BrandStore } = {}): Promise<BrandResolution> => {
  try {
    const entry = deps.store ? (await deps.store().read(BRAND_SETTINGS_DOMAIN)).settings : await readCachedBrandEntry();
    if (entry === null) throw new Error("Brand settings unavailable");
    const settings = parseBrandSettings(entry.value);
    if (settings === null) throw new Error("Invalid brand settings");
    return { settings, tokens: deriveBrandTokens(settings), source: entry.source };
  } catch {
    return { settings: BRAND_DEFAULTS, tokens: deriveBrandTokens(BRAND_DEFAULTS), source: "fallback" };
  }
});

export async function brandedPageTitle(destination: string): Promise<{ absolute: string }> {
  const { settings } = await resolveBrand();
  return { absolute: `${destination} · ${brandCopyName(settings.displayName)}` };
}
