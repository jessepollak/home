import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import CoveragePage, { metadata } from "./page";

async function renderCoverage(searchParams: Record<string, string> = {}) {
  const page = await CoveragePage({ searchParams: Promise.resolve(searchParams) } as never);
  return renderToStaticMarkup(page);
}

describe("public coverage page", () => {
  test("server renders the globe-led accessible inventory without removed sections", async () => {
    const html = await renderCoverage();
    expect(metadata.title).toBe("Local money coverage | Home");
    expect(html).toContain("Interactive globe of local-money coverage research");
    expect(html).toContain("Local money coverage");
    expect(html.indexOf("Interactive globe")).toBeLessThan(html.indexOf("<h1"));
    expect(html).toContain("<table");
    expect(html).toContain("<caption");
    expect(html).toContain("Showing 250 of 250 countries and territories");
    expect(html).toContain("Japan");
    expect(html).toContain("Kosovo");
    expect(html).toContain("No current tender currency");
    expect(html).toContain("United States");
    expect(html).not.toContain("Documented issuer routes");
    expect(html).not.toContain("Home routes live");
    expect(html).not.toContain("How to read status");
    expect(html).not.toContain("The 250-entry universe");
    expect(html).not.toContain("coverage-map-title");
    expect(html).not.toContain("World Bank");
    expect(html).not.toContain("<footer");
  });

  test("uses five requested columns, decorative flags, and accessible text plus tone statuses", async () => {
    const html = await renderCoverage({ q: "United States" });
    expect(html).toContain("<th scope=\"col\" class=\"p-3\">Country</th>");
    expect(html).toContain(">Currency</th>");
    expect(html).toContain(">Candidate asset</th>");
    expect(html).toContain(">Issuer route</th>");
    expect(html).toContain(">Home route</th>");
    expect(html).not.toContain(">GDP (2024)</th>");
    expect(html).toContain("aria-hidden=\"true\">🇺🇸</span>");
    expect(html).toContain("data-tone=\"caution\">Conditional</span>");
    expect(html).toContain("data-tone=\"caution\">Sandbox</span>");
    expect(html).toContain("Evidence checked");
    expect(html).toContain("Quote observation:");
  });

  test("keeps GDP as default ordering without displaying the GDP column", async () => {
    const html = await renderCoverage();
    expect(html.indexOf("United States <span")).toBeLessThan(html.indexOf("China <span"));
    expect(html).toContain("<option value=\"gdp\" selected=\"\">GDP, highest first</option>");
    expect(html).not.toContain("$11,203,038,332");
  });

  test("applies GET search, status filters, and alphabetical sorting", async () => {
    const html = await renderCoverage({ q: "rupiah", issuer: "documented", home: "in-build", sort: "alphabetical" });
    expect(html).toContain("method=\"get\"");
    expect(html).toContain("Showing 1 of 250 countries and territories");
    expect(html).toContain("Indonesia");
    expect(html).not.toContain("United States <span");
    expect(html).toContain("<option value=\"alphabetical\" selected=\"\">Alphabetical</option>");
  });
});
