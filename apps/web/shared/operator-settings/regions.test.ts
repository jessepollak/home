import { describe, expect, test } from "bun:test";
import { countryRegionIds } from "@/config/regions";
import { parseRegionSettings, parseRegionSettingsWrite, REGION_SETTINGS_DEFAULTS } from "./regions";

describe("region settings contract", () => {
  test("defaults keep today's catalog and United States fallback", () => {
    expect(REGION_SETTINGS_DEFAULTS).toEqual({ offered: [...countryRegionIds], defaultRegion: "US" });
    expect(parseRegionSettingsWrite({ offered: [...countryRegionIds], defaultRegion: "US" })).toEqual({ offered: [...countryRegionIds], defaultRegion: "US" });
  });

  test("normalizes offered countries to catalog order", () => {
    expect(parseRegionSettingsWrite({ offered: ["US", "BR"], defaultRegion: "BR" })).toEqual({ offered: ["BR", "US"], defaultRegion: "BR" });
    expect(parseRegionSettingsWrite({ offered: [], defaultRegion: "GLOBAL" })).toEqual({ offered: [], defaultRegion: "GLOBAL" });
  });

  test.each([
    [{ offered: ["BR"], defaultRegion: "US" }],
    [{ offered: ["BR", "BR"], defaultRegion: "BR" }],
    [{ offered: ["br"], defaultRegion: "GLOBAL" }],
    [{ offered: [1], defaultRegion: "GLOBAL" }],
    [{ offered: "BR", defaultRegion: "GLOBAL" }],
    [{ offered: ["BR"] }],
    [{ offered: ["BR"], defaultRegion: "BR", extra: true }],
    [{ offered: ["BR"], defaultRegion: "global" }],
    [{ offered: Array.from({ length: 301 }, () => "BR"), defaultRegion: "GLOBAL" }],
    [null],
  ])("rejects malformed settings %#", (value) => {
    expect(parseRegionSettings(value)).toBeNull();
    expect(parseRegionSettingsWrite(value)).toBeNull();
  });

  test("writes reject countries Home does not know", () => {
    expect(parseRegionSettingsWrite({ offered: ["BR", "TZ"], defaultRegion: "BR" })).toBeNull();
    expect(parseRegionSettingsWrite({ offered: ["BR"], defaultRegion: "TZ" })).toBeNull();
  });

  test("reads tolerate countries removed from Home's catalog after an update", () => {
    expect(parseRegionSettings({ offered: ["BR", "TZ"], defaultRegion: "BR" })).toEqual({ offered: ["BR"], defaultRegion: "BR" });
    expect(parseRegionSettings({ offered: ["BR", "TZ"], defaultRegion: "TZ" })).toEqual({ offered: ["BR"], defaultRegion: "GLOBAL" });
  });
});
