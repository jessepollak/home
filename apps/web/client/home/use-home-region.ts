"use client";

import { useEffect, useState } from "react";
import {
  readAnonymousCountryPreference,
  writeAnonymousCountryPreference,
} from "@/config/country-preference";
import {
  resolvePresentation,
  type RegionId,
  type ResolutionSource,
} from "@/config/regions";

export function useHomeRegion({
  detectedCountry,
  selectedRegionId,
  onRegionChange,
}: {
  detectedCountry: string | null;
  selectedRegionId?: RegionId;
  onRegionChange?: (region: RegionId) => void;
}) {
  const initial = resolvePresentation({ detectedCountry });
  const [internalRegionId, setInternalRegionId] = useState<RegionId>(initial.region.id);
  const [resolutionSource, setResolutionSource] = useState<ResolutionSource>(initial.source);
  const [isPreferenceReady, setIsPreferenceReady] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const regionId = selectedRegionId ?? internalRegionId;

  useEffect(() => {
    const persistedCountry = readAnonymousCountryPreference(() => window.localStorage);
    const resolved = resolvePresentation({ persistedCountry, detectedCountry });
    const hydrationFrame = window.requestAnimationFrame(() => {
      setInternalRegionId(resolved.region.id);
      onRegionChange?.(resolved.region.id);
      setResolutionSource(resolved.source);
      setIsPreferenceReady(true);
    });
    return () => window.cancelAnimationFrame(hydrationFrame);
  }, [detectedCountry, onRegionChange]);

  function selectRegion(nextRegionId: RegionId) {
    setInternalRegionId(nextRegionId);
    onRegionChange?.(nextRegionId);
    setResolutionSource("explicit");
    const didPersist = writeAnonymousCountryPreference(
      () => window.localStorage,
      nextRegionId,
    );
    setPreferenceMessage(
      didPersist
        ? "Country preference saved on this device."
        : "Country updated for this visit. Browser storage is unavailable.",
    );
  }

  return {
    regionId,
    resolutionSource,
    isPreferenceReady,
    preferenceMessage,
    selectRegion,
  };
}
