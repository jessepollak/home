import "server-only";

import { readDatabaseUrl } from "@/server/config/env";

import { cache } from "react";
import { getSqlExecutor } from "@/server/db/sql";
import { BRAND_DEFAULTS, BRAND_SETTINGS_DOMAIN, deriveBrandTokens, parseBrandSettings, type BrandSettings } from "@/shared/operator-branding/contract";
import { OperatorSettingsStore } from "./store";

type BrandStore = Pick<OperatorSettingsStore, "read">;
type BrandResolution = { settings: BrandSettings; tokens: ReturnType<typeof deriveBrandTokens>; source: "stored" | "default" | "fallback" };

/** @public root layout resolver consumed by the brand application follow-up */
export const resolveBrand = cache(async (deps: { store?: () => BrandStore } = {}): Promise<BrandResolution> => {
  try {
    if (!deps.store && !readDatabaseUrl()) throw new Error("DATABASE_URL is required");
    const entry = await (deps.store?.() ?? new OperatorSettingsStore(getSqlExecutor())).read(BRAND_SETTINGS_DOMAIN);
    const settings = parseBrandSettings(entry.settings.value);
    if (settings === null) throw new Error("Invalid brand settings");
    return { settings, tokens: deriveBrandTokens(settings), source: entry.settings.source };
  } catch {
    return { settings: BRAND_DEFAULTS, tokens: deriveBrandTokens(BRAND_DEFAULTS), source: "fallback" };
  }
});
