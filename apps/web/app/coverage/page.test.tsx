import "@/client/account/dom-test-harness";

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

  test("keeps five columns and renders only accessible traffic-light triggers in status cells", async () => {
    const html = await renderCoverage({ q: "United States" });
    expect(html).toContain("data-slot=\"table\"");
    expect(html).toMatch(/<th[^>]+scope="col">Country<\/th>/);
    expect(html).toContain(">Currency</th>");
    expect(html).toContain(">Candidate asset</th>");
    expect(html).toContain(">Issuer route</th>");
    expect(html).toContain(">Home route</th>");
    expect(html).not.toContain(">GDP (2024)</th>");
    expect(html).toMatch(/aria-hidden="true"[^>]*>🇺🇸<\/span>/);

    const row = html.match(/<tr[^>]+id="country-US"[\s\S]*?<\/tr>/)?.[0] ?? "";
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
    const visibleText = (cell: string) => cell.replace(/<[^>]+>/g, "");
    expect(visibleText(cells[2] ?? "")).toBe("Yellow");
    expect(visibleText(cells[3] ?? "")).toBe("Yellow");
    expect(cells[2]).toContain("<button type=\"button\"");
    expect(cells[2]).toContain("aria-label=\"Yellow — Conditional issuer route\"");
    expect(cells[2]).toContain("data-indicator=\"solid\"");
    expect(cells[3]).toContain("aria-label=\"Yellow — Sandbox Home route\"");
    expect(row).not.toContain("<details");
    expect(row).not.toContain("Evidence checked");
    expect(row).not.toContain("Registry checked");
    expect(row).not.toContain("2026-09");
    expect(row).not.toContain("base:usdc");
    expect(row).not.toContain("Quote observation");
  });

  test("maps researched and absent routes without presenting unknown coverage as unavailable", async () => {
    const documented = await renderCoverage({ q: "Indonesia" });
    const documentedRow = documented.match(/<tr[^>]+id="country-ID"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(documentedRow).toContain("aria-label=\"Green — Documented issuer route\"");
    expect(documentedRow).toContain("aria-label=\"Yellow — In build Home route\"");

    const unknown = await renderCoverage({ q: "China" });
    const unknownRow = unknown.match(/<tr[^>]+id="country-CN"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(unknownRow).toContain("aria-label=\"Yellow — Not researched issuer route\"");
    expect(unknownRow).toContain("data-indicator=\"hollow\"");
    expect(unknownRow).toContain("aria-label=\"Red — No Home route\"");
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
