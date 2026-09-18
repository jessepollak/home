import {
  locateCountries,
  type GlobeCountry,
  type GlobeMarkerTone,
} from "@/client/landing/globe-geometry";
import {
  coverageRegistry,
  type CoverageHomeStatus,
  type CoverageIssuerStatus,
} from "@/config/coverage";
import { presentationRegions, type CountryCode } from "@/config/regions";

export const coverageOnrampLabels: Record<CoverageIssuerStatus, string> = {
  documented: "Documented",
  conditional: "Conditional",
  "not-found": "Not found",
  "not-researched": "Not researched",
};
export const coverageIntegratedLabels: Record<CoverageHomeStatus, string> = {
  none: "Not integrated",
  planned: "Planned",
  "in-build": "In build",
  sandbox: "Sandbox",
  live: "Live",
};

const onrampTones: Record<CoverageIssuerStatus, GlobeMarkerTone> = {
  documented: "positive",
  conditional: "caution",
  "not-found": "negative",
  "not-researched": "neutral",
};

export const coverageGlobeDescription = "Marker tones describe 1:1 onramp research only; portfolio priority does not change marker tone or imply availability.";

export const coverageGlobeCountries: readonly GlobeCountry[] = coverageRegistry.map((record) => {
  const region = record.configuredInHome ? presentationRegions[record.countryCode as CountryCode] : null;
  return {
    countryCode: record.countryCode,
    countryName: record.countryName,
    currency: {
      code: record.currencyCodes.join(", ") || null,
      name: record.currencyCodes.join(", ") || "No current tender currency",
    },
    markerTone: onrampTones[record.issuerRoute.status],
    detail: `${region?.candidateAsset ? "Stablecoin candidate identified" : "No stablecoin candidate identified"}; 1:1 onramp research: ${coverageOnrampLabels[record.issuerRoute.status]}; Portfolio: ${record.portfolio.status === "not-scoped" ? "Not scoped" : `${record.portfolio.status[0].toUpperCase()}${record.portfolio.status.slice(1)}`}${record.portfolio.workstreams.length > 0 ? ` (${record.portfolio.workstreams.map((route) => `${route.currencyCode}→${route.assetSymbol} via ${route.provider}, ${route.stage}${route.currencyCode === "EUR" ? ", country eligibility pending" : ""}`).join("; ")})` : ""}; ${record.homeRoute.status === "none" ? "Not integrated" : `Integrated: ${coverageIntegratedLabels[record.homeRoute.status]}`}`,
  };
});

export const coverageGlobePriorityCountryCodes = coverageRegistry
  .filter((record) => record.portfolio.status === "priority")
  .map((record) => record.countryCode);

export const coverageGlobePointCount = locateCountries(coverageGlobeCountries).length;
