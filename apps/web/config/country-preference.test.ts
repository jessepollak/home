import { describe, expect, test } from "bun:test";
import {
  anonymousCountryPreferenceKey,
  legacyCountryPreferenceKey,
  readAnonymousCountryPreference,
  writeAnonymousCountryPreference,
} from "./country-preference";

describe("anonymous country preference", () => {
  test("reads original and expanded supported persisted overrides", () => {
    for (const [stored, expected] of [
      ["global", "GLOBAL"],
      ["us", "US"],
      ["br", "BR"],
      ["id", "ID"],
      ["fr", "FR"],
      ["ca", "CA"],
      ["tr", "TR"],
    ] as const) {
      const storage = { getItem: (key: string) => key === anonymousCountryPreferenceKey ? stored : null };
      expect(readAnonymousCountryPreference(() => storage)).toEqual({ country: expected, explicit: true });
    }
  });

  test("rejects unknown and held persisted values", () => {
    for (const stored of ["ZZ", "TZ", "UG", "TH"]) {
      const storage = { getItem: () => stored };
      expect(readAnonymousCountryPreference(() => storage)).toEqual({ country: null, explicit: false });
    }
  });

  test("writes explicit selections using the versioned key", () => {
    const writes: Array<[string, string]> = [];
    const removed: string[] = [];
    const storage = {
      setItem: (key: string, value: string) => writes.push([key, value]),
      removeItem: (key: string) => removed.push(key),
    };

    expect(writeAnonymousCountryPreference(() => storage, "ID")).toBe(true);
    expect(writeAnonymousCountryPreference(() => storage, "FR")).toBe(true);
    expect(removed).toEqual(["home.country.v1", "home.country.v1"]);
    expect(writes).toEqual([
      ["home.country.v2", "ID"],
      ["home.country.v2", "FR"],
    ]);
  });

  test("legacy values display but are not explicit, while v2 takes precedence", () => {
    const values = new Map([[legacyCountryPreferenceKey, "GB"]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null };
    expect(readAnonymousCountryPreference(() => storage)).toEqual({ country: "GB", explicit: false });
    values.set(anonymousCountryPreferenceKey, "FR");
    expect(readAnonymousCountryPreference(() => storage)).toEqual({ country: "FR", explicit: true });
  });

  test("a failed legacy cleanup does not lose a saved explicit preference", () => {
    expect(writeAnonymousCountryPreference(() => ({
      setItem: () => {}, removeItem: () => { throw new Error("blocked"); },
    }), "US")).toBe(true);
  });

  test("fails closed when storage methods are unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };

    expect(readAnonymousCountryPreference(() => storage)).toEqual({ country: null, explicit: false });
    expect(writeAnonymousCountryPreference(() => storage, "US")).toBe(false);
  });

  test("fails closed when acquiring storage throws", () => {
    const getStorage = () => {
      throw new DOMException("Storage access blocked by policy", "SecurityError");
    };

    expect(readAnonymousCountryPreference(getStorage)).toEqual({ country: null, explicit: false });
    expect(writeAnonymousCountryPreference(getStorage, "US")).toBe(false);
  });
});
