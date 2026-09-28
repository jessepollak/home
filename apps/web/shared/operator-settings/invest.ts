import { investAssets, type InvestAsset, type InvestAssetCategory } from "@/config/invest-assets";

export const INVEST_SETTINGS_DOMAIN = "invest" as const;

export const INVEST_CATEGORIES = ["stock", "crypto", "meme"] as const satisfies readonly InvestAssetCategory[];

export type InvestSettings = {
  hiddenCategories: readonly InvestAssetCategory[];
  hiddenAssets: readonly string[];
};

export const INVEST_SETTINGS_DEFAULTS: InvestSettings = { hiddenCategories: [], hiddenAssets: [] };

export const INVEST_HIDE_ALL: InvestSettings = { hiddenCategories: INVEST_CATEGORIES, hiddenAssets: [] };

const configuredIds = new Set<string>(investAssets.map((asset) => asset.id));
const configuredOrder = new Map<string, number>(investAssets.map((asset, index) => [asset.id, index]));

function readList(value: unknown, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxLength) return null;
  return value.every((item): item is string => typeof item === "string") ? value : null;
}

function readShape(value: unknown, maxLength: number): { categories: string[]; assets: string[] } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !Object.hasOwn(value, "hiddenCategories") || !Object.hasOwn(value, "hiddenAssets")) return null;
  const record = value as Record<string, unknown>;
  const categories = readList(record.hiddenCategories, maxLength);
  const assets = readList(record.hiddenAssets, maxLength);
  return categories && assets ? { categories, assets } : null;
}

function canonical(categories: readonly string[], assets: readonly string[]): InvestSettings {
  return {
    hiddenCategories: INVEST_CATEGORIES.filter((category) => categories.includes(category)),
    hiddenAssets: [...new Set(assets)].sort((a, b) => configuredOrder.get(a)! - configuredOrder.get(b)!),
  };
}

export function parseInvestSettings(value: unknown): InvestSettings | null {
  const shape = readShape(value, Math.max(256, configuredIds.size + INVEST_CATEGORIES.length));
  if (!shape) return null;
  return canonical(
    shape.categories.filter((category) => (INVEST_CATEGORIES as readonly string[]).includes(category)),
    shape.assets.filter((id) => configuredIds.has(id)),
  );
}

export function parseInvestSettingsWrite(value: unknown): InvestSettings | null {
  const shape = readShape(value, configuredIds.size + INVEST_CATEGORIES.length);
  if (!shape) return null;
  if (new Set(shape.categories).size !== shape.categories.length || new Set(shape.assets).size !== shape.assets.length) return null;
  if (!shape.categories.every((category) => (INVEST_CATEGORIES as readonly string[]).includes(category))) return null;
  if (!shape.assets.every((id) => configuredIds.has(id))) return null;
  return canonical(shape.categories, shape.assets);
}

export function isInvestCategoryVisible(settings: InvestSettings, category: InvestAssetCategory): boolean {
  return !settings.hiddenCategories.includes(category);
}

export function isInvestAssetVisible(settings: InvestSettings, asset: Pick<InvestAsset, "id" | "category">): boolean {
  return isInvestCategoryVisible(settings, asset.category) && !settings.hiddenAssets.includes(asset.id);
}
