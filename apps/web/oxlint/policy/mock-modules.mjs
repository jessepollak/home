export const allowedMockModules = new Map([
  ["tests/server-only-preload.ts", new Set(["server-only"])],
  ["app/api/consolidated-native-base-session.test.ts", new Set(["@/server/cdp/provider"])],
  ["app/api/savings/vaults/route.test.ts", new Set(["@/server/morpho", "next/server"])],
]);
