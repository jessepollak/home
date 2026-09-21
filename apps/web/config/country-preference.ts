import { normalizeRegionId, type RegionId } from "./regions";

export const anonymousCountryPreferenceKey = "home.country.v1";

export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export type PreferenceStorageGetter<
  Method extends keyof PreferenceStorage = keyof PreferenceStorage,
> = () => Pick<PreferenceStorage, Method>;

export function readAnonymousCountryPreference(
  getStorage: PreferenceStorageGetter<"getItem">,
): RegionId | null {
  try {
    return normalizeRegionId(getStorage().getItem(anonymousCountryPreferenceKey));
  } catch {
    return null;
  }
}

export function writeAnonymousCountryPreference(
  getStorage: PreferenceStorageGetter<"setItem">,
  regionId: RegionId,
): boolean {
  try {
    getStorage().setItem(anonymousCountryPreferenceKey, regionId);
    return true;
  } catch {
    return false;
  }
}
