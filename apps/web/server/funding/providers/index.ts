import "server-only";

import type { FundingProvider } from "@/shared/funding/provider-contract";
import { coinbaseProvider, coinbaseUserTokenCreateOrder } from "./coinbase/adapter";
import type { ProviderUserTokenCreateOrder } from "../core/provider-user-token";
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

export const fundingUserTokenProviders: ReadonlyMap<string, ProviderUserTokenCreateOrder> = new Map([["coinbase", coinbaseUserTokenCreateOrder]]);

export function getFundingProvider(id: string): FundingProvider | undefined {
  return fundingProviders.find((provider) => provider.manifest.id === id);
}
