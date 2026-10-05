import * as z from "zod/mini";
import { investAssets, type InvestAsset, type InvestAssetCategory } from "@/config/invest-assets";

export const INVEST_SETTINGS_DOMAIN = "invest" as const;

export const INVEST_CATEGORIES = ["stock", "crypto", "meme"] as const satisfies readonly InvestAssetCategory[];

export type InvestSettings = z.output<typeof investSettingsSchema>;

export const INVEST_SETTINGS_DEFAULTS: InvestSettings = { hiddenCategories: [], hiddenAssets: [] };

export const INVEST_HIDE_ALL: InvestSettings = { hiddenCategories: INVEST_CATEGORIES, hiddenAssets: [] };

const configuredIds = new Set<string>(investAssets.map((asset) => asset.id));
const configuredOrder = new Map<string, number>(investAssets.map((asset, index) => [asset.id, index]));

const shapeSchema = (maxLength: number) => z.strictObject({
  hiddenCategories: z.array(z.string()).check(z.maxLength(maxLength)),
  hiddenAssets: z.array(z.string()).check(z.maxLength(maxLength)),
});
const canonicalSchema = z.transform((value: { hiddenCategories: string[]; hiddenAssets: string[] }) => ({
  hiddenCategories: INVEST_CATEGORIES.filter((category) => value.hiddenCategories.includes(category)) as readonly InvestAssetCategory[],
  hiddenAssets: [...new Set(value.hiddenAssets.filter((id) => configuredIds.has(id)))]
    .sort((a, b) => configuredOrder.get(a)! - configuredOrder.get(b)!) as readonly string[],
}));
const investSettingsSchema = z.pipe(shapeSchema(Math.max(256, configuredIds.size + INVEST_CATEGORIES.length)), canonicalSchema);
const investSettingsWriteSchema = z.pipe(shapeSchema(configuredIds.size + INVEST_CATEGORIES.length).check(
  z.refine((value) => new Set(value.hiddenCategories).size === value.hiddenCategories.length && new Set(value.hiddenAssets).size === value.hiddenAssets.length),
  z.refine((value) => value.hiddenCategories.every((category) => (INVEST_CATEGORIES as readonly string[]).includes(category))),
  z.refine((value) => value.hiddenAssets.every((id) => configuredIds.has(id))),
), canonicalSchema);

export function parseInvestSettings(value: unknown): InvestSettings | null {
  const result = investSettingsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseInvestSettingsWrite(value: unknown): InvestSettings | null {
  const result = investSettingsWriteSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function isInvestCategoryVisible(settings: InvestSettings, category: InvestAssetCategory): boolean {
  return !settings.hiddenCategories.includes(category);
}

export function isInvestAssetVisible(settings: InvestSettings, asset: Pick<InvestAsset, "id" | "category">): boolean {
  return isInvestCategoryVisible(settings, asset.category) && !settings.hiddenAssets.includes(asset.id);
}
