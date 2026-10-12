export const allowedOwnedModuleSpies = new Map([
  ["app/api/cards/webhooks/bridge/route.test.ts", new Set([
    "@/server/cards/bridge/config", "@/server/cards/store", "@/server/db/sql",
  ])],
  ["app/api/cards/webhooks/stripe/route.test.ts", new Set([
    "@/server/cards/bridge/config", "@/server/cards/store", "@/server/db/sql",
  ])],
  ["app/api/cards/webhooks/immersve/[topic]/route.test.ts", new Set([
    "@/server/cards/store", "@/server/db/sql",
  ])],
]);
