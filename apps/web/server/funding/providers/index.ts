import "server-only";

import type { FundingProvider } from "@/shared/funding/provider-contract";
import { coinbaseProvider } from "./coinbase/adapter";
import { idrxProvider } from "./idrx/adapter";
import { ripioProvider } from "./ripio/adapter";
import { peerProvider } from "./peer/adapter";
import { validateFundingProviders } from "./validate";

export const fundingProviders = [
  idrxProvider,
  ripioProvider,
  coinbaseProvider,
  peerProvider,
] as const satisfies ReadonlyArray<FundingProvider>;

validateFundingProviders(fundingProviders);

export function getFundingProvider(id: string): FundingProvider | undefined {
  return fundingProviders.find((provider) => provider.manifest.id === id);
}
