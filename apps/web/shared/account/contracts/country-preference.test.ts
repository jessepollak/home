import { expect, test } from "bun:test";
import {
  parseCountryPreferenceRequest,
  parseCountryPreferenceResponse,
  parseCountryPreferenceReadResponse,
} from "./country-preference";

const body = { version: 1 as const, regionId: "US" as const };

test("country preference contracts normalize countries and strip unrelated fields", () => {
  for (const parser of [parseCountryPreferenceRequest, parseCountryPreferenceResponse, parseCountryPreferenceReadResponse]) {
    expect(parser({ ...body, regionId: " us ", extra: true })).toEqual(body);
    for (const value of [null, [], {}, { regionId: "US" }, { ...body, version: 2 },
      { ...body, regionId: "GLOBAL" }, { ...body, regionId: "XX" }, { ...body, regionId: 1 },
      { ...body, regionId: undefined }, { ...body, regionId: "" }]) {
      expect(parser(value)).toBeNull();
    }
  }
});

test("only country preference reads accept null, and only requests validate optional adopt", () => {
  const empty = { ...body, regionId: null };
  expect(parseCountryPreferenceReadResponse(empty)).toEqual(empty);
  expect(parseCountryPreferenceRequest(empty)).toBeNull();
  expect(parseCountryPreferenceResponse(empty)).toBeNull();
  for (const adopt of [true, false]) {
    expect(parseCountryPreferenceRequest({ ...body, adopt })).toEqual({ ...body, adopt });
    expect(parseCountryPreferenceResponse({ ...body, adopt })).toEqual(body);
    expect(parseCountryPreferenceReadResponse({ ...body, adopt })).toEqual(body);
  }
  expect(parseCountryPreferenceRequest({ ...body, adopt: undefined })).toEqual(body);
  for (const adopt of [null, 1, "true"]) {
    expect(parseCountryPreferenceRequest({ ...body, adopt })).toBeNull();
    expect(parseCountryPreferenceResponse({ ...body, adopt })).toEqual(body);
    expect(parseCountryPreferenceReadResponse({ ...body, regionId: null, adopt })).toEqual(empty);
  }
});
