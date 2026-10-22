import { regionIds } from "@/config/regions";
import { isOfferedDisplayCurrency, type PresentationScope } from "@/shared/account/display-currency";

export function parseBalancesScope(region: unknown, currencyKey: unknown): PresentationScope | null {
  const requestedRegion = regionIds.find((candidate) => candidate === region);
  if (!requestedRegion) return null;
  if (currencyKey === "none") return requestedRegion === "GLOBAL" ? { region: requestedRegion, currency: null } : null;
  return isOfferedDisplayCurrency(currencyKey) ? { region: requestedRegion, currency: currencyKey } : null;
}
