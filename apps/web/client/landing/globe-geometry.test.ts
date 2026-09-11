import { describe, expect, test } from "bun:test";
import { presentationRegions, regionIds } from "@/config/regions";
import coordinates from "./globe-country-coordinates.json";
import land from "./globe-land-points.json";
import {
  configureGlobeRoutes, configuredGlobeCountries, countryFlag, geographicVector, INITIAL_LONGITUDE,
  locateCountries, POPOVER_MIN_DWELL_MS, projectCountry, projectGlobeRoute, selectGlobePopoverCountry,
  shouldAnimateGlobe, type GlobeCountry, type GlobePoint,
} from "./globe-geometry";

const profile = (countryCode: string): GlobeCountry => ({
  countryCode, countryName: countryCode, currency: { code: "EUR", name: "Euro" },
});

describe("sourced globe geography", () => {
  test("places every configured non-neutral country, automatically following expansion", () => {
    const countries = configuredGlobeCountries();
    const expected = regionIds.filter((id) => presentationRegions[id].countryCode !== null);
    expect(countries.map((country) => country.countryCode)).toEqual(expected);
    expect(locateCountries(countries)).toHaveLength(expected.length);
    expect(countries.some((country) => country.countryCode === "GLOBAL")).toBe(false);
    for (const country of countries) {
      expect(country.currency).toEqual(presentationRegions[country.countryCode as keyof typeof presentationRegions].currency);
    }
  });

  test("covers all euro-area members, including islands and the 2026 Bulgarian profile", () => {
    const euroArea = "AT BE BG HR CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES".split(" ");
    expect(locateCountries(euroArea.map(profile))).toHaveLength(euroArea.length);
    expect(coordinates.MT[0]).toBeCloseTo(14.433, 3);
    expect(coordinates.CY[1]).toBeCloseTo(34.913, 3);
    expect(coordinates.FR[0]).toBeCloseTo(2.552, 3); // Not Clipperton Island.
    expect(coordinates.BR[1]).toBeCloseTo(-12.099, 3); // Not disputed Brazilian Island.
    expect(coordinates.AU[0]).toBeGreaterThan(120); // Mainland, not Indian Ocean territories.
  });

  test("uses valid coordinates throughout, with no arbitrary country dot placement", () => {
    expect(Object.keys(coordinates).length).toBeGreaterThan(230);
    for (const [code, [longitude, latitude]] of Object.entries(coordinates)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(longitude).toBeGreaterThanOrEqual(-180);
      expect(longitude).toBeLessThanOrEqual(180);
      expect(latitude).toBeGreaterThanOrEqual(-90);
      expect(latitude).toBeLessThanOrEqual(90);
    }
    expect(locateCountries([profile("DE"), profile("de"), profile("GLOBAL"), profile("ZZ")])).toHaveLength(1);
  });

  test("preserves antimeridian and polar continuity on a unit sphere", () => {
    const east = geographicVector(180, 0);
    const west = geographicVector(-180, 0);
    east.forEach((value, i) => expect(value).toBeCloseTo(west[i], 8));
    expect(geographicVector(40, 90)[1]).toBe(1);
    for (let i = 0; i < land.length; i += 2) {
      const vector = geographicVector(land[i], land[i + 1]);
      expect(Math.hypot(...vector)).toBeCloseTo(1, 8);
    }
  });

  test("shows the front, hides the far side and limb, and reveals every profile as the world turns", () => {
    expect(projectCountry(-28, 12).visible).toBe(true);
    expect(projectCountry(152, -12).visible).toBe(false);
    expect(projectCountry(62, 0).visible).toBe(false);
    for (const point of locateCountries(configuredGlobeCountries())) {
      expect(projectCountry(point.longitude, point.latitude, point.longitude).visible).toBe(true);
      expect(projectCountry(point.longitude, point.latitude, point.longitude + 180).visible).toBe(false);
    }
  });

  test("keeps illustrative routes curated, bounded, phased, and front-face culled", () => {
    const points = locateCountries(configuredGlobeCountries());
    const routes = configureGlobeRoutes(points);
    expect(routes).toHaveLength(12);
    expect(new Set(routes.map((route) => route.id)).size).toBe(routes.length);
    expect(routes.every((route) => points.includes(route.from) && points.includes(route.to))).toBe(true);
    expect(routes.map((route) => route.phase)).toEqual(routes.map((_, index) => index / routes.length));

    const route = routes.find((candidate) => candidate.id === "US-GB")!;
    const front = projectGlobeRoute(route, INITIAL_LONGITUDE, 0.94);
    expect(front.path).not.toBe("");
    expect(front.path.match(/[ML]/g)?.length).toBeLessThanOrEqual(21);
    for (const coordinate of front.path.match(/-?\d+\.\d+/g)?.map(Number) ?? []) {
      expect(coordinate).toBeGreaterThanOrEqual(0);
      expect(coordinate).toBeLessThanOrEqual(100);
    }
    expect(front.pulse.visible).toBe(true);
    expect(front.arrivalProgress).toBeCloseTo(0.5, 8);
    expect(projectGlobeRoute(route, INITIAL_LONGITUDE + 180).path).toBe("");
  });
});

describe("globe motion policy", () => {
  test("selects one central sourced profile with dwell hysteresis and an ISO flag", () => {
    const points: GlobePoint[] = [
      { ...profile("AA"), longitude: 0, latitude: 12 },
      { ...profile("BB"), longitude: 10, latitude: 12 },
    ];
    expect(selectGlobePopoverCountry(points, 0)?.country.countryCode).toBe("AA");
    expect(
      selectGlobePopoverCountry(points, 9, "AA", POPOVER_MIN_DWELL_MS - 1)
        ?.country.countryCode,
    ).toBe("AA");
    expect(
      selectGlobePopoverCountry(points, 9, "AA", POPOVER_MIN_DWELL_MS)
        ?.country.countryCode,
    ).toBe("BB");
    expect(countryFlag("US")).toBe("🇺🇸");
    expect(countryFlag("GLOBAL")).toBe("");
  });

  test("reduced motion is static by default, with explicit opt-in; manual pause always wins", () => {
    expect(shouldAnimateGlobe(true, null)).toBe(false);
    expect(shouldAnimateGlobe(false, null)).toBe(true);
    expect(shouldAnimateGlobe(true, true)).toBe(true);
    expect(shouldAnimateGlobe(false, false)).toBe(false);
    expect(shouldAnimateGlobe(true, false)).toBe(false);
  });
});
