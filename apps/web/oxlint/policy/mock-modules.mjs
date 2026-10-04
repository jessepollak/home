export const allowedMockModules = new Map([
  ["tests/server-only-preload.ts", new Set(["server-only"])],
  ["instrumentation-client.test.ts", new Set(["@/client/observability/client-reporter"])],
  ["instrumentation.test.ts", new Set(["@vercel/otel", "@/server/observability/on-request-error"])],
  ["app/api/consolidated-native-base-session.test.ts", new Set(["@/server/cdp/provider"])],
  ["app/api/savings/vaults/route.test.ts", new Set(["@/server/morpho", "next/server"])],
]);
