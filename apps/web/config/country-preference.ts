import { normalizeRegionId, type RegionId } from "./regions";
import { COUNTRY_DEFAULT_CURRENCY, isOfferedDisplayCurrency, type DisplayCurrencyChoice } from "@/shared/account/display-currency";

export const anonymousCountryPreferenceKey = "home.country.v2";
export const legacyCountryPreferenceKey = "home.country.v1";
export const anonymousDisplayCurrencyPreferenceKey = "home.displayCurrency.v1";

export type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PreferenceStorageGetter<
  Method extends keyof PreferenceStorage = keyof PreferenceStorage,
> = () => Pick<PreferenceStorage, Method>;

export function readAnonymousDisplayCurrencyPreference(getStorage: PreferenceStorageGetter<"getItem">) {
  try {
    const value = getStorage().getItem(anonymousDisplayCurrencyPreferenceKey);
    return isOfferedDisplayCurrency(value) ? value : null;
  } catch { return null; }
}

export function writeAnonymousDisplayCurrencyPreference(
  getStorage: PreferenceStorageGetter<"setItem" | "removeItem">,
  choice: DisplayCurrencyChoice,
): boolean {
  try {
    const storage = getStorage();
    if (choice === COUNTRY_DEFAULT_CURRENCY) storage.removeItem(anonymousDisplayCurrencyPreferenceKey);
    else storage.setItem(anonymousDisplayCurrencyPreferenceKey, choice);
    return true;
  } catch { return false; }
}

export function readAnonymousCountryPreference(
  getStorage: PreferenceStorageGetter<"getItem">,
): { country: RegionId | null; explicit: boolean } {
  try {
    const storage = getStorage();
    const explicit = normalizeRegionId(storage.getItem(anonymousCountryPreferenceKey));
    if (explicit) return { country: explicit, explicit: true };
    return { country: normalizeRegionId(storage.getItem(legacyCountryPreferenceKey)), explicit: false };
  } catch {
    return { country: null, explicit: false };
  }
}

export function writeAnonymousCountryPreference(
  getStorage: PreferenceStorageGetter<"setItem" | "removeItem">,
  regionId: RegionId,
): boolean {
  try {
    const storage = getStorage();
    storage.setItem(anonymousCountryPreferenceKey, regionId);
    try {
      storage.removeItem(legacyCountryPreferenceKey);
    } catch {
      return true;
    }
    return true;
  } catch {
    return false;
  }
}
