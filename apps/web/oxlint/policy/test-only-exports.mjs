export const allowedTestOnlyExports = new Map([
  ["server/actions/store.ts", new Set(["setActionsStoreForTests"])],
  ["server/balances/read.ts", new Set(["clearBalancesChainAssertionsForTests"])],
  ["server/balances/memory-snapshot-store.ts", new Set(["deleteForTests"])],
  ["server/balances/webhook-subscription-store.ts", new Set(["seedLegacyForTests", "clearForTests"])],
  ["server/funding/providers/peer/offramp.ts", new Set(["setPeerClientFactoryForTests"])],
  ["server/observability/log.ts", new Set(["setObservabilityLogWriterForTests"])],
]);
