import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inventoryRouteContracts } from "./helpers/route-contract-inventory";

type Manifest = Parameters<typeof inventoryRouteContracts>[0]["manifest"];
const roots: string[] = [];
const route = "items/route.ts";
const contract = "shared/items/contract.ts";
const appRoute = "app/report/route.ts";
const documentExemption = { kind: "document", reason: "This report is downloaded as a document and is never parsed by a Home client." };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "home-route-contracts-"));
  roots.push(root);
  const write = (path: string, source: string) => {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, source);
  };
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; export const GET = () => parseItem({ version: 1 });');
  write(contract, "export const ITEM_VERSION = 1; export function parseItem(value: unknown) { return value; }");
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items").then(parseItem);');
  const manifest: Manifest = {
    routes: { [route]: { contracts: [contract] } },
    appRoutes: {},
    baseline: { routesWithoutVersionedParser: {}, unversionedContracts: [], parserlessContracts: [], handlerUnlinked: {}, clientUnlinked: {} },
  };
  const violations = () => inventoryRouteContracts({ root, manifest });
  const codes = () => violations().map(({ code, path }) => ({ code, path }));
  return { root, write, manifest, violations, codes };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("accepts a mapped versioned, parsed contract with both sides linked", () => {
  expect(fixture().violations()).toEqual([]);
});

test("rejects a newly added unmapped route", () => {
  const { write, codes } = fixture();
  write("app/api/extra/route.ts", "export const GET = () => new Response(null);");
  expect(codes()).toContainEqual({ code: "route-unclassified", path: "extra/route.ts" });
});

test("rejects an unlisted api handler in a dot-directory", () => {
  const { write, codes } = fixture();
  write("app/api/.hidden/route.ts", "export const GET = () => new Response(null);");
  expect(codes()).toEqual([{ code: "route-unclassified", path: ".hidden/route.ts" }]);
});

for (const path of ["app/route.ts", ...["ts", "tsx", "js", "jsx"].map((extension) => `app/report/route.${extension}`)]) {
  test(`rejects an unlisted non-api handler at ${path}`, () => {
    const { write, codes } = fixture();
    write(path, "export const GET = () => new Response(null);");
    expect(codes()).toEqual([{ code: "route-unclassified", path }]);
  });
}

test("rejects an unlisted non-api handler in a dot-directory", () => {
  const { write, codes } = fixture();
  const path = "app/.well-known/home-auth/route.ts";
  write(path, "export const GET = () => new Response(null);");
  expect(codes()).toEqual([{ code: "route-unclassified", path }]);
});

test("ignores handlers inside a Next.js private folder", () => {
  const { write, codes } = fixture();
  write("app/_lib/route.ts", "export const GET = () => new Response(null);");
  write("app/api/_lib/route.ts", "export const GET = () => new Response(null);");
  expect(codes()).toEqual([]);
});

test("ignores handlers below a nested private folder", () => {
  const { write, codes } = fixture();
  write("app/api/items/_private/nested/route.ts", "export const GET = () => new Response(null);");
  write("app/_private/nested/route.ts", "export const GET = () => new Response(null);");
  expect(codes()).toEqual([]);
});

test("still inventories a folder whose name only contains an underscore", () => {
  const { write, codes } = fixture();
  write("app/api/item_library/route.ts", "export const GET = () => new Response(null);");
  write("app/item_library/route.ts", "export const GET = () => new Response(null);");
  expect(codes()).toEqual([
    { code: "route-unclassified", path: "app/item_library/route.ts" },
    { code: "route-unclassified", path: "item_library/route.ts" },
  ]);
});

test("a private-folder path in the manifest is not a route", () => {
  const { write, manifest, codes } = fixture();
  write("app/_lib/route.ts", "export const GET = () => new Response(null);");
  manifest.appRoutes["app/_lib/route.ts"] = { exempt: documentExemption };
  expect(codes()).toEqual([{ code: "route-unknown", path: "app/_lib/route.ts" }]);
});

test("accepts a reviewed document exemption for a non-api handler in a dot-directory", () => {
  const { write, manifest, violations } = fixture();
  const path = "app/.well-known/home-auth/route.ts";
  write(path, "export const GET = () => new Response(null);");
  manifest.appRoutes[path] = { exempt: documentExemption };
  expect(violations()).toEqual([]);
});

test("accepts a reviewed document exemption for a non-api handler", () => {
  const { write, manifest, violations } = fixture();
  write(appRoute, "export const GET = () => new Response(null);");
  manifest.appRoutes[appRoute] = { exempt: documentExemption };
  expect(violations()).toEqual([]);
});

test("rejects contracts on non-api handlers even with a reviewed exemption", () => {
  const { write, manifest, codes } = fixture();
  write(appRoute, "export const GET = () => new Response(null);");
  manifest.appRoutes[appRoute] = { contracts: [contract], exempt: documentExemption };
  expect(codes()).toEqual([{ code: "route-contract-unsupported", path: appRoute }]);
  manifest.appRoutes[appRoute]!.contracts = [];
  expect(codes()).toEqual([{ code: "route-contract-unsupported", path: appRoute }]);
});

for (const [name, entry] of [
  ["empty entry", {}],
  ["unrecognized kind", { exempt: { ...documentExemption, kind: "internal" } }],
  ["short trimmed reason", { exempt: { kind: "document", reason: "    Too short    " } }],
] as const) {
  test(`rejects a non-api exemption with ${name}`, () => {
    const { write, manifest, codes } = fixture();
    write(appRoute, "export const GET = () => new Response(null);");
    manifest.appRoutes[appRoute] = entry;
    expect(codes()).toEqual([{ code: "exempt-invalid", path: appRoute }]);
  });
}

test("rejects a manifest app route without a handler", () => {
  const { manifest, codes } = fixture();
  manifest.appRoutes[appRoute] = { exempt: documentExemption };
  expect(codes()).toEqual([{ code: "route-unknown", path: appRoute }]);
});

test("requires app route keys to be sorted", () => {
  const { write, manifest, codes } = fixture();
  const alpha = "app/alpha/route.ts";
  for (const path of [appRoute, alpha]) {
    write(path, "export const GET = () => new Response(null);");
    manifest.appRoutes[path] = { exempt: documentExemption };
  }
  expect(codes()).toEqual([{ code: "manifest-unsorted", path: "appRoutes" }]);
});

test("rejects an api handler listed in appRoutes", () => {
  const { manifest, codes } = fixture();
  const path = `app/api/${route}`;
  manifest.appRoutes[path] = { exempt: documentExemption };
  expect(codes()).toEqual([{ code: "route-unknown", path }]);
});

test("inventories non-typescript route handlers", () => {
  const { write, codes } = fixture();
  write("app/api/legacy/route.js", "export const GET = () => new Response(null);");
  expect(codes()).toContainEqual({ code: "route-unclassified", path: "legacy/route.js" });
});

test("non-typescript routes link a client by their public path", () => {
  const { write, manifest, codes } = fixture();
  const legacy = "legacy/route.js";
  write(`app/api/${legacy}`, 'import { parseItem } from "@/shared/items/contract"; export const GET = () => parseItem({ version: 1 });');
  manifest.routes[legacy] = { contracts: [contract] };
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/legacy");');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: legacy });
});

test("a root api route links a client at /api", () => {
  const { write, manifest, codes } = fixture();
  const root = "route.ts";
  write(`app/api/${root}`, 'import { parseItem } from "@/shared/items/contract"; export const GET = () => parseItem({ version: 1 });');
  manifest.routes = { [route]: manifest.routes[route]!, [root]: { contracts: [contract] } };
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api");');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: root });
});

test("manifest routes and contract lists must be sorted and unique", () => {
  const { write, manifest, codes } = fixture();
  manifest.routes[route]!.contracts!.push(contract);
  expect(codes()).toContainEqual({ code: "manifest-duplicate", path: route });
  manifest.routes[route]!.contracts!.pop();
  const alpha = "alpha/route.ts";
  write(`app/api/${alpha}`, 'import { parseItem } from "@/shared/items/contract"; export const GET = () => parseItem({ version: 1 });');
  manifest.routes[alpha] = { contracts: [contract] };
  expect(codes()).toContainEqual({ code: "manifest-unsorted", path: "routes" });
});

test("reports removed routes in the manifest and baseline", () => {
  const { manifest, codes } = fixture();
  manifest.routes["missing/route.ts"] = { contracts: [contract] };
  manifest.baseline.routesWithoutVersionedParser["another/route.ts"] = [contract];
  expect(codes()).toContainEqual({ code: "route-unknown", path: "missing/route.ts" });
  expect(codes()).toContainEqual({ code: "route-unknown", path: "another/route.ts" });
  expect(codes()).toContainEqual({ code: "baseline-stale", path: "another/route.ts" });
});

test("detects double classification and empty or missing mapping", () => {
  const { manifest, codes } = fixture();
  manifest.routes[route] = { exempt: { kind: "machine", reason: "A provider posts its wire format without Home parsing the response." } };
  manifest.baseline.routesWithoutVersionedParser[route] = [contract];
  expect(codes()).toContainEqual({ code: "route-double", path: route });
  expect(codes()).toContainEqual({ code: "baseline-stale", path: route });
  manifest.baseline.routesWithoutVersionedParser = {};
  manifest.routes[route] = { contracts: [] };
  expect(codes()).toContainEqual({ code: "route-double", path: route });
  manifest.routes[route] = {};
  expect(codes()).toContainEqual({ code: "route-double", path: route });
});

test("rejects invalid exemption kind and reason", () => {
  const { manifest, codes } = fixture();
  manifest.routes[route] = { exempt: { kind: "internal", reason: "not enough" } };
  expect(codes()).toContainEqual({ code: "exempt-invalid", path: route });
});

test("rejects a declared module that is not a contract", () => {
  const { manifest, codes } = fixture();
  manifest.routes[route] = { contracts: ["shared/items/model.ts"] };
  expect(codes()).toContainEqual({ code: "contract-unknown", path: route });
});

test("a missing handler import cannot be hidden by an unrelated transitive contract", () => {
  const { write, codes } = fixture();
  write(`app/api/${route}`, 'import "@/shared/other/contract"; export const GET = () => new Response(null);');
  write("shared/other/contract.ts", "export const OTHER_VERSION = 1; export const parseOther = (value: unknown) => value;");
  expect(codes()).toContainEqual({ code: "handler-unlinked", path: route });
});

test("a client with no URL or contract needs a reason or a baseline", () => {
  const { write, manifest, codes } = fixture();
  write("client/items.ts", 'export const loadItem = () => fetch("/api/other");');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  manifest.routes[route]!.client = "This endpoint is only consumed by a server-rendered page.";
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
  manifest.routes[route]!.client = undefined;
  manifest.baseline.clientUnlinked[route] = [contract];
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
});

test("a client reason cannot hide a URL-bearing client that skips the parser", () => {
  const { write, manifest, codes } = fixture();
  write("client/items.ts", 'export const loadItem = () => fetch("/api/items");');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  manifest.routes[route]!.client = "Only a server-rendered page consumes this response.";
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  manifest.baseline.clientUnlinked[route] = [contract];
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
});

test("reports unversioned and parserless modules even when not declared", () => {
  const { write, codes } = fixture();
  write("shared/other/contracts/legacy.ts", "export type Legacy = { id: string }; ");
  expect(codes()).toContainEqual({ code: "contract-unversioned", path: "shared/other/contracts/legacy.ts" });
  expect(codes()).toContainEqual({ code: "contract-parserless", path: "shared/other/contracts/legacy.ts" });
});

test("an unversioned mapped contract fails without a baseline", () => {
  const { write, codes } = fixture();
  write(contract, "export function parseItem(value: unknown) { return value; }");
  expect(codes()).toContainEqual({ code: "contract-unversioned", path: contract });
});

test("new routes cannot reuse an unversioned contract from the baseline", () => {
  const { write, manifest, violations, codes } = fixture();
  write(contract, "export function parseItem(value: unknown) { return value; }");
  manifest.baseline.unversionedContracts.push(contract);
  manifest.baseline.routesWithoutVersionedParser[route] = [contract];
  expect(violations()).toEqual([]);
  write("app/api/extra/route.ts", 'import { parseItem } from "@/shared/items/contract"; export const GET = () => parseItem({});');
  manifest.routes["extra/route.ts"] = { contracts: [contract] };
  expect(codes()).toContainEqual({ code: "route-unversioned-parser", path: "extra/route.ts" });
});

test("new routes cannot reuse a parserless contract from the baseline", () => {
  const { write, manifest, violations, codes } = fixture();
  write(contract, "export const ITEM_VERSION = 1; export type Item = { version: number };");
  manifest.baseline.parserlessContracts.push(contract);
  manifest.baseline.routesWithoutVersionedParser[route] = [contract];
  manifest.baseline.clientUnlinked[route] = [contract];
  expect(violations()).toEqual([]);
  write("app/api/extra/route.ts", 'import { Item } from "@/shared/items/contract"; export const GET = () => new Response(null);');
  manifest.routes["extra/route.ts"] = { contracts: [contract] };
  expect(codes()).toContainEqual({ code: "route-unversioned-parser", path: "extra/route.ts" });
});

test("accepts baselined routes with declared contracts but no versioned parser", () => {
  const { write, manifest, violations } = fixture();
  write(contract, "export function parseItem(value: unknown) { return value; }");
  manifest.baseline.routesWithoutVersionedParser[route] = [contract];
  manifest.baseline.unversionedContracts.push(contract);
  expect(violations()).toEqual([]);
});

test("a baselined route without a manifest entry is rejected", () => {
  const { write, manifest, codes } = fixture();
  write("app/api/extra/route.ts", "export const POST = () => new Response(null);");
  manifest.baseline.routesWithoutVersionedParser["extra/route.ts"] = [contract];
  expect(codes()).toContainEqual({ code: "route-unclassified", path: "extra/route.ts" });
});

test("a route baseline becomes stale when its declared contract gains a versioned parser", () => {
  const { write, manifest, violations, codes } = fixture();
  write(contract, "export function parseItem(value: unknown) { return value; }");
  manifest.baseline.routesWithoutVersionedParser[route] = [contract];
  manifest.baseline.unversionedContracts.push(contract);
  expect(violations()).toEqual([]);
  write(contract, "export const ITEM_VERSION = 1; export function parseItem(value: unknown) { return value; }");
  manifest.baseline.unversionedContracts = [];
  expect(codes()).toContainEqual({ code: "baseline-stale", path: route });
});

test("baselines must shrink when a parser or version is introduced", () => {
  const { manifest, codes } = fixture();
  manifest.baseline.unversionedContracts.push(contract);
  manifest.baseline.parserlessContracts.push(contract);
  expect(codes()).toContainEqual({ code: "baseline-stale", path: contract });
  expect(codes().filter((item) => item.code === "baseline-stale" && item.path === contract)).toHaveLength(2);
});

test("stale, duplicate, and unsorted baselines fail", () => {
  const { manifest, codes } = fixture();
  manifest.baseline.routesWithoutVersionedParser[route] = [contract, contract];
  manifest.baseline.unversionedContracts.push("shared/z/contract.ts", "shared/a/contract.ts");
  expect(codes()).toContainEqual({ code: "baseline-stale", path: route });
  expect(codes()).toContainEqual({ code: "baseline-unsorted", path: "unversionedContracts" });
  expect(codes()).toContainEqual({ code: "baseline-stale", path: "shared/a/contract.ts" });
});

test("a baselined route cannot add a weak contract beyond its recorded tolerance", () => {
  const { write, manifest, violations, codes } = fixture();
  const first = "shared/zeta/contract.ts";
  const second = "shared/zulu/contract.ts";
  write(first, "export const parseZeta = (value: unknown) => value;");
  write(second, "export const parseZulu = (value: unknown) => value;");
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseZeta } from "@/shared/zeta/contract"; import { parseZulu } from "@/shared/zulu/contract"; export const GET = () => parseZulu(parseZeta(parseItem({ version: 1 })));');
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseZeta } from "@/shared/zeta/contract"; import { parseZulu } from "@/shared/zulu/contract"; export const loadItem = () => fetch("/api/items").then((value) => parseZulu(parseZeta(parseItem(value))));');
  manifest.routes[route]!.contracts = [contract, first, second];
  manifest.baseline.unversionedContracts.push(first, second);
  manifest.baseline.routesWithoutVersionedParser[route] = [first];
  expect(codes()).toContainEqual({ code: "route-unversioned-parser", path: route });
  manifest.baseline.routesWithoutVersionedParser[route] = [first, second];
  expect(violations()).toEqual([]);
});

test("a weak-route tolerance must shrink when its recorded contract changes", () => {
  const { write, manifest, violations } = fixture();
  const weak = "shared/zeta/contract.ts";
  write(weak, "export function parseZeta(value: unknown) { return value; }");
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseZeta } from "@/shared/zeta/contract"; export const GET = () => parseZeta(parseItem({ version: 1 }));');
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseZeta } from "@/shared/zeta/contract"; export const loadItem = () => fetch("/api/items").then((value) => parseZeta(parseItem(value)));');
  manifest.routes[route]!.contracts = [contract, weak];
  manifest.baseline.unversionedContracts.push(weak);
  manifest.baseline.routesWithoutVersionedParser[route] = [weak];
  expect(violations()).toEqual([]);
  manifest.routes[route]!.contracts = [contract];
  expect(violations()).toContainEqual({ code: "baseline-stale", path: route, detail: `Weak contract tolerance no longer applies: ${weak}` });
  manifest.routes[route]!.contracts = [contract, weak];
  write(weak, "export const ZETA_VERSION = 1; export function parseZeta(value: unknown) { return value; }");
  manifest.baseline.unversionedContracts = [];
  expect(violations()).toContainEqual({ code: "baseline-stale", path: route, detail: `Weak contract tolerance no longer applies: ${weak}` });
  manifest.baseline.routesWithoutVersionedParser[route] = ["shared/gone/contract.ts"];
  expect(violations()).toContainEqual({ code: "baseline-stale", path: route, detail: "Weak contract tolerance no longer applies: shared/gone/contract.ts" });
});

test("a client tolerance covers only its recorded contracts", () => {
  const { write, manifest, violations, codes } = fixture();
  const linkedLater = "shared/zeta/contract.ts";
  const unlinked = "shared/zulu/contract.ts";
  write(linkedLater, "export const ZETA_VERSION = 1; export const parseZeta = (value: unknown) => value;");
  write(unlinked, "export const ZULU_VERSION = 1; export const parseZulu = (value: unknown) => value;");
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseZeta } from "@/shared/zeta/contract"; import { parseZulu } from "@/shared/zulu/contract"; export const GET = () => parseZulu(parseZeta(parseItem({ version: 1 })));');
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items").then(parseItem);');
  manifest.routes[route]!.contracts = [contract, linkedLater, unlinked];
  manifest.baseline.clientUnlinked[route] = [linkedLater];
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  manifest.baseline.clientUnlinked[route] = [linkedLater, unlinked];
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseZeta } from "@/shared/zeta/contract"; export const loadItem = () => fetch("/api/items").then((value) => parseZeta(parseItem(value)));');
  expect(violations()).toContainEqual({ code: "baseline-stale", path: route, detail: `Client gap no longer applies: ${linkedLater}` });
});

test("baseline tolerance maps must be sorted and duplicate-free", () => {
  const { manifest, codes } = fixture();
  manifest.baseline.routesWithoutVersionedParser[route] = ["shared/zulu/contract.ts", "shared/alpha/contract.ts"];
  expect(codes()).toContainEqual({ code: "baseline-unsorted", path: route });
  manifest.baseline.routesWithoutVersionedParser[route] = ["shared/alpha/contract.ts", "shared/alpha/contract.ts"];
  expect(codes()).toContainEqual({ code: "baseline-stale", path: route });
  manifest.baseline.clientUnlinked = { "zulu/route.ts": [], "alpha/route.ts": [] };
  expect(codes()).toContainEqual({ code: "baseline-unsorted", path: "clientUnlinked" });
});

test("handler-link baseline becomes stale when the handler imports the contract", () => {
  const { manifest, codes } = fixture();
  manifest.baseline.handlerUnlinked[route] = [contract];
  expect(codes()).toContainEqual({ code: "baseline-stale", path: route });
});

test("follows type-only, re-export, relative and alias dynamic imports", () => {
  const { write, violations } = fixture();
  write(`app/api/${route}`, 'import type { Item } from "@/server/handler"; export const GET = () => new Response(null);');
  write("server/handler.ts", 'export type { Item } from "../shared/items";');
  write("shared/items/index.ts", 'export type { Item } from "./contract";');
  write(contract, "export const ITEM_VERSION = 1; export type Item = { version: number }; export const parseItem = (value: unknown) => value;");
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items").then(parseItem);');
  expect(violations()).toEqual([]);
});

test("comments never count as imports, version tokens, or parser exports", () => {
  const { write, codes } = fixture();
  write(`app/api/${route}`, '// import "@/shared/items/contract"\nexport const GET = () => new Response(null);');
  write(contract, '// ITEM_VERSION\n// export function parseItem() {}\nexport type Item = {};');
  expect(codes()).toContainEqual({ code: "handler-unlinked", path: route });
  expect(codes()).toContainEqual({ code: "contract-unversioned", path: contract });
  expect(codes()).toContainEqual({ code: "contract-parserless", path: contract });
});

test("re-export parser detection checks the exported alias, not its original name", () => {
  const { write, codes } = fixture();
  write("shared/items/parser.ts", "export const parseItem = (value: unknown) => value; export const renamed = (value: unknown) => value;");
  write(contract, 'export const ITEM_VERSION = 1; export { parseItem as renamed } from "./parser";');
  expect(codes()).toContainEqual({ code: "contract-parserless", path: contract });
  write(contract, 'export const ITEM_VERSION = 1; export { renamed as parseItem } from "./parser";');
  expect(codes()).not.toContainEqual({ code: "contract-parserless", path: contract });
});

test("callable local aliases qualify as parsers", () => {
  const { write, violations } = fixture();
  for (const declaration of [
    "function decodeItem(value: unknown) { return value; }",
    "const decodeItem = (value: unknown) => value;",
    "function makeParser() { return (value: unknown) => value; } const decodeItem = makeParser();",
  ]) {
    for (const exportAlias of ["export const parseItem = decodeItem;", "export { decodeItem as parseItem };"]) {
      write(contract, `export const ITEM_VERSION = 1; ${declaration} ${exportAlias}`);
      expect(violations()).toEqual([]);
    }
  }
});

test("a type-only client link is not a runtime parser link", () => {
  const { write, codes } = fixture();
  write("client/items.ts", 'import type { Item } from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items");');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items").then(parseItem);');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
});
test("a version-only runtime import does not link a URL client, but a parser import does", () => {
  const { write, codes } = fixture();
  write("client/items.ts", 'import { ITEM_VERSION } from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items").then((response) => response.json());');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items").then(parseItem);');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
});

test("a namespace import links only when its parser member is referenced", () => {
  const { write, codes } = fixture();
  write("client/items.ts", 'import * as items from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items").then((response) => response.json());');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  write("client/items.ts", 'import * as items from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items").then(items.parseItem);');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
});

test("a parser module links when its runtime-import closure contains the fetching module", () => {
  const { write, violations } = fixture();
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; import { fetchItem } from "./transport"; export const loadItem = () => fetchItem().then(parseItem);');
  write("client/transport.ts", 'export const fetchItem = () => fetch("/api/items");');
  expect(violations()).toEqual([]);
});
test("default and aliased parser imports retain their declared contract origin", () => {
  const { write, codes } = fixture();
  write(contract, 'export const ITEM_VERSION = 1; export function parseItem(value: unknown) { return value; } export { parseItem as default };');
  write("client/items.ts", 'import parse from "@/shared/items/contract"; fetch("/api/items").then(parse);');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
  write("client/barrel.ts", 'export { parseItem as readItem } from "@/shared/items/contract";');
  write("client/items.ts", 'import { readItem } from "./barrel"; fetch("/api/items").then(readItem);');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
  write(contract, 'export const ITEM_VERSION = 1; export default function parseItem(value: unknown) { return value; }');
  write("client/items.ts", 'import parseItem from "@/shared/items/contract"; fetch("/api/items").then(parseItem);');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
});



test("an unrelated client importing the contract cannot link the route", () => {
  const { write, codes } = fixture();
  write("client/items.ts", 'import "@/shared/items/contract"; export const loadItem = () => fetch("/api/other");');
  write("client/other.ts", 'export const loadOther = () => fetch("/api/items");');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  write("client/other.ts", 'import { parseItem } from "@/shared/items/contract"; export const loadOther = () => fetch("/api/items").then(parseItem);');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
});

test("client import closure follows shared and client re-exports for a matching URL", () => {
  const { write, violations } = fixture();
  write("client/items.ts", 'import { parseItem } from "./reexport"; export const loadItem = () => fetch("/api/items?cursor=next").then(parseItem);');
  write("client/reexport.ts", 'export { parseItem } from "@/shared/items/contract";');
  expect(violations()).toEqual([]);
});

test("a contract URL literal is not a client URL source", () => {
  const { write, codes } = fixture();
  write(contract, 'export const ITEM_VERSION = 1; export const parseItem = (value: unknown) => value; export const destination = "/api/items";');
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; export const decode = parseItem;');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  write("client/items.ts", 'import { ITEM_VERSION } from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items").then(() => ITEM_VERSION);');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items").then(parseItem);');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
});

test("a reason and a baseline become stale when a URL client links the contract", () => {
  const { manifest, codes } = fixture();
  manifest.routes[route]!.client = "Only the server can consume this response, never the browser.";
  manifest.baseline.clientUnlinked[route] = [contract];
  expect(codes()).toContainEqual({ code: "client-reason-stale", path: route });
  expect(codes()).toContainEqual({ code: "baseline-stale", path: route });
});

test("dynamic paths match literal, placeholder, and template URLs with queries", () => {
  const { write, manifest, violations } = fixture();
  const dynamicRoute = "items/[id]/confirm/route.ts";
  write(`app/api/${dynamicRoute}`, 'import "@/shared/items/contract"; export const POST = () => new Response(null);');
  manifest.routes = { [dynamicRoute]: { contracts: [contract] }, [route]: manifest.routes[route]! };
  write("client/original.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/items");');
  for (const url of ['"/api/items/abc/confirm"', '"/api/items/:id/confirm?next=1"', '`/api/items/${id}/confirm#review`']) {
    write("client/items.ts", `import { parseItem } from "@/shared/items/contract"; export const loadItem = (id: string) => fetch(${url}).then(parseItem);`);
    expect(violations()).toEqual([]);
  }
});

test("a trailing-slash client URL still reaches the route", () => {
  const { write, manifest, codes } = fixture();
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; export const loadItem = () => fetch("/api/items/?cursor=next").then(parseItem);');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
  write("client/items.ts", 'export const loadItem = () => fetch("/api/items/");');
  manifest.routes[route]!.client = "Only a server-rendered page consumes this response.";
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
});

test("a prefix URL cannot link a longer route and a longer URL cannot link a prefix route", () => {
  const { write, manifest, codes } = fixture();
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/items/prepare");');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  const longer = "items/prepare/route.ts";
  write(`app/api/${longer}`, 'import "@/shared/items/contract"; export const GET = () => new Response(null);');
  manifest.routes[longer] = { contracts: [contract] };
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/items");');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: longer });
});

test("route groups are omitted from public URLs when linking a client", () => {
  const { root, write, manifest, codes } = fixture();
  rmSync(join(root, `app/api/${route}`));
  delete manifest.routes[route];
  const grouped = "(internal)/items/route.ts";
  write(`app/api/${grouped}`, 'import { parseItem } from "@/shared/items/contract"; export const GET = () => parseItem({ version: 1 });');
  manifest.routes[grouped] = { contracts: [contract] };
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: grouped });
});

test("catch-all routes require at least one segment", () => {
  const { write, manifest, codes } = fixture();
  const catchAll = "items/[...path]/route.ts";
  write(`app/api/${catchAll}`, 'import "@/shared/items/contract"; export const GET = () => new Response(null);');
  manifest.routes[catchAll] = { contracts: [contract] };
  expect(codes()).toContainEqual({ code: "client-unlinked", path: catchAll });
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/items/a/b?value=1");');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: catchAll });
});

test("type-only parser exports do not qualify as callable parsers", () => {
  const { write, codes } = fixture();
  for (const source of ['export type { parseItem } from "./parser";', 'export type parseItem = (value: unknown) => value;']) {
    write(contract, `export const ITEM_VERSION = 1; ${source}`);
    expect(codes()).toContainEqual({ code: "contract-parserless", path: contract });
  }
});

test("a non-callable exported parser name does not qualify", () => {
  const { write, codes } = fixture();
  write(contract, "export const ITEM_VERSION = 1; export const parseItem = 1;");
  expect(codes()).toContainEqual({ code: "contract-parserless", path: contract });
});

test("ambient parser declarations without an implementation do not qualify", () => {
  const { write, codes } = fixture();
  for (const source of [
    "export const ITEM_VERSION = 1; export declare function parseItem(value: unknown): unknown;",
    "export const ITEM_VERSION = 1; export declare const parseItem: (value: unknown) => unknown;",
    "export const ITEM_VERSION = 1; export function parseItem(value: unknown): unknown;",
    "export const ITEM_VERSION = 1; export default function parseItem(value: unknown): unknown;",
  ]) {
    write(contract, source);
    expect(codes()).toContainEqual({ code: "contract-parserless", path: contract });
  }
  write(contract, "export const ITEM_VERSION = 1; export function parseItem(value: unknown): unknown; export function parseItem(value: unknown) { return value; }");
  expect(codes()).not.toContainEqual({ code: "contract-parserless", path: contract });
});

test("an ambient default parser declaration does not qualify", () => {
  const { write, manifest, codes } = fixture();
  const declared = "shared/items/declared-contract.d.ts";
  write(declared, "export const ITEM_VERSION = 1; export default function parseItem(value: unknown): unknown;");
  manifest.routes[route]!.contracts!.push(declared);
  manifest.routes[route]!.contracts!.sort();
  expect(codes()).toContainEqual({ code: "contract-parserless", path: declared });
});

test("version declarations need a literal initializer, not an identifier or call", () => {
  const { write, codes } = fixture();
  for (const source of [
    "export const ITEM_VERSION = readVersion();",
    "export const ITEM_VERSION = OTHER_VERSION;",
    "export let ITEM_VERSION;",
    "export let ITEM_VERSION = 1;",
    "export let ITEM_VERSION = 1; ITEM_VERSION = Date.now();",
    "export var ITEM_VERSION = 1;",
    "export const ITEM_VERSION = z.number();",
  ]) {
    write(contract, `${source} export const parseItem = (value: unknown) => value;`);
    expect(codes()).toContainEqual({ code: "contract-unversioned", path: contract });
  }
  for (const source of ["export const ITEM_VERSION = 1;", "export const ITEM_VERSION = \"2\" as const;", "export const ITEM_VERSION = (3) satisfies number;"]) {
    write(contract, `${source} export const parseItem = (value: unknown) => value;`);
    expect(codes()).not.toContainEqual({ code: "contract-unversioned", path: contract });
  }
});

test("a route cannot satisfy its version with a non-literal version constant", () => {
  const { write, codes } = fixture();
  write(contract, "export const ITEM_VERSION = readVersion(); export const parseItem = (value: unknown) => value;");
  expect(codes()).toContainEqual({ code: "route-unversioned-parser", path: route });
});

test("version references resolve literal declarations through imports and re-exports", () => {
  const { write, violations } = fixture();
  write("shared/items/version.ts", "export const ITEM_VERSION = 1 as const;");
  write(contract, 'import { ITEM_VERSION } from "./version"; export type Item = { version: typeof ITEM_VERSION }; export const parseItem = (value: unknown) => value;');
  expect(violations()).toEqual([]);
  write("shared/items/version.ts", "export const ITEM_VERSION = readVersion();");
  expect(violations().map(({ code }) => code)).toContain("contract-unversioned");
});

test("call-expression parsers must resolve to a function-valued local factory", () => {
  const { write, codes } = fixture();
  for (const source of [
    "export const ITEM_VERSION = 1; export const parseItem = z.object({});",
    "export const ITEM_VERSION = 1; export const parseItem = buildParser();",
    "export const ITEM_VERSION = 1; export function makeParser() { return 1; } export const parseItem = makeParser();",
    "export const ITEM_VERSION = 1; export function makeParser() { return 1; } export function other() { return (value: unknown) => value; } export const parseItem = makeParser() || other;",
    "export const ITEM_VERSION = 1; export function makeParser(flag: boolean) { if (flag) return (value: unknown) => value; } export const parseItem = makeParser(true);",
    "export const ITEM_VERSION = 1; export async function makeParser() { return (value: unknown) => value; } export const parseItem = makeParser();",
    "export const ITEM_VERSION = 1; export function* makeParser() { yield (value: unknown) => value; } export const parseItem = makeParser();",
    "export const ITEM_VERSION = 1; export const parseItem = async (value: unknown) => value;",
    "export const ITEM_VERSION = 1; export const parseItem = function* () { yield 1; };",
  ]) {
    write(contract, source);
    expect(codes()).toContainEqual({ code: "contract-parserless", path: contract });
  }
  write(contract, "export const ITEM_VERSION = 1; export function makeParser() { return (value: unknown) => value; } export const parseItem = makeParser();");
  expect(codes()).not.toContainEqual({ code: "contract-parserless", path: contract });
  write(contract, "export const ITEM_VERSION = 1; export function makeParser(flag: boolean) { if (flag) { return (value: unknown) => value; } else { return (value: unknown) => value; } } export const parseItem = makeParser(true);");
  expect(codes()).not.toContainEqual({ code: "contract-parserless", path: contract });
});

test("nested declarations cannot supply a version token or parser for a module binding", () => {
  const { write, codes } = fixture();
  write(contract, 'export const ITEM_VERSION = readVersion(); export function outer() { const ITEM_VERSION = 1; return ITEM_VERSION; } export const parseItem = (value: unknown) => value;');
  expect(codes()).toContainEqual({ code: "contract-unversioned", path: contract });
  write(contract, 'export const ITEM_VERSION = 1; export function makeParser() { return 1; } export function outer() { function makeParser() { return (value: unknown) => value; } return makeParser; } export const parseItem = makeParser();');
  expect(codes()).toContainEqual({ code: "contract-parserless", path: contract });
});

test("a version property needs a contract-shaped exported declaration", () => {
  const { write, codes } = fixture();
  for (const source of [
    "function unused() { return { version: 1 }; }",
    "export function report() { return { version: 1 }; }",
    "export const report = () => ({ version: 1 });",
    "export const report = function () { return { version: 1 }; };",
    "export class Report { render() { return { version: 1 }; } }",
    "export const report = { meta: { version: 1 } };",
    "export const report = makeReport({ version: 1 });",
    "export type Keys = keyof { version: 1 };",
    "export type Item = { version: 1 } | { kind: \"error\" };",
    "export const report = { kind: \"error\" } satisfies { kind: string; version?: 1 };",
    "const ITEM_VERSION = 1; export const report = () => ({ version: ITEM_VERSION });",
  ]) {
    write(contract, `${source} export const parseItem = (value: unknown) => value;`);
    expect(codes()).toContainEqual({ code: "contract-unversioned", path: contract });
  }
  write(contract, "export type Item = { version: 1 }; export const parseItem = (value: unknown) => value;");
  expect(codes()).not.toContainEqual({ code: "contract-unversioned", path: contract });
  write(contract, 'export type Item = { kind: "ok" } & { version: 1 }; export const parseItem = (value: unknown) => value;');
  expect(codes()).not.toContainEqual({ code: "contract-unversioned", path: contract });
});

test("a shadowed version binding cannot certify a module", () => {
  const { write, codes } = fixture();
  write(contract, "const ITEM_VERSION = 1; export type Item = { version: typeof ITEM_VERSION }; export const parseItem = (value: unknown) => value;");
  expect(codes()).not.toContainEqual({ code: "contract-unversioned", path: contract });
  write(contract, "const ITEM_VERSION = 1; export function parseReport() { const ITEM_VERSION = Date.now(); return { version: ITEM_VERSION }; } export type Item = { version: typeof ITEM_VERSION }; export const parseItem = (value: unknown) => value;");
  expect(codes()).toContainEqual({ code: "contract-unversioned", path: contract });
  write(contract, "const ITEM_VERSION = 1; export function parseReport() { const { ITEM_VERSION } = { ITEM_VERSION: Date.now() }; return { version: ITEM_VERSION }; } export type Item = { version: typeof ITEM_VERSION }; export const parseItem = (value: unknown) => value;");
  expect(codes()).toContainEqual({ code: "contract-unversioned", path: contract });
});

test("a shadowed factory cannot provide a parser", () => {
  const { write, codes } = fixture();
  write(contract, "export const ITEM_VERSION = 1; export function makeParser() { return 1; } export function outer() { function makeParser() { return (value: unknown) => value; } return makeParser; } export const parseItem = outer();");
  expect(codes()).toContainEqual({ code: "contract-parserless", path: contract });
  write(contract, "export const ITEM_VERSION = 1; function actualParser(value: unknown) { return value; } export function makeParser(actualParser: number) { return actualParser; } export const parseItem = makeParser(actualParser.length);");
  expect(codes()).toContainEqual({ code: "contract-parserless", path: contract });
});

test("star and named value re-exports follow callable parsers and version tokens without cycles", () => {
  const { write, violations } = fixture();
  write(contract, 'export * from "./parser"; export { parseItem as readItem } from "./parser";');
  write("shared/items/parser.ts", 'export * from "./contract"; export const ITEM_VERSION = 1; export const parseItem = (value: unknown) => value;');
  expect(violations()).toEqual([]);
});

test("named alias re-exports resolve callable values and exported version tokens", () => {
  const { write, violations } = fixture();
  write(contract, 'export { decode as parseItem, ITEM_VERSION } from "@/shared/items/parser";');
  write("shared/items/parser.ts", "export const ITEM_VERSION = 1; export const decode = (value: unknown) => value;");
  expect(violations()).toEqual([]);
});

test("weak version properties do not qualify as version tokens", () => {
  const { write, codes } = fixture();
  for (const source of [
    "export type Item = { version: number };",
    "export const item = { version: someValue };",
    "export const item = { version: z.number() };",
    "export const item = { version: z.literal(getVersion()) };",
    "export type Item = { version: typeof ITEM_VERSION };",
    "export const item = { version: ITEM_VERSION };",
    "export const ITEM_VERSION = readVersion(); export const item = { version: ITEM_VERSION };",
    "export let ITEM_VERSION; export type Item = { version: typeof ITEM_VERSION };",
  ]) {
    write(contract, `${source} export const parseItem = (value: unknown) => value;`);
    expect(codes()).toContainEqual({ code: "contract-unversioned", path: contract });
  }
  for (const source of [
    "export type Item = { version: 1 };",
    "export const ITEM_VERSION = 1; export type Item = { version: typeof ITEM_VERSION };",
    "export const item = { version: 1 };",
    "export const ITEM_VERSION = 1; export const item = { version: ITEM_VERSION };",
    "export const ITEM_VERSION = 1; export const item = { version: z.literal(ITEM_VERSION) };",
    "export const item = { version: z.literal(1) };",
    "export const item = { version: 1 } satisfies { version: 1 };",
  ]) {
    write(contract, `${source} export const parseItem = (value: unknown) => value;`);
    expect(codes()).not.toContainEqual({ code: "contract-unversioned", path: contract });
  }
});

test("URLs embedded in another URL's query string do not link the embedded route", () => {
  const { write, codes } = fixture();
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/other?next=/api/items");');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
});

test("a route URL after an origin links, but not inside an origin query", () => {
  const { write, codes } = fixture();
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("https://home.example?next=/api/items");');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  for (const url of ['"https://home.example/api/items"', '`\u0024{origin}/api/items`']) {
    write("client/items.ts", `import { parseItem } from "@/shared/items/contract"; fetch(${url});`);
    expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
  }
});

test("a static route takes precedence over a dynamic route for a literal URL", () => {
  const { write, manifest, codes } = fixture();
  const dynamic = "items/[id]/route.ts";
  const staticRoute = "items/search/route.ts";
  for (const path of [dynamic, staticRoute]) {
    write(`app/api/${path}`, 'import "@/shared/items/contract"; export const GET = () => new Response(null);');
    manifest.routes[path] = { contracts: [contract] };
  }
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/items/search");');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: dynamic });
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: staticRoute });
});

test("accepts status exemptions but rejects unknown exemption kinds", () => {
  const { manifest, violations, codes } = fixture();
  manifest.routes[route] = { exempt: { kind: "status", reason: "The client only checks response status without parsing a body." } };
  expect(violations()).toEqual([]);
  manifest.routes[route]!.exempt!.kind = "unknown";
  expect(codes()).toContainEqual({ code: "exempt-invalid", path: route });
});

test("a new route cannot pair a compliant contract with a baselined weak contract", () => {
  const { write, manifest, codes } = fixture();
  write(contract, "export function parseItem(value: unknown) { return value; }");
  manifest.baseline.unversionedContracts.push(contract);
  manifest.baseline.routesWithoutVersionedParser[route] = [contract];
  const compliant = "shared/other/contract.ts";
  write(compliant, "export const OTHER_VERSION = 1; export const parseOther = (value: unknown) => value;");
  write("app/api/extra/route.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const GET = () => parseOther(parseItem({}));');
  manifest.routes["extra/route.ts"] = { contracts: [contract, compliant] };
  expect(codes()).toContainEqual({ code: "route-unversioned-parser", path: "extra/route.ts" });
});

test("javascript and jsx clients participate in linkage discovery", () => {
  for (const file of ["client/legacy.js", "components/legacy.jsx"]) {
    const { write, codes } = fixture();
    write("client/items.ts", "export const unused = 1;");
    write(file, 'import { parseItem } from "@/shared/items/contract"; export const load = () => fetch("/api/items").then(parseItem);');
    expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
  }
});

test("a javascript route resolves a javascript handler module", () => {
  const { write, manifest, codes } = fixture();
  const legacy = "legacy/route.js";
  write(`app/api/${legacy}`, 'import { handle } from "./handler.js"; export const GET = handle;');
  write("app/api/legacy/handler.js", 'import { parseItem } from "@/shared/items/contract"; export const handle = () => parseItem({});');
  manifest.routes[legacy] = { contracts: [contract] };
  write("client/legacy.ts", 'import { parseItem } from "@/shared/items/contract"; export const load = () => fetch("/api/legacy").then(parseItem);');
  expect(codes()).toEqual([]);
});

test("optional catch-all routes match zero or more segments", () => {
  const { root, write, manifest, codes } = fixture();
  rmSync(join(root, `app/api/${route}`));
  delete manifest.routes[route];
  const optional = "items/[[...path]]/route.ts";
  write(`app/api/${optional}`, 'import "@/shared/items/contract"; export const GET = () => new Response(null);');
  manifest.routes[optional] = { contracts: [contract] };
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/items");');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: optional });
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/items/a/b");');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: optional });
});

test("a client URL that keeps a route group does not link the grouped route", () => {
  const { root, write, manifest, codes } = fixture();
  rmSync(join(root, `app/api/${route}`));
  delete manifest.routes[route];
  const grouped = "(internal)/items/route.ts";
  write(`app/api/${grouped}`, 'import { parseItem } from "@/shared/items/contract"; export const GET = () => parseItem({ version: 1 });');
  manifest.routes[grouped] = { contracts: [contract] };
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/(internal)/items");');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: grouped });
});

test("a client must import a parser for every declared contract", () => {
  const { write, manifest, codes } = fixture();
  const other = "shared/other/contract.ts";
  write(other, "export const OTHER_VERSION = 1; export const parseOther = (value: unknown) => value;");
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const GET = () => parseOther(parseItem({}));');
  manifest.routes[route] = { contracts: [contract, other] };
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; fetch("/api/items").then(parseItem);');
  expect(codes()).toContainEqual({ code: "client-unlinked", path: route });
  write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; fetch("/api/items").then((value) => parseOther(parseItem(value)));');
  expect(codes()).not.toContainEqual({ code: "client-unlinked", path: route });
});

test("a default-only parser re-export still qualifies as a parser", () => {
  const { write, violations } = fixture();
  write("shared/items/parser.ts", "export const parseItem = (value: unknown) => value;");
  write(contract, 'export const ITEM_VERSION = 1; export { parseItem as default } from "./parser";');
  write("client/items.ts", 'import parseItem from "@/shared/items/contract"; fetch("/api/items").then(parseItem);');
  expect(violations()).toEqual([]);
});
