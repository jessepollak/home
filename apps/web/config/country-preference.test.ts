import { describe, expect, test } from "bun:test";
import {
  anonymousCountryPreferenceKey,
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
      const storage = { getItem: () => stored };
      expect(readAnonymousCountryPreference(() => storage)).toBe(expected);
    }
  });

  test("rejects unknown and held persisted values", () => {
    for (const stored of ["ZZ", "TZ", "UG", "TH"]) {
      const storage = { getItem: () => stored };
      expect(readAnonymousCountryPreference(() => storage)).toBeNull();
    }
  });

  test("writes explicit selections using the versioned key", () => {
    const writes: Array<[string, string]> = [];
    const storage = {
      setItem: (key: string, value: string) => writes.push([key, value]),
    };

    expect(writeAnonymousCountryPreference(() => storage, "ID")).toBe(true);
    expect(writeAnonymousCountryPreference(() => storage, "FR")).toBe(true);
    // oxlint-disable-next-line home/no-self-referential-expectation -- writes must target the canonical versioned storage key
    expect(writes).toEqual([
      [anonymousCountryPreferenceKey, "ID"],
      [anonymousCountryPreferenceKey, "FR"],
    ]);
  });

  test("fails closed when storage methods are unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readAnonymousCountryPreference(() => storage)).toBeNull();
    expect(writeAnonymousCountryPreference(() => storage, "US")).toBe(false);
  });

  test("fails closed when acquiring storage throws", () => {
    const getStorage = () => {
      throw new DOMException("Storage access blocked by policy", "SecurityError");
    };

    expect(readAnonymousCountryPreference(getStorage)).toBeNull();
    expect(writeAnonymousCountryPreference(getStorage, "US")).toBe(false);
  });
});
