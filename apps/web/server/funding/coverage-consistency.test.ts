import "server-only";

import { describe, expect, test } from "bun:test";
import { coverageRegistry } from "@/config/coverage";
import { BASE_FUNDING_ASSETS } from "@/shared/assets/base";
import { coinbaseManifest } from "./providers/coinbase/manifest";
import { idrxManifest } from "./providers/idrx/manifest";
import { ripioManifest } from "./providers/ripio/manifest";

const manifests = [coinbaseManifest, idrxManifest, ripioManifest] as const;

describe("coverage and funding manifests", () => {
  test("use the same country, provider, asset, and payment method identities", () => {
    const bindings = manifests.flatMap((manifest) => manifest.bindings.flatMap((binding) => {
      const onramp = binding.directions.onramp;
      return onramp ? [{ manifest, binding, onramp }] : [];
    }));
    for (const { manifest, binding, onramp } of bindings) {
      const record = coverageRegistry.find((candidate) => candidate.countryCode === binding.region);
      expect(record).toBeDefined();
      expect(record?.homeRoute.status === "in-build" || record?.homeRoute.status === "sandbox" || record?.homeRoute.status === "live").toBe(true);
      expect(record?.homeRoute.providerId).toBe(manifest.id);
      expect(record?.homeRoute.assetId).toBe(binding.assetId);
      expect(record?.homeRoute.paymentMethodIds).toEqual(onramp.paymentMethods.map((method) => method.id));
      expect(BASE_FUNDING_ASSETS[binding.assetId].address.toLocaleLowerCase()).toBe(
        BASE_FUNDING_ASSETS[record?.homeRoute.assetId as keyof typeof BASE_FUNDING_ASSETS].address.toLocaleLowerCase(),
      );
    }

    for (const record of coverageRegistry.filter((candidate) => candidate.homeRoute.status !== "none" && candidate.homeRoute.status !== "planned")) {
      expect(bindings.some(({ manifest, binding }) => manifest.id === record.homeRoute.providerId && binding.region === record.countryCode && binding.assetId === record.homeRoute.assetId)).toBe(true);
    }
  });

  test("keeps sandbox manifest status explicit", () => {
    for (const manifest of manifests) {
      if (!("sandbox" in manifest.onramp) || !manifest.onramp.sandbox) continue;
      for (const binding of manifest.bindings) {
        if (!binding.directions.onramp) continue;
        const record = coverageRegistry.find((candidate) => candidate.countryCode === binding.region);
        expect(record?.homeRoute.status).toBe("sandbox");
      }
    }
  });
});
