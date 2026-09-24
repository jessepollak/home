import "server-only";

import { expect, test } from "bun:test";
import { presentationRegions } from "@/config/regions";
import { euroAreaPeerCountries, peerManifest } from "./manifest";

test("Peer euro-area bindings match exactly the configured EUR countries", () => {
  const configured: string[] = Object.values(presentationRegions)
    .filter((region) => region.countryCode && region.currency.code === "EUR")
    .map((region) => region.id);
  const euroBindings = peerManifest.bindings.filter((binding) => binding.currency === "EUR");

  expect(new Set(euroAreaPeerCountries).size).toBe(euroAreaPeerCountries.length);
  const peerCountries: string[] = [...euroAreaPeerCountries];
  const boundCountries: string[] = euroBindings.map((binding) => binding.region);
  expect(peerCountries.sort()).toEqual(configured.sort());
  expect(boundCountries.sort()).toEqual(configured);
  expect(euroBindings.every((binding) => binding.assetId === "base:usdc" &&
    binding.directions.offramp?.paymentMethods.length === 1 &&
    binding.directions.offramp.paymentMethods[0]?.id === "revolut" &&
    binding.directions.offramp.env.includes("PEER_OFFRAMP_ENABLED") &&
    !("onramp" in binding.directions))).toBe(true);
});
