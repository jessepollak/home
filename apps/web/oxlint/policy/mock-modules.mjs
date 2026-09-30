export const allowedMockModules = new Map([
  ["tests/server-only-preload.ts", new Set(["server-only"])],
  ["app/api/consolidated-native-base-session.test.ts", new Set(["@/server/cdp/provider"])],
  ["app/api/savings/vaults/route.test.ts", new Set(["@/server/morpho"])],
  ["client/home/home-experience.test.tsx", new Set(["next/navigation"])],
  ["client/borrowing/reducing-only.test.tsx", new Set(["@/shared/borrowing/config"])],
  ["client/account/composite-account-provider.test.tsx", new Set([
    "@coinbase/cdp-hooks",
    "./native-base-bridge",
    "@base-org/account",
  ])],
  ["client/funding/funding-actions.test.tsx", new Set(["next/navigation"])],
  ["client/cards/card-reveal.test.tsx", new Set(["@stripe/stripe-js/pure"])],
  ["client/admin/funding-settings.test.tsx", new Set(["next/navigation"])],
  ["app/admin/(sections)/settings/funding/page.test.tsx", new Set([
    "@/server/operator/page",
    "@/server/funding/offering",
    "next/navigation",
  ])],
]);
