import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import CoveragePage, { metadata } from "./page";

async function renderCoverage(searchParams: Record<string, string> = {}) {
  const page = await CoveragePage({ searchParams: Promise.resolve(searchParams) } as never);
  return renderToStaticMarkup(page);
}

describe("public coverage page", () => {
  test("server renders the complete accessible inventory and disclosures", async () => {
    const html = await renderCoverage();
    expect(metadata.title).toBe("Local money coverage | Home");
    expect(html).toContain("<h1");
    expect(html).toContain("Local money coverage");
    expect(html).toContain("<table");
    expect(html).toContain("<caption");
    expect(html).toContain("Showing 250 of 250 countries and territories");
    expect(html).toContain("Japan");
    expect(html).toContain("Kosovo");
    expect(html).toContain("No current tender currency");
    expect(html).toContain("United States");
    expect(html).toContain("Production-proven live");
    expect(html).toContain("Home routes live</dt><dd><span class=\"block text-3xl font-semibold\">0");
    expect(html).toContain("Natural Earth v5.1.2");
    expect(html).toContain("World Bank");
    expect(html).not.toContain("role=\"img\"");
    expect(html).toContain("Skip map and go to country table");
    expect(html).toContain("href=\"#coverage-table\"");
    expect(html).toContain("tabindex=\"-1\"");
    expect(html).toContain("<title id=\"coverage-map-title\"");
    expect(html).toContain("<title>United States: Conditional route</title>");
    expect(html).toContain("239 linked label points. 11 small territories");
    expect(html).toContain("39 configured in Home");
    expect(html).toContain("No Home route");
    expect(html).toContain("Country, code, currency code, or asset");
    expect(html).toContain("Issue #15 also records currency-level euro-area research");
    expect(html).toContain("$11,203,038,332");
    expect(html).not.toContain("$11,203,038,332.34");
  });

  test("applies server-side search, status filters, and alphabetical sorting", async () => {
    const html = await renderCoverage({ q: "rupiah", issuer: "documented", home: "in-build", sort: "alphabetical" });
    expect(html).toContain("Showing 1 of 250 countries and territories");
    expect(html).toContain("Indonesia");
    expect(html).not.toContain("<summary class=\"font-semibold\">United States");
    expect(html).toContain("<option value=\"alphabetical\" selected=\"\"");
  });
});
