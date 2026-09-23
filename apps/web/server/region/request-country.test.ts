import { describe, expect, test } from "bun:test";
import { resolvePresentation } from "@/config/regions";
import { readRequestCountry, requestCountryHeader } from "./request-country";

function regionForHeader(value: string | null) {
  const headers = new Headers();
  if (value !== null) headers.set(requestCountryHeader, value);
  return resolvePresentation({ detectedCountry: readRequestCountry(headers) });
}

describe("readRequestCountry", () => {
  test("maps a supported edge geolocation country to its region", () => {
    for (const [header, expected] of [
      ["US", "US"],
      ["BR", "BR"],
      ["de", "DE"],
      ["GB", "GB"],
      ["ID", "ID"],
    ] as const) {
      expect(regionForHeader(header)).toMatchObject({
        region: { id: expected },
        source: "detected",
      });
    }
  });

  test("falls back to US when geolocation is missing, unknown, or unsupported", () => {
    for (const header of [null, "", "XX", "T1", "JP", "EU", "GLOBAL"]) {
      expect(regionForHeader(header)).toMatchObject({
        region: { id: "US", currency: { code: "USD" } },
        source: "fallback",
      });
    }
  });
});
