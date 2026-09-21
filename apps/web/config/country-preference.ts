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
  } catch { // oxlint-disable-line home/no-silent-catch -- unavailable browser storage is represented by the preference contract's null result
    return null;
  }
}

export function writeAnonymousCountryPreference(
  getStorage: PreferenceStorageGetter<"setItem">,
  regionId: RegionId,
): boolean {
  let written = false;
  try {
    getStorage().setItem(anonymousCountryPreferenceKey, regionId);
    written = true;
  } catch {
    written = false;
  }
  return written;
}
