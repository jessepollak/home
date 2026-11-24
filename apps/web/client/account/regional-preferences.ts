import type { RegionId } from "@/config/regions";
import { resolveDisplayCurrency } from "@/shared/account/display-currency";

type RegionalPreferences = { country: RegionId; displayCurrency: string | null };

export function resolvedRegionalCurrency(current: RegionalPreferences) {
  return resolveDisplayCurrency(current.country, current.displayCurrency);
}
