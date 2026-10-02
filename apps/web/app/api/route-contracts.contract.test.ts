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
    "session/route.ts": ["shared/account/contracts/session.ts"],
  },
  unversionedContracts: new Set([
    "shared/account/contracts/base-verify.ts", "shared/account/contracts/session.ts",
    "shared/actions/contracts/confirm.ts", "shared/actions/contracts/get.ts",
    "shared/actions/contracts/handle.ts", "shared/actions/contracts/list.ts",
    "shared/actions/contracts/prepare.ts", "shared/cards/transactions-contract.ts", "shared/fees/contract.ts",
    "shared/funding/contracts/errors.ts", "shared/funding/contracts/order.ts",
    "shared/funding/provider-contract.ts",
  ]),
  parserlessContracts: new Set([
    "shared/actions/contracts/handle.ts", "shared/actions/contracts/trade-pending.ts",
    "shared/funding/provider-contract.ts", "shared/savings/contracts/positions.ts",
  ]),
  handlerUnlinked: new Set([
    "auth/base/verify/route.ts -> shared/account/contracts/base-verify.ts",
    "session/route.ts -> shared/account/contracts/session.ts",
  ]),
  clientUnlinked: {
    "access/route.ts": ["shared/access/contract.ts"],
    "actions/[id]/handle/route.ts": ["shared/actions/contracts/handle.ts"],
    "activity/route.ts": ["shared/activity/contract.ts"],
  },
};

const apiExemptions = {
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

const appExemptions = {
  "app/coverage.csv/route.ts": "document",
  "app/invite/[code]/route.ts": "redirect",
};

test("inventories every route and rejects newly introduced or stale contract gaps", () => {
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

test("method allowances are frozen to the reviewed compatibility responses", () => {
  const routes: Parameters<typeof inventoryRouteContracts>[0]["manifest"]["routes"] = manifest.routes;
  expect(Object.fromEntries(Object.entries(routes).flatMap(([path, entry]) =>
    Object.entries(entry.methods ?? {}).flatMap(([method, classification]) =>
      classification.allowance ? [[`${path} ${method}`, classification.allowance.kind]] : [])))).toEqual({
    "funding/orders/[id]/route.ts GET": "unversioned-compatibility",
    "funding/orders/route.ts POST": "unversioned-compatibility",
  });
});

test("a versioned GET parser cannot cover an unversioned POST without an allowance", () => {
  const modified: Parameters<typeof inventoryRouteContracts>[0]["manifest"] = structuredClone(manifest);
  modified.routes["funding/orders/route.ts"].methods = {
    GET: { contracts: ["shared/funding/contracts/open-order.ts"] },
    POST: { contracts: ["shared/funding/contracts/order.ts"] },
  };
  const root = join(import.meta.dir, "../..");
  expect(inventoryRouteContracts({ root, manifest: modified })).toContainEqual({
    code: "method-unversioned",
    path: "funding/orders/route.ts",
    detail: expect.stringContaining("POST"),
  });
  expect(inventoryRouteContracts({ root, manifest })).toEqual([]);
}, 30_000);

test("a multi-method route must classify its exported methods", () => {
  const modified: Parameters<typeof inventoryRouteContracts>[0]["manifest"] = structuredClone(manifest);
  delete modified.routes["funding/orders/route.ts"].methods;
  expect(inventoryRouteContracts({ root: join(import.meta.dir, "../.."), manifest: modified })).toContainEqual({
    code: "method-unclassified",
    path: "funding/orders/route.ts",
    detail: expect.any(String),
  });
}, 30_000);

type Manifest = Parameters<typeof inventoryRouteContracts>[0]["manifest"];

function fixtureMethods(modified: Manifest) {
  const methods = modified.routes["funding/orders/route.ts"].methods;
  if (!methods) throw new Error("Fixture funding order methods are missing");
  return methods;
}

function fixturePost(modified: Manifest) {
  const post = fixtureMethods(modified).POST;
  if (!post) throw new Error("Fixture funding order POST is missing");
  return post;
}

function fixtureAllowance(modified: Manifest) {
  const allowance = fixturePost(modified).allowance;
  if (!allowance) throw new Error("Fixture funding order POST allowance is missing");
  return allowance;
}

function invalidMethodMap(methods: unknown) {
  return methods as NonNullable<Manifest["routes"][string]["methods"]>;
}

const invalidMethodClassifications: { name: string; code: string; path: string; mutate: (modified: Manifest) => void }[] = [
  {
    name: "an exported method missing from the map",
    code: "method-unclassified",
    path: "funding/orders/route.ts",
    mutate: (modified) => { delete fixtureMethods(modified).POST; },
  },
  {
    name: "a method the route does not export",
    code: "method-unknown",
    path: "funding/orders/route.ts",
    mutate: (modified) => { fixtureMethods(modified).OPTIONS = { contracts: ["shared/funding/contracts/open-order.ts"] }; },
  },
  {
    name: "a contract outside the route declaration",
    code: "method-contract-undeclared",
    path: "funding/orders/route.ts",
    mutate: (modified) => { fixturePost(modified).contracts = ["shared/funding/contracts/quotes.ts"]; },
  },
  {
    name: "a declared contract with no method binding",
    code: "method-contract-unbound",
    path: "funding/orders/route.ts",
    mutate: (modified) => { fixturePost(modified).contracts = ["shared/funding/contracts/open-order.ts"]; },
  },
  {
    name: "an unrecognized allowance kind",
    code: "method-allowance-invalid",
    path: "funding/orders/route.ts",
    mutate: (modified) => { fixtureAllowance(modified).kind = "unreviewed"; },
  },
  {
    name: "an allowance without a specific reason",
    code: "method-allowance-invalid",
    path: "funding/orders/route.ts",
    mutate: (modified) => { fixtureAllowance(modified).reason = "Compatibility"; },
  },
  {
    name: "a non-object method map",
    code: "method-map-invalid",
    path: "funding/orders/route.ts",
    mutate: (modified) => { modified.routes["funding/orders/route.ts"].methods = invalidMethodMap(null); },
  },
  {
    name: "an array method map",
    code: "method-map-invalid",
    path: "funding/orders/route.ts",
    mutate: (modified) => { modified.routes["funding/orders/route.ts"].methods = invalidMethodMap([]); },
  },
  {
    name: "a method map on an exempt route",
    code: "method-map-invalid",
    path: "auth/base/logout/route.ts",
    mutate: (modified) => { modified.routes["auth/base/logout/route.ts"].methods = { POST: {} }; },
  },
  {
    name: "a route-level tolerance replaced by method classification",
    code: "baseline-stale",
    path: "funding/orders/route.ts",
    mutate: (modified) => { modified.baseline.routesWithoutVersionedParser["funding/orders/route.ts"] = ["shared/funding/contracts/order.ts"]; },
  },
];

test.each(invalidMethodClassifications)("rejects $name", ({ code, path, mutate }) => {
  const modified: Manifest = structuredClone(manifest);
  mutate(modified);
  expect(inventoryRouteContracts({ root: join(import.meta.dir, "../.."), manifest: modified })).toContainEqual({
    code, path, detail: expect.any(String),
  });
}, 30_000);

test("retired baseline identities cannot be reinstated without editing the frozen set", () => {
  expect(() => verifyFrozenGaps({ ...manifest.baseline, clientUnlinked: {} })).toThrow();
  expect(() => verifyFrozenGaps({ ...manifest.baseline, routesWithoutVersionedParser: {} })).toThrow();
  expect(() => verifyFrozenGaps({ ...manifest.baseline, handlerUnlinked: {} })).toThrow();
});

test("client reasons are frozen to the reviewed routes", () => {
  const routes: Manifest["routes"] = manifest.routes;
  expect(Object.entries(routes)
    .filter(([, entry]) => typeof entry.client === "string")
    .map(([path]) => path)).toEqual(clientReasonRoutes);
});

test("app routes are frozen to the reviewed exemptions", () => {
  expect(Object.keys(manifest.appRoutes)).toEqual(["app/coverage.csv/route.ts", "app/invite/[code]/route.ts"]);
  for (const entry of Object.values(manifest.appRoutes)) expect(entry.exempt).toBeDefined();
});

test("exempts only document, redirect, status-only, paymaster callback, and provider webhook routes", () => {
  expect(Object.fromEntries(Object.entries(manifest.routes)
    .filter(([, entry]) => "exempt" in entry)
    .map(([path, entry]) => [path, "exempt" in entry ? entry.exempt.kind : undefined]))).toEqual(apiExemptions);
  expect(Object.fromEntries(Object.entries(manifest.appRoutes)
    .filter(([, entry]) => "exempt" in entry)
    .map(([path, entry]) => [path, "exempt" in entry ? entry.exempt.kind : undefined]))).toEqual(appExemptions);
});
