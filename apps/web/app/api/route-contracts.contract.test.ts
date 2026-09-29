import { expect, test } from "bun:test";
import { join } from "node:path";
import { inventoryRouteContracts } from "@/tests/helpers/route-contract-inventory";
import manifest from "./route-contracts.json";

const acceptedGaps = {
  routesWithoutVersionedParser: {
    "actions/[id]/confirm/route.ts": ["shared/actions/contracts/confirm.ts"],
    "actions/[id]/handle/route.ts": ["shared/actions/contracts/handle.ts"],
    "actions/[id]/route.ts": ["shared/actions/contracts/get.ts"],
    "actions/prepare/route.ts": ["shared/actions/contracts/prepare.ts"],
    "actions/route.ts": ["shared/actions/contracts/list.ts"],
    "actions/trade-pending/route.ts": ["shared/actions/contracts/trade-pending.ts"],
    "auth/base/verify/route.ts": ["shared/account/contracts/base-verify.ts"],
    "balances/route.ts": ["shared/balances/contract.ts"],
    "funding/orders/[id]/route.ts": ["shared/funding/contracts/order.ts"],
    "funding/orders/route.ts": ["shared/funding/contracts/order.ts"],
    "session/route.ts": ["shared/account/contracts/session.ts"],
  },
  unversionedContracts: new Set([
    "shared/account/contracts/base-verify.ts", "shared/account/contracts/session.ts",
    "shared/actions/contracts/confirm.ts", "shared/actions/contracts/get.ts",
    "shared/actions/contracts/handle.ts", "shared/actions/contracts/list.ts",
    "shared/actions/contracts/prepare.ts", "shared/balances/contract.ts", "shared/cards/transactions-contract.ts", "shared/fees/contract.ts",
    "shared/funding/contracts/order.ts",
    "shared/funding/provider-contract.ts",
  ]),
  parserlessContracts: new Set([
    "shared/actions/contracts/handle.ts", "shared/actions/contracts/trade-pending.ts",
    "shared/funding/provider-contract.ts", "shared/savings/contracts/positions.ts",
  ]),
  handlerUnlinked: new Set([
    "auth/base/verify/route.ts -> shared/account/contracts/base-verify.ts",
    "balances/route.ts -> shared/balances/contract.ts",
    "session/route.ts -> shared/account/contracts/session.ts",
  ]),
  clientUnlinked: {
    "access/route.ts": ["shared/access/contract.ts"],
    "actions/[id]/handle/route.ts": ["shared/actions/contracts/handle.ts"],
    "activity/route.ts": ["shared/activity/contract.ts"],
  },
};

const exemptions = {
  "access/logout/route.ts": "redirect",
  "actions/[id]/paymaster/route.ts": "machine",
  "auth/base/logout/route.ts": "status",
  "client-errors/route.ts": "status",
  "cards/webhooks/bridge/route.ts": "webhook",
  "cards/webhooks/immersve/[topic]/route.ts": "webhook",
  "cards/webhooks/stripe/route.ts": "webhook",
  "funding/webhooks/[provider]/route.ts": "webhook",
  "webhooks/cdp/route.ts": "webhook",
};

test("inventories every API route and rejects newly introduced or stale contract gaps", () => {
  expect(inventoryRouteContracts({ root: join(import.meta.dir, "../.."), manifest })).toEqual([]);
}, 30_000);

function verifyFrozenGaps(baseline: Parameters<typeof inventoryRouteContracts>[0]["manifest"]["baseline"]) {
  expect(baseline.routesWithoutVersionedParser).toEqual(acceptedGaps.routesWithoutVersionedParser);
  expect(baseline.clientUnlinked).toEqual(acceptedGaps.clientUnlinked);
  for (const name of ["unversionedContracts", "parserlessContracts"] as const) {
    expect(new Set(baseline[name])).toEqual(acceptedGaps[name]);
  }
  expect(new Set(Object.entries(baseline.handlerUnlinked).flatMap(([route, contracts]) =>
    contracts.map((contract) => `${route} -> ${contract}`)))).toEqual(acceptedGaps.handlerUnlinked);
}

const clientReasonRoutes = [
  "actions/trade-pending/route.ts",
  "admin/[...path]/route.ts",
  "admin/audit/route.ts",
  "admin/session/route.ts",
  "admin/settings/route.ts",
];

test("accepts only frozen baseline identities", () => {
  verifyFrozenGaps(manifest.baseline);
});

test("retired baseline identities cannot be reinstated without editing the frozen set", () => {
  expect(() => verifyFrozenGaps({ ...manifest.baseline, clientUnlinked: {} })).toThrow();
  expect(() => verifyFrozenGaps({ ...manifest.baseline, routesWithoutVersionedParser: {} })).toThrow();
  expect(() => verifyFrozenGaps({ ...manifest.baseline, handlerUnlinked: {} })).toThrow();
});

test("client reasons are frozen to the reviewed routes", () => {
  expect(Object.entries(manifest.routes as Record<string, { client?: string }>)
    .filter(([, entry]) => typeof entry.client === "string")
    .map(([path]) => path)).toEqual(clientReasonRoutes);
});

test("exempts only redirect, status-only, paymaster callback, and provider webhook routes", () => {
  expect(Object.fromEntries(Object.entries(manifest.routes)
    .filter(([, entry]) => "exempt" in entry)
    .map(([path, entry]) => [path, "exempt" in entry ? entry.exempt.kind : undefined]))).toEqual(exemptions);
});
