import { describe, expect, test } from "bun:test";
import { parseAppearancePreference, resolveAppearance } from "./preference";

describe("appearance preference", () => {
  test.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    [null, "system"],
    ["invalid", "system"],
    [false, "system"],
  ] as const)("parses %p as %s", (raw, expected) => {
    expect(parseAppearancePreference(raw)).toBe(expected);
  });

  test.each([
    ["light", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["dark", true, "dark"],
    ["system", false, "light"],
    ["system", true, "dark"],
  ] as const)("resolves %s with OS dark=%p to %s", (preference, osDark, expected) => {
    expect(resolveAppearance(preference, osDark)).toBe(expected);
  });
});
