import { expect, test } from "bun:test";
import { requireAddress } from "@/shared/chain/hex";
import { GROWTH_SETTINGS_DEFAULTS, growthEnableBlockers, growthProgramActive, parseGrowthSettings, parseGrowthSettingsWrite, type GrowthEnableBlocker, type GrowthSettings } from "./growth";

const enabled: GrowthSettings = {
  ...GROWTH_SETTINGS_DEFAULTS,
  enabled: true,
  countries: ["US"],
  acknowledgements: { taxReporting: true, sanctionsScreening: true },
  inviterRewardAtoms: "5000000",
  minDepositAtoms: "25000000",
  budgetAtoms: "100000000",
  termsText: "Save and hold for 30 days.",
  payoutAccount: requireAddress("0x1111111111111111111111111111111111111111"),
};

test("growth defaults parse while incomplete stored programs remain readable", () => {
  expect(parseGrowthSettings(GROWTH_SETTINGS_DEFAULTS)).toEqual({
    enabled: false, countries: [], acknowledgements: { taxReporting: false, sanctionsScreening: false },
    inviterRewardAtoms: "0", minDepositAtoms: "25000000", holdDays: 30, perInviterCap: 10,
    budgetAtoms: "0", startsAt: null, endsAt: null, termsText: "", payoutAccount: null,
  });
  expect(parseGrowthSettingsWrite(GROWTH_SETTINGS_DEFAULTS)).not.toBeNull();
  expect(parseGrowthSettings({ ...GROWTH_SETTINGS_DEFAULTS, enabled: true })).not.toBeNull();
  expect(parseGrowthSettingsWrite({ ...GROWTH_SETTINGS_DEFAULTS, enabled: true })).toBeNull();
  expect(growthEnableBlockers(GROWTH_SETTINGS_DEFAULTS)).toEqual(["countries", "acknowledgements", "reward", "budget", "terms", "payout-account"]);
  expect(parseGrowthSettingsWrite(enabled)).toEqual(enabled);
});

test.each([
  ["countries", { countries: [] }],
  ["acknowledgements", { acknowledgements: { taxReporting: false, sanctionsScreening: true } }],
  ["acknowledgements", { acknowledgements: { taxReporting: true, sanctionsScreening: false } }],
  ["reward", { inviterRewardAtoms: "0" }],
  ["minimum-deposit", { minDepositAtoms: "0" }],
  ["budget", { budgetAtoms: "4999999" }],
  ["budget", { budgetAtoms: "0" }],
  ["terms", { termsText: " \n\t " }],
  ["payout-account", { payoutAccount: null }],
] satisfies [GrowthEnableBlocker, Partial<GrowthSettings>][])("growth enable gate rejects missing %s", (blocker, patch) => {
  const value = { ...enabled, ...patch };
  expect(growthEnableBlockers(value)).toContain(blocker);
  expect(parseGrowthSettingsWrite(value)).toBeNull();
  expect(parseGrowthSettingsWrite({ ...value, enabled: false })).not.toBeNull();
});

test("growth settings reject malformed, unbounded and noncatalog values", () => {
  for (const patch of [
    { countries: ["ZZ"] }, { countries: ["GLOBAL"] }, { countries: ["us"] }, { countries: ["US", "US"] },
    { startsAt: "2026-10-02T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" },
    { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" },
    { startsAt: "2026-10-01" }, { endsAt: "invalid" },
    { holdDays: 0 }, { holdDays: 366 }, { holdDays: 1.5 },
    { perInviterCap: 0 }, { perInviterCap: 1001 }, { perInviterCap: 1.5 },
    { termsText: "a".repeat(8001) }, { termsText: "terms\u0000" },
    { payoutAccount: "0x1234" }, { unknown: true },
  ]) expect(parseGrowthSettings({ ...enabled, ...patch })).toBeNull();
  for (const field of ["inviterRewardAtoms", "minDepositAtoms", "budgetAtoms"] as const) {
    for (const value of ["-1", "1.0", "01", "1e6", " 1", "", "1".repeat(31), 1, null]) {
      expect(parseGrowthSettings({ ...enabled, [field]: value })).toBeNull();
    }
    expect(parseGrowthSettings({ ...enabled, [field]: "9".repeat(30) })).not.toBeNull();
  }
  expect(parseGrowthSettingsWrite({ ...enabled, budgetAtoms: enabled.inviterRewardAtoms })).not.toBeNull();
  expect(parseGrowthSettings({ ...enabled, holdDays: 1, perInviterCap: 1000 })).not.toBeNull();
  expect(parseGrowthSettings({ ...enabled, holdDays: 365, perInviterCap: 1 })).not.toBeNull();
});

test("growth country order is canonical and the active window is start-inclusive and end-exclusive", () => {
  const value = { ...enabled, countries: ["US", "GB", "AR"], startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" } satisfies GrowthSettings;
  expect(parseGrowthSettings(value)?.countries).toEqual(["AR", "GB", "US"]);
  for (const [at, active] of [
    ["2026-09-30T23:59:59.999Z", false], [value.startsAt, true],
    ["2026-10-31T23:59:59.999Z", true], [value.endsAt, false],
  ] as const) expect(growthProgramActive(value, new Date(at))).toBe(active);
  expect(growthProgramActive({ ...value, enabled: false }, new Date(value.startsAt))).toBe(false);
  expect(growthProgramActive(enabled, new Date(value.startsAt))).toBe(true);
});
