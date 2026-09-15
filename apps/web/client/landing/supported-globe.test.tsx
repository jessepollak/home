import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { coverageRegistry } from "@/config/coverage";
import { SupportedGlobe } from "./supported-globe";

describe("SupportedGlobe variants", () => {
  test("preserves landing defaults and illustrative routes", () => {
    const html = renderToStaticMarkup(<SupportedGlobe />);
    expect(html).toContain('aria-label="Interactive world with illustrative money connections"');
    expect(html).toContain("39 country and currency profiles connected by a small illustrative route set");
    expect(html).toContain('data-route="US-GB"');
    expect(html).toContain('data-route="SG-ID"');
    expect(html).toContain('data-tone="default"');
  });

  test("accepts complete inventory data, marker tones, details, and no routes", () => {
    const countries = coverageRegistry.map((record) => ({
      countryCode: record.countryCode,
      countryName: record.countryName,
      currency: { code: record.currencyCodes[0] ?? null, name: "Tender currency" },
      markerTone: record.issuerRoute.status === "documented" ? "positive" as const : "neutral" as const,
      detail: record.issuerRoute.status,
    }));
    const html = renderToStaticMarkup(
      <SupportedGlobe
        countries={countries}
        showRoutes={false}
        ariaLabel="Coverage inventory"
        description="239 mapped inventory points"
        interactiveMarkerTones={["positive"]}
      />,
    );
    expect(html).toContain('aria-label="Coverage inventory"');
    expect(html).toContain("239 mapped inventory points");
    expect(html).toContain('data-tone="positive"');
    expect(html).toContain("documented");
    expect(html).not.toContain("data-route=");
    expect((html.match(/data-country=/g) ?? []).length).toBe(239);
    expect((html.match(/<button/g) ?? []).length).toBe(
      coverageRegistry.filter((record) => record.issuerRoute.status === "documented").length,
    );
  });
});
