import { describe, expect, test } from "bun:test";
import coordinates from "@/client/landing/globe-country-coordinates.json";
import {
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

describe("local money coverage registry", () => {
  test("covers every configured country once and uses its existing currency identity", () => {
    expect(coverageRegistry.map((record) => record.countryCode).sort()).toEqual([...countryRegionIds].sort());
    expect(new Set(coverageRegistry.map((record) => record.countryCode)).size).toBe(coverageRegistry.length);
    for (const record of coverageRegistry) {
      expect(presentationRegions[record.countryCode].currency.code).toBe(record.currencyCode);
      expect(coverageIssuerStatuses).toContain(record.issuerRoute.status);
      expect(coverageHomeStatuses).toContain(record.homeRoute.status);
    }
  });

  test("requires dated research evidence and hosted production proof for live claims", () => {
    for (const record of coverageRegistry) {
      if (record.issuerRoute.status !== "not-researched") {
        expect(record.issuerRoute.evidence).not.toBeNull();
        expect(record.issuerRoute.evidence?.checkedAt).toMatch(isoDate);
        expect(() => new URL(record.issuerRoute.evidence?.url ?? "")).not.toThrow();
      }
      if (record.homeRoute.status === "live") {
        expect(record.homeRoute.evidence?.environment).toBe("hosted-production");
        expect(record.homeRoute.evidence?.proofRef).toBeTruthy();
        expect(record.homeRoute.evidence?.checkedAt).toMatch(isoDate);
      } else {
        expect(record.homeRoute.evidence).toBeNull();
      }
      const quoteObservation = record.quoteObservation;
      if (quoteObservation) {
        expect(quoteObservation.quotedAt).toMatch(isoDate);
        expect(() => new URL(quoteObservation.sourceUrl)).not.toThrow();
      }
    }
    expect(coverageRegistry.filter((record) => record.homeRoute.status === "live")).toHaveLength(0);
  });

  test("has sourced Natural Earth coordinates for every registry country", () => {
    for (const record of coverageRegistry) expect(coordinates[record.countryCode]).toHaveLength(2);
    expect(Object.keys(coordinates).length).toBeGreaterThan(coverageRegistry.length);
  });

  test("sorts missing GDP figures last and preserves them", () => {
    const first = coverageRegistry[0] as CoverageRecord;
    const second = coverageRegistry[1] as CoverageRecord;
    const previousFirst = coverageGdpSnapshot.rows[first.countryCode];
    const previousSecond = coverageGdpSnapshot.rows[second.countryCode];
    coverageGdpSnapshot.rows[first.countryCode] = null;
    coverageGdpSnapshot.rows[second.countryCode] = 1;
    try {
      const sorted = sortCoverage([first, second], "gdp");
      expect(sorted.map((record) => record.countryCode)).toEqual([second.countryCode, first.countryCode]);
      expect(sorted).toHaveLength(2);
    } finally {
      coverageGdpSnapshot.rows[first.countryCode] = previousFirst;
      coverageGdpSnapshot.rows[second.countryCode] = previousSecond;
    }
  });

  test("exports deterministic alphabetical CSV from the same records", () => {
    const normal = coverageCsv();
    const reversed = coverageCsv([...coverageRegistry].reverse());
    expect(reversed).toBe(normal);
    expect(normal.endsWith("\n")).toBe(true);
    expect(normal.split("\n")).toHaveLength(coverageRegistry.length + 2);
    expect(normal.split("\n")[1]).toStartWith("AR,Argentina,ARS,");
    expect(normal).toContain('GB,United Kingdom,GBP,tGBP,BCP Technologies');
    expect(normal).not.toContain("undefined");
  });
});
