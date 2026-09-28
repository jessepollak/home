import { describe, expect, test } from "bun:test";
import { BRAND_DEFAULTS, brandSettingsPutRequest, contrastRatio, deriveBrandTokens, parseBrandSettings, parseBrandSettingsResponse } from "./contract";

const WCAG_AA_NORMAL_TEXT = 4.5;

const valid = { displayName: "home", description: "A home for money", primaryColor: "#0052ff", backgroundColor: "#ffffff" };

describe("brand settings validation", () => {
  test.each([
    [{ ...valid, displayName: "a".repeat(40) }, true],
    [{ ...valid, displayName: "a".repeat(41) }, false],
    [{ ...valid, description: "a".repeat(160) }, true],
    [{ ...valid, description: "a".repeat(161) }, false],
    [{ ...valid, displayName: "😀".repeat(40), description: "🦊".repeat(160) }, true],
    [{ ...valid, displayName: "😀".repeat(41) }, false],
    [{ ...valid, description: "🦊".repeat(161) }, false],
    [{ ...valid, displayName: "" }, false], [{ ...valid, description: "" }, false],
    [{ ...valid, displayName: " home" }, false], [{ ...valid, description: "home " }, false],
    [{ ...valid, displayName: "a\u0000b" }, false], [{ ...valid, description: "a\u0085b" }, false],
    [{ ...valid, displayName: "a\u202eb" }, false], [{ ...valid, description: "a\u2066b" }, false],
    [{ ...valid, displayName: "a\u200fb" }, false], [{ ...valid, displayName: "a\u200eb" }, false], [{ ...valid, description: "a\u061cb" }, false],
    [{ ...valid, extra: 1 }, false], [{ displayName: "home", description: "A home for money", primaryColor: "#0052ff" }, false],
    [null, false], [[], false], ["home", false], [new Date(), false],
    [{ ...valid, primaryColor: "#0052FF" }, false], [{ ...valid, primaryColor: "#05f" }, false],
    [{ ...valid, backgroundColor: "#ffffff00" }, false], [{ ...valid, backgroundColor: "white" }, false],
    [{ ...valid, backgroundColor: "rgb(255,255,255)" }, false],
  ])("accepts only exact canonical brand values %#", (input, expected) => {
    expect(parseBrandSettings(input) !== null).toBe(expected);
  });

  test("compile-time defaults and derived foregrounds match the shipped light theme", () => {
    expect(BRAND_DEFAULTS).toEqual({ displayName: "home", description: "An open-source home for your money on Base.", primaryColor: "#0052ff", backgroundColor: "#ffffff" });
    expect(deriveBrandTokens(BRAND_DEFAULTS)).toEqual({ primaryForeground: "#ffffff", backgroundForeground: "#000000" });
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1);
  });

  test("every sampled RGB color chooses a foreground meeting WCAG AA contrast", () => {
    for (let red = 0; red < 256; red += 17) for (let green = 0; green < 256; green += 17) for (let blue = 0; blue < 256; blue += 17) {
      const color = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
      const tokens = deriveBrandTokens({ ...valid, primaryColor: color, backgroundColor: color });
      expect(contrastRatio(color, tokens.primaryForeground)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      expect(contrastRatio(color, tokens.backgroundForeground)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
  });
});

test("brand response parser validates domain, envelope and stored value; PUT helper uses existing request shape", () => {
  const entry = { version: 1, domain: "brand", settings: { value: valid, revision: 1, source: "stored", updatedAt: null, updatedBy: null } };
  expect(parseBrandSettingsResponse(entry)?.settings.value).toEqual(valid);
  expect(parseBrandSettingsResponse(entry)?.domain).toBe("brand");
  expect(parseBrandSettingsResponse({ ...entry, domain: "support" })).toBeNull();
  expect(parseBrandSettingsResponse({ ...entry, version: 2 })).toBeNull();
  expect(parseBrandSettingsResponse({ ...entry, settings: { ...entry.settings, value: { ...valid, extra: true } } })).toBeNull();
  expect(parseBrandSettingsResponse({ ...entry, settings: { ...entry.settings, revision: -1 } })).toBeNull();
  expect(brandSettingsPutRequest(2, valid)).toEqual({ version: 1, expectedRevision: 2, value: valid });
});
