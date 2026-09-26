import { normalizeRegionId, type RegionId } from "./regions";

export const anonymousCountryPreferenceKey = "home.country.v2";
export const legacyCountryPreferenceKey = "home.country.v1";

export type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PreferenceStorageGetter<
  Method extends keyof PreferenceStorage = keyof PreferenceStorage,
> = () => Pick<PreferenceStorage, Method>;

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
