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
}: {
  detectedCountry: string | null;
}) {
  const initial = resolvePresentation({ detectedCountry });
  const [regionId, setRegionId] = useState<RegionId>(initial.region.id);
  const [resolutionSource, setResolutionSource] = useState<ResolutionSource>(initial.source);
  const [isPreferenceReady, setIsPreferenceReady] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");

  useEffect(() => {
    const persistedCountry = readAnonymousCountryPreference(() => window.localStorage);
    const resolved = resolvePresentation({ persistedCountry, detectedCountry });
    if (resolved.source !== "persisted") {
      writeAnonymousCountryPreference(() => window.localStorage, resolved.region.id);
    }
    const hydrationFrame = window.requestAnimationFrame(() => {
      setRegionId(resolved.region.id);
      setResolutionSource(resolved.source);
      setIsPreferenceReady(true);
    });
    return () => window.cancelAnimationFrame(hydrationFrame);
  }, [detectedCountry]);

  function selectRegion(nextRegionId: RegionId) {
    setRegionId(nextRegionId);
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

export type HomeRegionState = ReturnType<typeof useHomeRegion>;
