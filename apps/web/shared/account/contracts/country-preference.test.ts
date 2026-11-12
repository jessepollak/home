import { expect, test } from "bun:test";
import {
  parseCountryPreferenceRequest,
  parseCountryPreferenceResponse,
  parseCountryPreferenceReadResponse,
} from "./country-preference";

const version = 2 as const;

test("preference requests accept independent or combined choices and strip unrelated owner fields", () => {
  for (const fields of [{ regionId: "US" }, { displayCurrency: "USD" }, { displayCurrency: "country-default" }, { regionId: "BR", displayCurrency: "EUR" }] as const) {
    for (const adopt of [true, false, undefined]) {
      const body = { version, ...fields, ...(adopt === undefined ? {} : { adopt }) };
      expect(parseCountryPreferenceRequest({ ...body, customerId: "another-owner", subject: "another-session" })).toEqual(body);
    }
  }
  expect(parseCountryPreferenceRequest({ version, regionId: " us " })).toEqual({ version, regionId: "US" });
});

test("preference requests reject missing choices, unsupported currencies, malformed countries and versions", () => {
  for (const value of [null, [], {}, { version }, { version, adopt: true }, { regionId: "US" },
    { version: 1, regionId: "US" }, ...[null, "GLOBAL", "XX", 1, ""].map((regionId) => ({ version, regionId })),
    ...[null, "ZZZ", "usd", "US", "USDC", 1].map((displayCurrency) => ({ version, displayCurrency })),
    ...[null, 1, "true"].map((adopt) => ({ version, displayCurrency: "USD", adopt })),
    { version, regionId: "US", displayCurrency: "ZZZ" }]) {
    expect(parseCountryPreferenceRequest(value)).toBeNull();
  }
});

test("read and write responses retain unset, explicit default and withdrawn stored choices", () => {
  for (const parse of [parseCountryPreferenceReadResponse, parseCountryPreferenceResponse]) {
    for (const regionId of [null, "US"] as const) {
      for (const displayCurrency of [null, "country-default", "USD", "ZZZ"]) {
        const body = { version, regionId, displayCurrency };
        expect(parse({ ...body, extra: true })).toEqual(body);
      }
    }
    expect(parse({ version, regionId: " us ", displayCurrency: "EUR" })).toEqual({ version, regionId: "US", displayCurrency: "EUR" });
    for (const value of [null, [], {}, { version, regionId: null }, { version, displayCurrency: null },
      { version: 1, regionId: null, displayCurrency: null }, { version, regionId: "GLOBAL", displayCurrency: null },
      ...["usd", "US", "USDC", 1, ""].map((displayCurrency) => ({ version, regionId: null, displayCurrency }))]) {
      expect(parse(value)).toBeNull();
    }
  }
});
