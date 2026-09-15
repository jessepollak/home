import "server-only";

import type { FundingDirection, FundingProvider } from "@/shared/funding/provider-contract";
import { normalizeFundingOrigins, FundingProviderConfigurationError } from "../core/provider-context";

export function validateFundingProviders(providers: ReadonlyArray<FundingProvider>): void {
  const ids = new Set<string>();
  const modeEnvironments = new Set<string>();
  for (const provider of providers) {
    const { manifest } = provider;
    if (!manifest.onramp && !manifest.offramp) fail(`${manifest.id} must declare at least one direction.`);
    if (!manifest.id || ids.has(manifest.id)) fail(`Funding provider id ${manifest.id || "<empty>"} is invalid or duplicated.`);
    ids.add(manifest.id);
    if (manifest.onramp) {
      validateModeEnvironment(manifest.id, "onramp", manifest.onramp.modeEnv, manifest.onramp.sandbox === true, modeEnvironments);
      normalizeFundingOrigins(manifest.onramp.apiOrigins);
      validateRedirectOrigins(manifest.onramp.redirectOrigins);
    }
    if (manifest.offramp) {
      validateModeEnvironment(manifest.id, "offramp", manifest.offramp.modeEnv, Boolean(manifest.offramp.sandbox), modeEnvironments);
      normalizeFundingOrigins(manifest.offramp.production.apiOrigins);
      if (manifest.offramp.sandbox) normalizeFundingOrigins(manifest.offramp.sandbox.apiOrigins);
      if (manifest.offramp.sandbox?.contracts.escrow.toLowerCase() === manifest.offramp.production.contracts.escrow.toLowerCase()) {
        fail(`${manifest.id} production and sandbox escrows must differ.`);
      }
    }
    for (const direction of ["onramp", "offramp"] as const) validateDirection(provider, direction);
    for (const binding of manifest.bindings) {
      for (const direction of ["onramp", "offramp"] as const) {
        const directional = binding.directions[direction];
        if (!directional) continue;
        if (!provider[direction] || !manifest[direction]) fail(`${manifest.id} binding declares ${direction} without a matching port and manifest.`);
        if (directional.paymentMethods.length === 0) fail(`${manifest.id} ${direction} binding has no payment methods.`);
        const methods = new Set<string>();
        for (const method of directional.paymentMethods) {
          if (!method.id || methods.has(method.id)) fail(`${manifest.id} ${direction} payment method ids must be unique per binding.`);
          methods.add(method.id);
        }
        const env = new Set<string>();
        for (const name of directional.env) {
          if (!/^[A-Z][A-Z0-9_]*$/.test(name) || env.has(name)) fail(`${manifest.id} ${direction} binding environment names are invalid or duplicated.`);
          env.add(name);
        }
        if (direction === "onramp" && manifest.onramp?.webhook && !env.has(manifest.onramp.webhook.env)) {
          fail(`${manifest.id} webhook secret must be declared by every onramp binding.`);
        }
      }
    }
  }
}

function validateDirection(provider: FundingProvider, direction: FundingDirection): void {
  const declared = Boolean(provider.manifest[direction] || provider[direction]);
  if (!declared) return;
  if (!provider.manifest[direction] || !provider[direction]) fail(`${provider.manifest.id} ${direction} manifest and port must be declared together.`);
  if (!provider.manifest.bindings.some((binding) => Boolean(binding.directions[direction]))) {
    fail(`${provider.manifest.id} ${direction} has no binding.`);
  }
  const keys = new Set<string>();
  for (const binding of provider.manifest.bindings) {
    const directional = binding.directions[direction];
    if (!directional) continue;
    for (const method of directional.paymentMethods) {
      const key = `${binding.region}:${direction}:${method.id}`;
      if (keys.has(key)) fail(`${provider.manifest.id} has ambiguous binding ${key}.`);
      keys.add(key);
    }
  }
}

function validateModeEnvironment(
  providerId: string,
  direction: FundingDirection,
  name: string | undefined,
  supportsSandbox: boolean,
  names: Set<string>,
): void {
  if (!name) return;
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || names.has(name)) {
    fail(`${providerId} ${direction} mode environment name is invalid or duplicated.`);
  }
  if (!supportsSandbox) fail(`${providerId} ${direction} mode environment requires sandbox capability.`);
  names.add(name);
}

function validateRedirectOrigins(origins: ReadonlyArray<string> | undefined): void {
  if (!origins) return;
  normalizeFundingOrigins(origins);
}

function fail(message: string): never {
  throw new FundingProviderConfigurationError(message);
}
