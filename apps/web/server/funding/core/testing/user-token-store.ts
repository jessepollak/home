import "server-only";

import type { FundingProviderUserTokenStore } from "../user-token-store";

export function forwardingUserTokenStore(store: FundingProviderUserTokenStore, overrides: Partial<FundingProviderUserTokenStore>): FundingProviderUserTokenStore {
  return {
    get: store.get.bind(store),
    putIfEnvelope: store.putIfEnvelope.bind(store),
    deleteIfEnvelope: store.deleteIfEnvelope.bind(store),
    delete: store.delete.bind(store),
    listNotAtVersion: store.listNotAtVersion.bind(store),
    replaceIfEnvelope: store.replaceIfEnvelope.bind(store),
    countNotAtVersion: store.countNotAtVersion.bind(store),
    ...overrides,
  };
}
