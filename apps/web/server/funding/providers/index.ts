import type { FundingProvider } from "@/shared/funding/provider-contract";
import { idrxProvider } from "./idrx/adapter";
import { ripioProvider } from "./ripio/adapter";

export const fundingProviders = [idrxProvider, ripioProvider] as const satisfies ReadonlyArray<FundingProvider>;

export function getFundingProvider(id: string): FundingProvider | undefined {
  return fundingProviders.find((provider) => provider.manifest.id === id);
}
