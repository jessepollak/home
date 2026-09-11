import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { configuredGlobeCountries, locateCountries, projectCountry } from "./globe-geometry";
import { SupportedGlobe } from "./supported-globe";

describe("SupportedGlobe static-first contract", () => {
  test("server-renders a meaningful fallback without WebGL or client effects", () => {
    const markup = renderToStaticMarkup(<SupportedGlobe />);
    expect(markup).toContain('data-renderer="static"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Interactive world with illustrative money connections"');
    expect(markup).toContain("country &amp; currency profiles connected by a small illustrative route set.");
    expect(markup).toContain("Routes are not transactions, live volume, payment activity, or verified corridors.");
    expect(markup).toContain("Illustrative connections, not live activity.");
    expect(markup).toContain("Static globe and route view.");
    expect(markup).not.toContain("<h1");
    expect(markup).not.toContain("Sign in");
  });

  test("keeps every configured marker, a bounded route set, and inert roving targets in the static fallback", () => {
    const markup = renderToStaticMarkup(<SupportedGlobe />);
    for (const country of configuredGlobeCountries()) {
      expect(markup).toContain(`data-country="${country.countryCode}"`);
      expect(markup).toContain(`aria-label="${country.countryName}, ${country.currency.code}. Highlight illustrative connections."`);
    }
    expect(markup.match(/data-route=/g) ?? []).toHaveLength(12);
    expect(markup.match(/tabindex="-1"/g) ?? []).toHaveLength(configuredGlobeCountries().length);
    expect(markup).not.toContain('tabindex="0"');
    expect(markup).not.toContain("<select");
    const hidden = locateCountries(configuredGlobeCountries()).filter((country) => !projectCountry(country.longitude, country.latitude).visible);
    expect(markup.match(/<circle data-country="[^"]+"[^>]+visibility="hidden"/g) ?? []).toHaveLength(hidden.length);
  });

  test("accepts explicit profiles without changing the configured default or inventing country locations", () => {
    const markup = renderToStaticMarkup(<SupportedGlobe countries={[
      { countryCode: "MT", countryName: "Malta", currency: { code: "EUR", name: "Euro" } },
      { countryCode: "NZ", countryName: "New Zealand", currency: { code: "NZD", name: "New Zealand dollar" } },
    ]} />);
    expect(markup).toContain("2 country &amp; currency profiles");
    expect(markup).toContain('data-country="MT"');
    expect(markup).toContain('data-country="NZ"');
    expect(markup).not.toContain('data-country="US"');
    expect(renderToStaticMarkup(<SupportedGlobe countries={[]} />)).toContain("0 country &amp; currency profiles");
  });
});
