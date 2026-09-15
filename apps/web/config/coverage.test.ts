import { describe, expect, test } from "bun:test";
import coordinates from "@/client/landing/globe-country-coordinates.json";
import {
  coverageCountrySnapshot,
  coverageCsv,
  coverageGdpSnapshot,
  coverageHomeStatuses,
  coverageIssuerStatuses,
  coverageRegistry,
  sortCoverage,
  type CoverageRecord,
} from "./coverage";
import { countryRegionIds, presentationRegions } from "./regions";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const byCode = new Map(coverageRegistry.map((record) => [record.countryCode, record]));

describe("local money coverage registry", () => {
  test("declares the full global universe and overlays all configured Home countries", () => {
    expect(coverageCountrySnapshot.metadata.count).toBe(250);
    expect(coverageRegistry).toHaveLength(250);
    expect(new Set(coverageRegistry.map((record) => record.countryCode)).size).toBe(250);
    expect(coverageRegistry.filter((record) => record.configuredInHome).map((record) => record.countryCode).sort()).toEqual([...countryRegionIds].sort());
    for (const code of countryRegionIds) {
      expect(byCode.get(code)?.currencyCodes).toContain(presentationRegions[code].currency.code as string);
    }
  });

  test("preserves representative unconfigured, multi-currency, and no-tender entries", () => {
    expect(byCode.get("JP")).toMatchObject({ countryName: "Japan", currencyCodes: ["JPY"], configuredInHome: false });
    expect(byCode.get("XK")).toMatchObject({ countryName: "Kosovo", currencyCodes: ["EUR"], configuredInHome: false });
    expect(byCode.get("PS")?.currencyCodes).toEqual(["ILS", "JOD"]);
    expect(byCode.get("AQ")?.currencyCodes).toEqual([]);
  });

  test("assigns issuer research by explicit country, never by shared currency", () => {
    expect(byCode.get("US")?.issuerRoute.status).toBe("conditional");
    expect(byCode.get("EC")?.currencyCodes).toContain("USD");
    expect(byCode.get("EC")?.issuerRoute.status).toBe("not-researched");
    expect(byCode.get("DE")?.currencyCodes).toContain("EUR");
    expect(byCode.get("DE")?.issuerRoute.status).toBe("not-researched");
    expect(byCode.get("XK")?.issuerRoute.status).toBe("not-researched");
  });

  test("requires dated research evidence and hosted production proof for live claims", () => {
    for (const record of coverageRegistry) {
      expect(coverageIssuerStatuses).toContain(record.issuerRoute.status);
      expect(coverageHomeStatuses).toContain(record.homeRoute.status);
      if (record.issuerRoute.status !== "not-researched") {
        expect(record.issuerRoute.evidence?.checkedAt).toMatch(isoDate);
        expect(() => new URL(record.issuerRoute.evidence?.url ?? "")).not.toThrow();
      } else expect(record.issuerRoute.evidence).toBeNull();
      if (record.homeRoute.status === "live") {
        expect(record.homeRoute.evidence?.environment).toBe("hosted-production");
        expect(record.homeRoute.evidence?.proofRef).toBeTruthy();
        expect(record.homeRoute.evidence?.checkedAt).toMatch(isoDate);
      } else expect(record.homeRoute.evidence).toBeNull();
    }
    expect(coverageRegistry.filter((record) => record.homeRoute.status === "live")).toHaveLength(0);
  });

  test("links every Natural Earth map point to the declared inventory", () => {
    expect(Object.keys(coordinates)).toHaveLength(239);
    for (const code of Object.keys(coordinates)) expect(byCode.has(code)).toBe(true);
    expect(Object.keys(coordinates)).toContain("XK");
    expect(coordinates).not.toHaveProperty("BQ");
  });

  test("uses a complete global 2024 GDP snapshot and sorts preserved nulls last", () => {
    expect(coverageGdpSnapshot.year).toBe(2024);
    expect(Object.keys(coverageGdpSnapshot.rows)).toHaveLength(250);
    expect(coverageGdpSnapshot.completeness).toMatchObject({ universeCount: 250, valueCount: 200, percent: 80, comparison: { 2023: 203, 2025: 186 } });
    expect(coverageGdpSnapshot.rows.US).toBeGreaterThan(1_000_000_000_000);
    expect(typeof coverageGdpSnapshot.rows.XK).toBe("number");
    expect(coverageGdpSnapshot.rows.XK).toBe(11203038332.3359);
    expect(coverageGdpSnapshot.rows.TW).toBeNull();
    const known = byCode.get("US") as CoverageRecord;
    const missing = byCode.get("TW") as CoverageRecord;
    expect(sortCoverage([missing, known], "gdp").map((record) => record.countryCode)).toEqual(["US", "TW"]);
  });

  test("exports the full deterministic alphabetical CSV", () => {
    const normal = coverageCsv();
    expect(coverageCsv([...coverageRegistry].reverse())).toBe(normal);
    expect(normal.endsWith("\n")).toBe(true);
    expect(normal.split("\n")).toHaveLength(252);
    expect(normal.split("\n")[1]).toStartWith("AF,Afghanistan,AFN,false,");
    expect(normal).toContain("AQ,Antarctica,,false,");
    expect(normal).toContain("PS,Palestinian Territories,ILS|JOD,false,");
    expect(normal).toContain("XK,Kosovo,EUR,false,");
    expect(normal).not.toContain("undefined");
    expect(normal.split("\n")[0]).toContain("quote_observed_at,quote_spread_bps,quote_fee_summary,quote_source_url");
    expect(new Bun.CryptoHasher("sha256").update(normal).digest("hex")).toBe("b4e710cd3ae1d6c2b133d0c0db1a667e980f5bb8345da6d48c17ae4f65f126d4");
  });

  test("exports dated quote observations without turning them into route promises", () => {
    const observed: CoverageRecord = {
      ...coverageRegistry[0],
      quoteObservation: { quotedAt: "2026-09-15", spreadBps: 25, feeSummary: "Variable provider fee", sourceUrl: "https://example.com/quote" },
    };
    const csv = coverageCsv([observed]);
    expect(csv).toContain("2026-09-15,25,Variable provider fee,https://example.com/quote");
  });
});
