import { describe, expect, test } from "bun:test";
import coordinates from "@/client/landing/globe-country-coordinates.json";
import {
  coverageCountrySnapshot,
  coverageCsv,
  coverageGdpSnapshot,
  coverageHomeStatuses,
  coverageIssuerStatuses,
  coveragePortfolioStatuses,
  coverageRegistry,
  sortCoverage,
  top100ResearchedCountryCodes,
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

  test("represents exactly 100 researched countries with the corrected #539 classifications", () => {
    expect(top100ResearchedCountryCodes).toHaveLength(100);
    expect(new Set(top100ResearchedCountryCodes).size).toBe(100);
    const top100Records = coverageRegistry.filter((record) => top100ResearchedCountryCodes.includes(record.countryCode as (typeof top100ResearchedCountryCodes)[number]));
    expect(top100Records).toHaveLength(100);
    expect(top100Records.every((record) => record.issuerRoute.status !== "not-researched")).toBe(true);
    expect(Object.fromEntries(coverageIssuerStatuses.map((status) => [status, top100Records.filter((record) => record.issuerRoute.status === status).length]))).toEqual({
      documented: 39,
      conditional: 11,
      "not-found": 50,
      "not-researched": 0,
    });
    expect(Object.fromEntries(coverageIssuerStatuses.map((status) => [status, coverageRegistry.filter((record) => record.issuerRoute.status === status).length]))).toEqual({
      documented: 39,
      conditional: 12,
      "not-found": 50,
      "not-researched": 149,
    });
    expect(byCode.get("DE")?.issuerRoute).toMatchObject({
      status: "documented",
      audience: expect.stringContaining("country-specific operational eligibility remains unproven"),
    });
    expect(byCode.get("CL")?.issuerRoute.status).toBe("conditional");
    expect(byCode.get("CN")?.issuerRoute.status).toBe("not-found");
    expect(byCode.get("US")?.issuerRoute).toMatchObject({ status: "conditional", rail: "Fedwire / RTP / ACH-style wires" });
    expect(byCode.get("XK")?.issuerRoute.status).toBe("not-researched");
  });

  test("records the exact country-explicit priority portfolio without changing runtime safety", () => {
    const priority = coverageRegistry.filter((record) => record.portfolio.status === "priority");
    expect(priority).toHaveLength(33);
    expect(coverageRegistry.filter((record) => record.portfolio.status === "deferred")).toHaveLength(68);
    expect(coverageRegistry.filter((record) => record.portfolio.status === "not-scoped")).toHaveLength(149);
    for (const record of coverageRegistry) expect(coveragePortfolioStatuses).toContain(record.portfolio.status);

    const euroPriority = priority.filter((record) => record.currencyCodes.includes("EUR"));
    expect(euroPriority).toHaveLength(21);
    for (const record of euroPriority) {
      expect(record.portfolio.workstreams).toEqual([expect.objectContaining({ assetSymbol: "EURC", provider: "Coinbase", issueNumber: 294, stage: "planned", note: expect.stringContaining("country eligibility") })]);
      if (record.countryCode === "MT") {
        expect(record.issuerRoute.status).toBe("not-researched");
      } else {
        expect(record.issuerRoute.status).toBe("documented");
        expect(record.issuerRoute.rail).toContain("EURe");
      }
    }
    expect(byCode.get("MT")?.portfolio.status).toBe("priority");

    const nonEuroRoutes = priority.flatMap((record) => record.portfolio.workstreams.filter((route) => route.currencyCode !== "EUR").map((route) => `${record.countryCode}:${route.assetSymbol}:${route.provider}:${route.issueNumber}:${route.stage}`));
    expect(nonEuroRoutes).toEqual([
      "AR:wARS:Ripio:512:in-build",
      "AU:AUDD:AUDD Mint:556:blocked",
      "BR:wBRL:Ripio:512:in-build",
      "CA:CADD:Tetra Trust:551:blocked",
      "CL:wCLP:Ripio:512:blocked",
      "CO:wCOP:Ripio:512:in-build",
      "ID:IDRX:IDRX:555:in-build",
      "MX:MXNB:Juno / Bitso:552:planned",
      "MX:wMXN:Ripio:512:planned",
      "NG:cNGN:Africa Stablecoin Consortium:553:blocked",
      "PE:wPEN:Ripio:512:blocked",
      "SG:XSGD:StraitsX:557:planned",
      "ZA:ZARP:ZARP:554:blocked",
    ]);
    const workstreams = priority.flatMap((record) => record.portfolio.workstreams);
    expect(workstreams.some((route) => route.assetSymbol === "CADC")).toBe(false);
    for (const route of workstreams) {
      expect(route.issueUrl).toBe(`https://github.com/jessepollak/home/issues/${route.issueNumber}`);
      expect([294, 512, 551, 552, 553, 554, 555, 556, 557]).toContain(route.issueNumber);
    }
    expect(byCode.get("US")?.portfolio).toEqual({ status: "not-scoped", workstreams: [] });
    expect(coverageRegistry.filter((record) => record.homeRoute.status === "live")).toHaveLength(0);
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
    const header = normal.split("\n")[0];
    expect(header).toContain("portfolio_status,portfolio_route_ids,portfolio_route_currencies,portfolio_route_assets,portfolio_route_providers,portfolio_route_issue_numbers,portfolio_route_issue_urls,portfolio_route_stages");
    expect(header).toContain("quote_observed_at,quote_spread_bps,quote_fee_summary,quote_source_url");
    const mxRow = normal.split("\n").find((row) => row.startsWith("MX,Mexico,")) ?? "";
    expect(mxRow).toContain("priority,coverage:mx:mxnb:juno-bitso|coverage:mx:wmxn:ripio,MXN|MXN,MXNB|wMXN,Juno / Bitso|Ripio,552|512,https://github.com/jessepollak/home/issues/552|https://github.com/jessepollak/home/issues/512,planned|planned");
    expect(new Bun.CryptoHasher("sha256").update(normal).digest("hex")).toBe("d5a867d91e9e61f832302e64db55a12828dac7bc89eb384eaf15516f3c81ef1f");
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
