import { describe, expect, test } from "bun:test";
import { normalizeRegionId, presentationRegions, presentedRegionId, resolvePresentation, type RegionOffer } from "./regions";

describe("presentation regions", () => {
  test("excludes held countries while retaining the US fallback", () => {
    for (const heldCountry of ["TZ", "UG", "TH"]) {
      expect(normalizeRegionId(heldCountry)).toBeNull();
      expect(resolvePresentation({ detectedCountry: heldCountry })).toEqual({
        region: presentationRegions.US,
        source: "fallback",
      });
    }
  });


});

describe("resolvePresentation", () => {
  test("resolves original and representative expanded country codes", () => {
    expect(resolvePresentation({ detectedCountry: "US" }).region.id).toBe("US");
    expect(resolvePresentation({ detectedCountry: "br" }).region.id).toBe("BR");
    expect(resolvePresentation({ detectedCountry: " ID " }).region.id).toBe("ID");
    expect(resolvePresentation({ detectedCountry: "fr" }).region.id).toBe("FR");
    expect(resolvePresentation({ detectedCountry: "ca" }).region.id).toBe("CA");
    expect(resolvePresentation({ detectedCountry: "tr" }).region.id).toBe("TR");
    expect(resolvePresentation({ detectedCountry: "ng" }).region.id).toBe("NG");
  });

  test("uses the US fallback for an unknown country", () => {
    const result = resolvePresentation({ detectedCountry: "ZZ" });

    expect(result.region.id).toBe("US");
    expect(result.source).toBe("fallback");
  });

  test("gives an explicit selection precedence over persisted and detected values", () => {
    const result = resolvePresentation({
      explicitCountry: "TR",
      persistedCountry: "FR",
      detectedCountry: "US",
    });

    expect(result.region.id).toBe("TR");
    expect(result.source).toBe("explicit");
  });

  test("gives a persisted anonymous selection precedence over detection", () => {
    const result = resolvePresentation({
      persistedCountry: "CA",
      detectedCountry: "US",
    });

    expect(result.region.id).toBe("CA");
    expect(result.source).toBe("persisted");
  });

  test("migrates a legacy neutral selection to detected country", () => {
    const result = resolvePresentation({
      persistedCountry: "GLOBAL",
      detectedCountry: "US",
    });

    expect(result.region.id).toBe("US");
    expect(result.source).toBe("detected");
  });

  test("ignores an invalid persisted value and continues to detection", () => {
    const result = resolvePresentation({
      persistedCountry: "ZZ",
      detectedCountry: "BR",
    });

    expect(result.region.id).toBe("BR");
    expect(result.source).toBe("detected");
  });
});

describe("operator region offer", () => {
  const offer: RegionOffer = { offered: ["BR", "GB"], defaultRegion: "GB" };
  const resolved = (input: Parameters<typeof resolvePresentation>[0]) => {
    const result = resolvePresentation(input);
    return `${result.region.id}:${result.source}`;
  };

  test.each([
    [{ explicitCountry: "BR" }, "BR:explicit"],
    [{ explicitCountry: "US", detectedCountry: "BR" }, "BR:detected"],
    [{ persistedCountry: "GB", detectedCountry: "BR" }, "GB:persisted"],
    [{ persistedCountry: "US", detectedCountry: "BR" }, "GLOBAL:fallback"],
    [{ detectedCountry: "BR" }, "BR:detected"],
    [{ detectedCountry: "US" }, "GB:fallback"],
    [{}, "GB:fallback"],
  ])("resolves %j to %s", (input, expected) => {
    expect(resolved({ ...input, offer })).toBe(expected);
  });

  test("uses Global when the default is Global or no longer offered", () => {
    expect(resolved({ detectedCountry: "US", offer: { offered: ["BR"], defaultRegion: "GLOBAL" } })).toBe("GLOBAL:fallback");
    expect(resolved({ detectedCountry: "US", offer: { offered: ["BR"], defaultRegion: "GB" } })).toBe("GLOBAL:fallback");
  });

  test("presents everything as Global when no country is offered", () => {
    const none: RegionOffer = { offered: [], defaultRegion: "GLOBAL" };
    expect(resolved({ explicitCountry: "BR", persistedCountry: "GB", detectedCountry: "US", offer: none })).toBe("GLOBAL:fallback");
    expect(resolved({ offer: none })).toBe("GLOBAL:fallback");
  });

  test("keeps legacy behaviour without an offer", () => {
    expect(resolved({ persistedCountry: "MX" })).toBe("MX:persisted");
    expect(resolved({})).toBe("US:fallback");
  });

  test("presents a removed country as Global", () => {
    expect(presentedRegionId("US", offer)).toBe("GLOBAL");
    expect(presentedRegionId("BR", offer)).toBe("BR");
  });
});
