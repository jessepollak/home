export const allowedMockModules = new Map([
  ["tests/server-only-preload.ts", new Set(["server-only"])],
  ["app/api/consolidated-native-base-session.test.ts", new Set(["@/server/cdp/provider"])],
  ["client/home/home-experience.test.tsx", new Set(["next/navigation"])],
  ["client/borrowing/reducing-only.test.tsx", new Set(["@/shared/borrowing/config"])],
  ["client/account/composite-account-provider.test.tsx", new Set([
    "@coinbase/cdp-hooks",
    "./native-base-bridge",
    "@base-org/account",
  ])],
  ["client/funding/funding-actions.test.tsx", new Set(["next/navigation"])],
]);
