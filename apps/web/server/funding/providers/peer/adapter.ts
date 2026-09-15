import "server-only";

import type { FundingProvider } from "@/shared/funding/provider-contract";
import { peerManifest } from "./manifest";
import { peerOfframp } from "./offramp";

export const peerProvider: FundingProvider = {
  manifest: peerManifest,
  offramp: peerOfframp,
};
