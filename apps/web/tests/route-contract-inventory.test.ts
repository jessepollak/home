import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inventoryRouteContracts } from "./helpers/route-contract-inventory";

type Manifest = Parameters<typeof inventoryRouteContracts>[0]["manifest"];

function routeEntry(manifest: Manifest, path: string) {
  const entry = manifest.routes[path];
  if (!entry) throw new Error(`Fixture route is missing: ${path}`);
  return entry;
}
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
    baseline: { routesWithoutVersionedParser: {}, unversionedContracts: [], parserlessContracts: [], handlerUnlinked: {}, clientUnlinked: {}, undeclaredHandlerContracts: {} },
  };
  const violations = () => inventoryRouteContracts({ root, manifest });
  const codes = () => violations().map(({ code, path }) => ({ code, path }));
  return { root, write, manifest, violations, codes };
}

function mixedMethodFixture() {
  const result = fixture();
  const legacyContract = "shared/items/legacy-contract.ts";
  result.write(legacyContract, "export function parseLegacyItem(value: unknown) { return value; }");
  result.write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseLegacyItem } from "@/shared/items/legacy-contract"; export const GET = () => parseItem({ version: 1 }); export const POST = () => parseLegacyItem({});');
  result.write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseLegacyItem } from "@/shared/items/legacy-contract"; export const loadItem = () => fetch("/api/items").then(parseItem); export const createItem = () => fetch("/api/items", { method: "POST" }).then(parseLegacyItem);');
  const methods: Record<"GET" | "POST", { contracts: string[]; allowance?: { kind: string; reason: string } }> = {
    GET: { contracts: [contract] },
    POST: { contracts: [legacyContract] },
  };
  result.manifest.routes[route] = { contracts: [contract, legacyContract], methods };
  result.manifest.baseline.unversionedContracts.push(legacyContract);
  return { ...result, methods };
}

const otherContract = "shared/other/contract.ts";
const undeclaredViolation = { code: "handler-contract-undeclared", path: route, detail: `GET references an undeclared contract: ${otherContract}` };

function undeclaredFixture() {
  const result = fixture();
  result.write(otherContract, "export const OTHER_VERSION = 1; export const parseOther = (value: unknown) => value;");
  result.write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const GET = () => parseOther(parseItem({ version: 1 }));');
  const register = () => {
    routeEntry(result.manifest, route).contracts = [contract, otherContract];
    result.write("client/items.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const loadItem = () => fetch("/api/items").then((value) => parseOther(parseItem(value)));');
  };
  return { ...result, register };
}

function methodGapFixture() {
  const result = undeclaredFixture();
  result.write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const GET = () => parseOther(parseItem({})); export const POST = () => parseOther(parseItem({}));');
  routeEntry(result.manifest, route).contracts = [contract];
  routeEntry(result.manifest, route).methods = { GET: { contracts: [contract] }, POST: { contracts: [contract] } };
  return result;
}

function namespaceHandlerFixture() {
  const result = undeclaredFixture();
  result.write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther(parseItem({})); export const nested = { handle }; export const createHandlers = () => ({ GET: () => parseOther(parseItem({})) });');
  return result;
}

function analysisBudgetFixture(localFunctions: number) {
  const result = undeclaredFixture();
  const declarations = Array.from({ length: localFunctions }, (_, index) => `function local${index}() {}`).join("\n");
  result.write(`app/api/${route}`, `import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const GET = () => { parseItem({}); ${declarations} function decode() { return parseOther({}); } return decode(); };`);
  return result;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("accepts a mapped versioned, parsed contract with both sides linked", () => {
  expect(fixture().violations()).toEqual([]);
});

test("rejects a referenced contract until the route declares it and the client links it", () => {
  const { violations, register } = undeclaredFixture();
  expect(violations()).toEqual([undeclaredViolation]);
  register();
  expect(violations()).toEqual([]);
});

test("reports an analysis limit instead of undeclared contracts above the function budget", () => {
  const { violations } = analysisBudgetFixture(1_000);
  expect(violations()).toEqual([{
    code: "handler-analysis-limit", path: route,
    detail: "GET handler reference scan exceeded its analysis budget",
  }]);
});

test("finds undeclared contracts below the function budget", () => {
  expect(analysisBudgetFixture(900).violations()).toEqual([undeclaredViolation]);
});

test("an analysis limit does not make a frozen handler contract gap stale", () => {
  const { manifest, violations } = analysisBudgetFixture(1_000);
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
  expect(violations()).toEqual([{
    code: "handler-analysis-limit", path: route,
    detail: "GET handler reference scan exceeded its analysis budget",
  }]);
});

test("removing a contract declaration and method binding does not hide the handler reference", () => {
  const { manifest, methods, violations } = mixedMethodFixture();
  methods.POST.allowance = { kind: "unversioned-compatibility", reason: "POST preserves the legacy unversioned response while existing clients migrate." };
  routeEntry(manifest, route).contracts = [contract];
  methods.POST.contracts = [];
  expect(violations()).toEqual([{
    code: "handler-contract-undeclared", path: route,
    detail: "POST references an undeclared contract: shared/items/legacy-contract.ts",
  }]);
});

test("a contract bound only to another method remains undeclared for the referencing method", () => {
  const { manifest, violations } = undeclaredFixture();
  routeEntry(manifest, route).contracts = [contract, otherContract];
  routeEntry(manifest, route).methods = { GET: { contracts: [contract] }, POST: { contracts: [otherContract] } };
  expect(violations()).toContainEqual(undeclaredViolation);
});

test("tolerates a frozen handler contract gap", () => {
  const { manifest, violations } = undeclaredFixture();
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
  expect(violations()).toEqual([]);
});

test("a frozen handler contract gap covers only its method", () => {
  const { manifest, violations } = methodGapFixture();
  manifest.baseline.undeclaredHandlerContracts[route] = [`GET ${otherContract}`];
  expect(violations()).toEqual([{
    code: "handler-contract-undeclared", path: route,
    detail: `POST references an undeclared contract: ${otherContract}`,
  }]);
});

test("method-qualified frozen handler contract gaps stay valid", () => {
  const { manifest, violations } = methodGapFixture();
  manifest.baseline.undeclaredHandlerContracts[route] = [`GET ${otherContract}`, `POST ${otherContract}`];
  expect(violations()).toEqual([]);
});

test("a method-qualified handler contract baseline becomes stale when its method stops referencing", () => {
  const { write, manifest, violations } = methodGapFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const GET = () => parseItem({}); export const POST = () => parseOther(parseItem({}));');
  manifest.baseline.undeclaredHandlerContracts[route] = [`GET ${otherContract}`, `POST ${otherContract}`];
  expect(violations()).toEqual([{
    code: "baseline-stale", path: route,
    detail: `Handler contract gap no longer applies: GET ${otherContract}`,
  }]);
});

for (const resolution of ["declared", "reference removed", "route removed", "route exempted"] as const) {
  test(`a handler contract baseline becomes stale when ${resolution}`, () => {
    const { root, write, manifest, violations, register } = undeclaredFixture();
    manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
    if (resolution === "declared") register();
    if (resolution === "reference removed") write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; export const GET = () => parseItem({ version: 1 });');
    if (resolution === "route removed") {
      rmSync(join(root, `app/api/${route}`));
      delete manifest.routes[route];
    }
    if (resolution === "route exempted") manifest.routes[route] = { exempt: documentExemption };
    expect(violations()).toContainEqual({ code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}` });
  });
}

test("an empty handler contract baseline entry is stale", () => {
  const { manifest, violations } = fixture();
  manifest.baseline.undeclaredHandlerContracts[route] = [];
  expect(violations()).toEqual([{
    code: "baseline-stale", path: route, detail: "Handler contract gap no longer applies",
  }]);
});

test("a removed-route handler contract baseline key is stale", () => {
  const { manifest, violations } = fixture();
  const removed = "removed/route.ts";
  manifest.baseline.undeclaredHandlerContracts[removed] = [otherContract];
  expect(violations()).toEqual([
    { code: "baseline-stale", path: removed, detail: "Handler contract gap no longer applies" },
    { code: "baseline-stale", path: removed, detail: `Handler contract gap no longer applies: ${otherContract}` },
  ]);
});

test("exempt routes do not need to declare referenced contracts", () => {
  const { manifest, violations } = undeclaredFixture();
  manifest.routes[route] = { exempt: documentExemption };
  expect(violations()).toEqual([]);
});

for (const [name, source] of [
  ["function declaration", 'export function GET() { return parseOther({}); }'],
  ["contract identifier", 'export const GET = parseOther;'],
  ["contract local alias", 'const handle = parseOther; export const GET = handle;'],
  ["body value alias", 'const decode = parseOther; export const GET = () => decode(parseItem({}));'],
  ["body value alias chain", 'const decode = parseOther; const alias = decode; export const GET = () => alias(parseItem({}));'],
  ["cyclic value aliases", 'const first = second; const second = first; export const GET = () => { first(); return parseOther({}); };'],
  ["parameter default", 'export const GET = (request = parseOther({})) => parseItem(request);'],
  ["nested binding default", 'export const GET = ({ nested: { value = parseOther({}) } = {} } = {}) => parseItem(value);'],
  ["binding value default", 'export const GET = ({ decode = parseOther } = {}) => parseItem(decode);'],
  ["local function call", 'const decode = () => parseOther({}); export const GET = () => decode();'],
  ["local declaration call", 'function decode() { return parseOther({}); } export const GET = () => decode();'],
  ["local export alias", 'const handle = () => parseOther({}); export { handle as GET };'],
  ["factory arguments", 'export const GET = createHandler(() => parseOther({}));'],
  ["local factory", 'function createLocal() { return () => parseOther({}); } export const GET = createLocal();'],
  ["namespace binding", 'import * as other from "@/shared/other/contract"; export const GET = () => other.parseOther({});'],
  ["cyclic local calls", 'function first() { second(); return parseOther({}); } function second() { first(); } export const GET = () => first();'],
] as const) {
  test(`finds undeclared contracts through a ${name}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, `import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; import { createHandler } from "./factory"; ${source}`);
    write("app/api/items/factory.ts", "export const createHandler = (handler: unknown) => handler;");
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

for (const [name, source] of [
  ["string literal", 'const other = await import("@/shared/other/contract"); return other.parseOther(parseItem({ version: 1 }));'],
  ["no-substitution template literal", "const other = await import(`@/shared/other/contract`); return other.parseOther(parseItem({ version: 1 }));"],
  ["import options", 'const other = await import("@/shared/other/contract", {}); return other.parseOther(parseItem({ version: 1 }));'],
  ["parenthesized string literal", 'const other = await import(("@/shared/other/contract")); return other.parseOther(parseItem({ version: 1 }));'],
  ["parenthesized template literal with options", "const other = await import((`@/shared/other/contract`), {}); return other.parseOther(parseItem({ version: 1 }));"],
] as const) {
  test(`finds undeclared contracts reached through a dynamic import with a ${name}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, `import { parseItem } from "@/shared/items/contract"; export const GET = async () => { ${source} };`);
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

test("links a declared contract imported through a dynamic import", () => {
  const { write, violations } = fixture();
  write(`app/api/${route}`, 'export const GET = async () => { const { parseItem } = await import((`@/shared/items/contract`), {}); return parseItem({ version: 1 }); };');
  expect(violations()).toEqual([]);
});

for (const source of [
  'import { handle as GET } from "./handler"; export { GET };',
  'export { handle as GET } from "./handler";',
  'export * from "./barrel";',
  'import { createHandler } from "./barrel"; export const GET = createHandler();',
  'import { createHandlers } from "./handler"; export const { GET } = createHandlers();',
  'import { handle } from "./handler"; export function GET(request: Request) { return handle(request); }',
  'import { handle } from "./handler"; const delegate = () => handle(); export const GET = () => delegate();',
  'import { GET as handle } from "./barrel"; export const GET = () => handle();',
]) {
  test(`resolves an imported implementation: ${source}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, source);
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther(parseItem({})); export const createHandler = () => handle; export const createHandlers = () => ({ GET: handle });');
    write("app/api/items/barrel.ts", 'export { handle as GET, createHandler } from "./handler";');
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

for (const [name, handler] of [
  ["named default function", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export default function handle() { return parseOther(parseItem({})); }'],
  ["anonymous default arrow", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export default () => parseOther(parseItem({}));'],
  ["default identifier", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; const handle = () => parseOther(parseItem({})); export default handle;'],
] as const) {
  test(`finds undeclared contracts through a ${name} re-exported as a route method`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, 'export { default as GET } from "./handler";');
    write("app/api/items/handler.ts", handler);
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

test("finds undeclared contracts through a default-imported handler", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import handle from "./handler"; export const GET = handle;');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export default () => parseOther(parseItem({}));');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("finds undeclared contracts through a named default export", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'export { default as GET } from "./handler";');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; const handle = () => parseOther(parseItem({})); export { handle as default };');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("accepts a registered default-exported handler", () => {
  const { write, register, violations } = undeclaredFixture();
  register();
  write(`app/api/${route}`, 'export { default as GET } from "./handler";');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export default function handle() { return parseOther(parseItem({})); }');
  expect(violations()).toEqual([]);
});

for (const [name, source] of [
  ["exported call", 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; export const GET = withAuth(handle);'],
  ["handler-body call", 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; export const GET = () => withAuth(handle)();'],
  ["returned call", 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; export function GET() { return withAuth(handle)(); }'],
  ["default-imported callback", 'import { withAuth } from "./wrapper"; import handle from "./handler"; export const GET = withAuth(handle);'],
] as const) {
  test(`finds undeclared contracts through a wrapped imported callback: ${name}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, source);
    write("app/api/items/wrapper.ts", "export const withAuth = (callback: () => unknown) => callback;");
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther(parseItem({})); export default handle;');
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

test("accepts a registered wrapped imported callback", () => {
  const { write, register, violations } = undeclaredFixture();
  register();
  write(`app/api/${route}`, 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; export const GET = withAuth(handle);');
  write("app/api/items/wrapper.ts", "export const withAuth = (callback: () => unknown) => callback;");
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther(parseItem({}));');
  expect(violations()).toEqual([]);
});

for (const [name, source] of [
  ["namespace member", 'import { withAuth } from "./wrapper"; import * as handlers from "./handler"; export const GET = withAuth(handlers.handle);'],
  ["module alias", 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; const delegate = handle; export const GET = withAuth(delegate);'],
  ["body namespace member", 'import { withAuth } from "./wrapper"; import * as handlers from "./handler"; export const GET = () => withAuth(handlers.handle)();'],
  ["body alias", 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; export const GET = () => { const delegate = handle; return withAuth(delegate)(); };'],
] as const) {
  test(`finds undeclared contracts through a wrapped ${name} callback`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, source);
    write("app/api/items/wrapper.ts", "export const withAuth = (callback: () => unknown) => callback;");
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther(parseItem({}));');
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

test("a shadowed callback argument is not followed", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; import { parseItem } from "@/shared/items/contract"; export const GET = () => { const handle = () => parseItem({}); return withAuth(handle)(); };');
  write("app/api/items/wrapper.ts", "export const withAuth = (callback: () => unknown) => callback;");
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther(parseItem({}));');
  expect(violations()).toEqual([]);
});

test("a parameter callback argument is not followed", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { withAuth } from "./wrapper"; import { parseItem } from "@/shared/items/contract"; export const GET = (delegate: () => unknown) => { parseItem({}); return withAuth(delegate)(); };');
  write("app/api/items/wrapper.ts", "export const withAuth = (callback: () => unknown) => callback;");
  expect(violations()).toEqual([]);
});

test("a consumed factory call does not follow its callback argument", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; import { handle } from "./consumer"; export const GET = () => handlers.create(handle).read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; export const create = (write: () => unknown) => ({ read: () => parseItem({}), write });');
  write("app/api/items/consumer.ts", 'import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther({});');
  expect(violations()).toEqual([]);
});

test("a frozen consumed factory callback gap is stale", () => {
  const { write, manifest, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; import { handle } from "./consumer"; export const GET = () => handlers.create(handle).read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; export const create = (write: () => unknown) => ({ read: () => parseItem({}), write });');
  write("app/api/items/consumer.ts", 'import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther({});');
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
  expect(violations()).toEqual([{
    code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}`,
  }]);
});

for (const [name, source] of [
  ["inline arrow", 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; export const GET = withAuth(() => handle());'],
  ["module arrow", 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; const local = () => handle(); export const GET = withAuth(local);'],
  ["module function", 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; function local() { return handle(); } export const GET = withAuth(local);'],
  ["later direct call", 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; const local = () => handle(); export const GET = () => { withAuth(local); return local(); };'],
  ["local object member", 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; const handlers = { local: () => handle() }; export const GET = withAuth(handlers.local);'],
] as const) {
  test(`finds undeclared contracts through a local callback passed to a wrapper: ${name}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, source);
    write("app/api/items/wrapper.ts", "export const withAuth = (callback: () => unknown) => callback;");
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther(parseItem({}));');
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

test("a frozen local callback gap stays valid", () => {
  const { write, manifest, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { withAuth } from "./wrapper"; import { handle } from "./handler"; export const GET = withAuth(() => handle());');
  write("app/api/items/wrapper.ts", "export const withAuth = (callback: () => unknown) => callback;");
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther(parseItem({}));');
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
  expect(violations()).toEqual([]);
});

for (const [name, body] of [
  ["member call first", 'export const GET = () => { handlers.local(); return withAuth(local)(); };'],
  ["wrapper call first", 'export const GET = () => { const result = withAuth(local)(); handlers.local(); return result; };'],
] as const) {
  test(`finds undeclared contracts regardless of scan order: ${name}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, `import { withAuth } from "./wrapper"; import { handle } from "./handler"; const local = () => handle(); const handlers = { local }; ${body}`);
    write("app/api/items/wrapper.ts", "export const withAuth = (callback: () => unknown) => callback;");
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther(parseItem({}));');
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

for (const [name, body] of [
  ["member call first", 'export const GET = () => { handlers.local(); return withAuth(local)(); };'],
  ["wrapper call first", 'export const GET = () => { const result = withAuth(local)(); handlers.local(); return result; };'],
] as const) {
  test(`a frozen gap stays valid regardless of scan order: ${name}`, () => {
    const { write, manifest, violations } = undeclaredFixture();
    write(`app/api/${route}`, `import { withAuth } from "./wrapper"; import { handle } from "./handler"; const local = () => handle(); const handlers = { local }; ${body}`);
    write("app/api/items/wrapper.ts", "export const withAuth = (callback: () => unknown) => callback;");
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther(parseItem({}));');
    manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
    expect(violations()).toEqual([]);
  });
}

for (const [name, source] of [
  ["exported member", "export const GET = handlers.handle;"],
  ["local handler call", "export const GET = () => handlers.handle();"],
  ["local export alias", "const GET = handlers.handle; export { GET };"],
  ["nested member", "export const GET = handlers.nested.handle;"],
  ["factory member", "export const GET = handlers.createHandlers().GET;"],
] as const) {
  test(`finds undeclared contracts through a namespace ${name}`, () => {
    const { write, violations } = namespaceHandlerFixture();
    write(`app/api/${route}`, `import * as handlers from "./handler"; ${source}`);
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

for (const source of [
  "export const GET = () => handlers.create().read();",
  'export const GET = () => handlers["create"]().read();',
  "export const GET = () => handlers.nested.create().read();",
  "const api = handlers.create(); export const GET = () => api.read();",
]) {
  test(`a resolved namespace factory member call excludes its unused sibling: ${source}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, `import * as handlers from "./handler"; ${source}`);
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const create = () => ({ read: () => parseItem({}), write: () => parseOther({}) }); export const nested = { create };');
    expect(violations()).toEqual([]);
  });
}

for (const source of [
  "export const GET = () => handlers.create().read();",
  'export const GET = () => handlers["create"]().read();',
  "export const GET = () => handlers.nested.create().read();",
  "const api = handlers.create(); export const GET = () => api.read();",
]) {
  test(`finds an eagerly executed factory contract: ${source}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, `import * as handlers from "./handler"; ${source}`);
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export function create() { parseOther({}); return { read: () => parseItem({}) }; } export const nested = { create };');
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

test("a frozen eager factory contract gap stays valid", () => {
  const { write, manifest, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export function create() { parseOther({}); return { read: () => parseItem({}) }; } export const nested = { create };');
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
  expect(violations()).toEqual([]);
});

test("finds an eagerly executed factory parameter default", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export function create(value = parseOther({})) { return { read: () => parseItem(value) }; }');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("a deferred factory sibling stays excluded", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const create = () => ({ read: () => parseItem({}), write: () => parseOther({}) });');
  expect(violations()).toEqual([]);
});

test("a deferred sibling bound to a local const stays excluded", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; const write = () => parseOther({}); export function create() { return { read: () => parseItem({}), write }; }');
  expect(violations()).toEqual([]);
});

test("a frozen deferred sibling bound to a local const stays valid", () => {
  const { write, manifest, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; const write = () => parseOther({}); export function create() { return { read: () => parseItem({}), write }; }');
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
  expect(violations()).toEqual([{
    code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}`,
  }]);
});

test("finds a contract in an eagerly invoked local helper", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; function helper() { parseOther({}); } export function create() { helper(); return { read: () => parseItem({}) }; }');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("finds a contract through a wrapped callee", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; function helper() { parseOther({}); } export function create() { (helper)(); return { read: () => parseItem({}) }; }');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("finds a contract through a module-level alias invoked after a reference", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; const helper = () => parseOther({}); const alias = helper; export function create() { void alias; alias(); return { read: () => parseItem({}) }; }');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("finds a contract through a wrapped module-level alias", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; function helper() { parseOther({}); } const alias = (helper); export function create() { alias(); return { read: () => parseItem({}) }; }');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("a frozen alias-chain gap stays valid when the alias is invoked", () => {
  const { write, manifest, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; const helper = () => parseOther({}); const alias = helper; export function create() { void alias; alias(); return { read: () => parseItem({}) }; }');
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
  expect(violations()).toEqual([]);
});

test("a module-level alias that is never invoked stays excluded", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = () => handlers.create().read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; const helper = () => parseOther({}); const alias = helper; export function create() { void alias; return { read: () => parseItem({}) }; }');
  expect(violations()).toEqual([]);
});

test("finds an undeclared contract called through a factory member call", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import * as handlers from "./handler"; export const GET = () => { parseItem({}); return handlers.create().read(); };');
  write("app/api/items/handler.ts", 'import { parseOther } from "@/shared/other/contract"; export const create = () => ({ read: () => parseOther({}), write: () => ({}) });');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("finds an undeclared contract passed to a resolved factory call", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseOther } from "@/shared/other/contract"; import * as handlers from "./handler"; export const GET = () => handlers.create(parseOther({})).read();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; export const create = (value: unknown) => ({ read: () => parseItem(value), write: () => ({}) });');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("a namespace element factory call excludes its unused sibling", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = handlers["create"]().read;');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const create = () => ({ read: () => parseItem({}), write: () => parseOther({}) });');
  expect(violations()).toEqual([]);
});

test("a namespace nested element factory call excludes its unused sibling", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = handlers["nested"]["create"]().read;');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const create = () => ({ read: () => parseItem({}), write: () => parseOther({}) }); export const nested = { create };');
  expect(violations()).toEqual([]);
});

test("a frozen element factory sibling contract is stale when only its sibling is selected", () => {
  const { write, manifest, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = handlers["create"]().read;');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const create = () => ({ read: () => parseItem({}), write: () => parseOther({}) });');
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
  expect(violations()).toEqual([{
    code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}`,
  }]);
});

test("a namespace property factory call excludes its unused sibling", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = handlers.create().read;');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const create = () => ({ read: () => parseItem({}), write: () => parseOther({}) });');
  expect(violations()).toEqual([]);
});

test("finds an undeclared contract called through an element factory member", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import * as handlers from "./handler"; export const GET = () => { parseItem({}); return handlers["create"]().read(); };');
  write("app/api/items/handler.ts", 'import { parseOther } from "@/shared/other/contract"; export const create = () => ({ read: () => parseOther({}), write: () => ({}) });');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("a namespace nested member excludes its unused sibling", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = handlers.nested.read;');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const nested = { read: () => parseItem({}), write: () => parseOther({}) };');
  expect(violations()).toEqual([]);
});

test("a namespace element receiver excludes its unused sibling", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = handlers["nested"].read;');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const nested = { read: () => parseItem({}), write: () => parseOther({}) };');
  expect(violations()).toEqual([]);
});

test("finds an undeclared contract called through a nested namespace member", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import * as handlers from "./handler"; export const GET = () => { parseItem({}); return handlers.nested.read(); };');
  write("app/api/items/handler.ts", 'import { parseOther } from "@/shared/other/contract"; export const nested = { read: () => parseOther({}), write: () => ({}) };');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("a frozen nested member call gap stays valid", () => {
  const { write, manifest, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import * as handlers from "./handler"; export const GET = () => { parseItem({}); return handlers.nested.read(); };');
  write("app/api/items/handler.ts", 'import { parseOther } from "@/shared/other/contract"; export const nested = { read: () => parseOther({}), write: () => ({}) };');
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
  expect(violations()).toEqual([]);
});

test("a frozen sibling contract is stale when only its sibling is selected", () => {
  const { write, manifest, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = handlers.nested.read;');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const nested = { read: () => parseItem({}), write: () => parseOther({}) };');
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
  expect(violations()).toEqual([{
    code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}`,
  }]);
});

test("accepts registered contracts through a namespace exported member", () => {
  const { write, violations, register } = namespaceHandlerFixture();
  register();
  write(`app/api/${route}`, 'import * as handlers from "./handler"; export const GET = handlers.handle;');
  expect(violations()).toEqual([]);
});

test("finds an undeclared contract selected directly from a namespace", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import * as other from "@/shared/other/contract"; parseItem({}); export const GET = other.parseOther;');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("does not attribute imported contracts to a shadowed namespace", () => {
  const { write, violations } = namespaceHandlerFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import * as handlers from "./handler"; export const GET = () => { const handlers = { handle: () => ({}) }; parseItem({}); return handlers.handle(); };');
  expect(violations()).toEqual([]);
});

test("destructured factory exports attribute contracts to each exported method", () => {
  const { write, manifest, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { createHandlers } from "./handler"; export const { GET, PUT } = createHandlers();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export function createHandlers() { return { GET: () => parseItem({}), PUT: () => parseOther({}) }; }');
  routeEntry(manifest, route).methods = { GET: { contracts: [contract] }, PUT: { contracts: [contract] } };
  expect(violations()).toEqual([{ ...undeclaredViolation, detail: `PUT references an undeclared contract: ${otherContract}` }]);
});

test("accepts correctly declared destructured factory members including renamed bindings", () => {
  const { write, manifest, violations, register } = undeclaredFixture();
  register();
  write(`app/api/${route}`, 'import { createHandlers } from "./handler"; export const { read: GET, write: PUT } = createHandlers();');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const createHandlers = () => ({ read: () => parseItem({}), write: () => parseOther({}) });');
  routeEntry(manifest, route).methods = { GET: { contracts: [contract] }, PUT: { contracts: [otherContract] } };
  expect(violations()).toEqual([]);
});

for (const [name, source, handler] of [
  ["local const factory", 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers.GET;', 'export function createHandlers() { const GET = () => parseOther(parseItem({})); const PUT = () => parseItem({}); return { GET, PUT }; }'],
  ["imported object factory", 'import { handlers } from "./handler"; export const GET = handlers.read;', 'function createHandlers() { function decode() { return parseOther({}); } return { read: () => decode(parseItem({})), write: () => parseItem({}) }; } export const handlers = createHandlers();'],
  ["local object factory", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; function factory() { return { GET: () => parseOther(parseItem({})), PUT: () => ({}) }; } const handlers = factory(); export const GET = handlers.GET;', 'export const unused = () => parseItem({});'],
  ["unresolved factory member fallback", 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers.GET;', 'export function createHandlers() { const value = parseOther(parseItem({})); return dynamicallyCreate(value); }'],
] as const) {
  test(`finds undeclared contracts through a property-selected ${name}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, source);
    write("app/api/items/handler.ts", `import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; ${handler}`);
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

for (const frozen of [false, true]) {
  test(`spread-overridden factory handlers ${frozen ? "keep their frozen gap valid" : "report undeclared contracts"}`, () => {
    const { write, manifest, violations } = undeclaredFixture();
    write(`app/api/${route}`, 'import { createHandlers } from "./handler"; export const { GET } = createHandlers();');
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const createHandlers = () => ({ GET: () => parseItem({}), ...{ GET: () => parseOther(parseItem({})) } });');
    if (frozen) manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
    expect(violations()).toEqual(frozen ? [] : [undeclaredViolation]);
  });
}

for (const [name, members, undeclared] of [
  ["last direct property", 'GET: () => parseItem({}), GET: () => parseOther(parseItem({}))', true],
  ["resolved alias spread", 'GET: () => parseItem({}), ...overrides', true],
  ["spread without the selected property", 'GET: () => parseItem({}), ...{ PUT: () => parseOther({}) }', false],
  ["unresolved trailing spread", 'GET: () => parseItem({}), ...unknown(parseOther({}))', true],
  ["unresolved spread before the selected property", '...unknown(parseOther({})), GET: () => parseItem({})', false],
  ["resolved overwrite after an unresolved spread", 'GET: () => parseOther({}), ...unknown(), ...{ GET: () => parseItem({}) }', false],
] as const) {
  test(`factory member resolution respects a ${name}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers.GET;');
    write("app/api/items/handler.ts", `import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export function createHandlers() { const overrides = { GET: () => parseOther(parseItem({})) }; return { ${members} }; }`);
    expect(violations()).toEqual(undeclared ? [undeclaredViolation] : []);
  });
}

for (const [name, members, undeclared] of [
  ["string-literal computed overwrite", 'GET: () => parseItem({}), ["GET"]: () => parseOther({})', true],
  ["template-literal computed overwrite", 'GET: () => parseItem({}), [`GET`]: () => parseOther({})', true],
  ["nonmatching string-literal computed property", 'GET: () => parseItem({}), ["PUT"]: () => parseOther({})', false],
  ["nonmatching template-literal computed property", 'GET: () => parseItem({}), [`PUT`]: () => parseOther({})', false],
  ["nonmatching numeric-literal computed property", 'GET: () => parseItem({}), [1]: () => parseOther({})', false],
  ["definitive computed overwrite removing a gap", 'GET: () => parseOther({}), ["GET"]: () => parseItem({})', false],
  ["unknown trailing computed property", 'GET: () => parseItem({}), [method]: () => parseOther({})', true],
  ["literal computed overwrite inside a spread", 'GET: () => parseItem({}), ...{ ["GET"]: () => parseOther({}) }', true],
  ["nonmatching literal computed property inside a spread", 'GET: () => parseItem({}), ...{ [`PUT`]: () => parseOther({}) }', false],
  ["unknown computed property inside a spread", 'GET: () => parseItem({}), ...{ [method]: () => parseOther({}) }', true],
  ["unknown computed overwrite after a literal inside a spread", 'GET: () => parseItem({}), ...{ ["GET"]: () => parseItem({}), [method]: () => parseOther({}) }', true],
  ["definitive GET after an unknown computed property", 'GET: () => parseItem({}), [method]: () => parseOther({}), GET: () => parseItem({})', false],
  ["definitive GET after a spread with an unknown computed property", 'GET: () => parseItem({}), ...{ [method]: () => parseOther({}) }, GET: () => parseItem({})', false],
  ["definitive computed GET after an unknown computed property", '[method]: () => parseOther({}), [`GET`]: () => parseItem({})', false],
] as const) {
  for (const [selection, source] of [
    ["property-selected", 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers.GET;'],
    ["destructured", 'import { createHandlers } from "./handler"; export const { GET } = createHandlers();'],
  ] as const) {
    for (const frozen of [false, true]) {
      test(`${selection} factory handlers resolve a ${name} for a ${frozen ? "frozen" : "fresh"} gap`, () => {
        const { write, manifest, violations } = undeclaredFixture();
        write(`app/api/${route}`, source);
        write("app/api/items/handler.ts", `import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export function createHandlers() { const method: string = ["GET"].join(""); return { ${members} }; }`);
        if (frozen) manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
        expect(violations()).toEqual(frozen ? undeclared ? [] : [{
          code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}`,
        }] : undeclared ? [undeclaredViolation] : []);
      });
    }
  }
}

for (const [name, members, undeclared] of [
  ["getter then setter", 'get ["GET"]() { return () => parseOther({}); }, set ["GET"](value) {}', true],
  ["setter then getter", 'set ["GET"](value) {}, get ["GET"]() { return () => parseOther({}); }', true],
  ["spread getter then setter", 'GET: () => parseItem({}), ...{ get ["GET"]() { return () => parseOther({}); }, set ["GET"](value) {} }', true],
  ["spread setter then getter", 'GET: () => parseItem({}), ...{ set ["GET"](value) {}, get ["GET"]() { return () => parseOther({}); } }', true],
  ["data property replacing an accessor pair", 'get GET() { return () => parseOther({}); }, set GET(value) {}, GET: () => parseItem({})', false],
  ["accessor pair replacing a data property", 'GET: () => parseItem({}), get GET() { return () => parseOther({}); }, set GET(value) {}', true],
  ["method replacing an accessor pair", 'get GET() { return () => parseOther({}); }, set GET(value) {}, GET() { return parseItem({}); }', false],
  ["accessor pair replacing a method", 'GET() { return parseItem({}); }, get GET() { return () => parseOther({}); }, set GET(value) {}', true],
  ["data property between getter and setter", 'get GET() { return () => parseItem({}); }, GET: () => parseOther({}), set GET(value) {}', true],
  ["method between getter and setter", 'get GET() { return () => parseItem({}); }, GET() { return parseOther({}); }, set GET(value) {}', true],
  ["setter without a getter", 'set GET(value) {}, PUT: () => parseOther({})', true],
  ["setter body excluded from a getter pair", 'get GET() { return () => parseItem({}); }, set GET(value) { parseOther({}); }', false],
  ["later getter replacing the pair getter", 'get GET() { return () => parseOther({}); }, set GET(value) {}, get GET() { return () => parseItem({}); }', false],
  ["unrelated spread between getter and setter", 'get GET() { return () => parseOther({}); }, ...{ PUT: () => parseItem({}) }, set GET(value) {}', true],
  ["spread getter copied as data before a setter", '...{ get GET() { return () => parseItem({}); } }, set GET(value) { parseOther({}); }', true],
  ["unresolved spread between getter and setter", 'get GET() { return () => parseItem({}); }, ...unknown(parseOther({})), set GET(value) {}', true],
  ["unknown computed property between getter and setter", 'get GET() { return () => parseItem({}); }, [method]: () => parseOther({}), set GET(value) {}', true],
] as const) {
  for (const selection of ["direct", "property-selected", "destructured"] as const) {
    for (const frozen of [false, true]) {
      test(`${selection} handlers resolve a ${name} accessor descriptor for a ${frozen ? "frozen" : "fresh"} gap`, () => {
        const { write, manifest, violations } = undeclaredFixture();
        const definitions = 'const method: string = ["GET"].join("");';
        const imports = 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract";';
        if (selection === "direct") {
          write(`app/api/${route}`, `${imports} ${definitions} export const GET = ({ ${members} }).GET;`);
        } else {
          write(`app/api/${route}`, selection === "destructured"
            ? 'import { createHandlers } from "./handler"; export const { GET } = createHandlers();'
            : 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers.GET;');
          write("app/api/items/handler.ts", `${imports} export function createHandlers() { ${definitions} return { ${members} }; }`);
        }
        if (frozen) manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
        expect(violations()).toEqual(frozen ? undeclared ? [] : [{
          code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}`,
        }] : undeclared ? [undeclaredViolation] : []);
      });
    }
  }
}

for (const frozen of [false, true]) {
  test(`destructured numeric-literal computed members preserve a ${frozen ? "frozen" : "fresh"} gap`, () => {
    const { write, manifest, violations } = undeclaredFixture();
    write(`app/api/${route}`, 'import { createHandlers } from "./handler"; export const { "1": GET } = createHandlers();');
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const createHandlers = () => ({ "1": () => parseItem({}), [1]: () => parseOther({}) });');
    if (frozen) manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
    expect(violations()).toEqual(frozen ? [] : [undeclaredViolation]);
  });
}

for (const [name, members, undeclared] of [
  ["numeric data overwrite", '[1]: () => parseItem({}), 1: () => parseOther({})', true],
  ["canonical numeric data overwrite", '1: () => parseItem({}), 1.0: () => parseOther({})', true],
  ["canonical computed numeric overwrite", '"1": () => parseItem({}), [1.0]: () => parseOther({})', true],
  ["numeric getter overwrite", '[1]: () => parseItem({}), get 1.0() { return () => parseOther({}); }', true],
  ["canonical getter and setter pair", 'get [1]() { return () => parseOther({}); }, set 1.0(value) { parseItem(value); }', true],
  ["canonical setter and getter pair", 'set "1"(value) { parseItem(value); }, get 1.0() { return () => parseOther({}); }', true],
  ["numeric data spread overwrite", '[1]: () => parseItem({}), ...{ 1: () => parseOther({}) }', true],
  ["canonical numeric getter spread overwrite", '"1": () => parseItem({}), ...{ get 1.0() { return () => parseOther({}); }, set [1](value) {} }', true],
  ["numeric data overwrite removing a gap", '[1]: () => parseOther({}), 1.0: () => parseItem({})', false],
  ["computed numeric overwrite removing a gap", '1.0: () => parseOther({}), [1]: () => parseItem({})', false],
  ["numeric getter overwrite removing a gap", '[1]: () => parseOther({}), get 1() { return () => parseItem({}); }', false],
  ["numeric data replacing an accessor pair", 'get 1.0() { return () => parseOther({}); }, set "1"(value) {}, 1: () => parseItem({})', false],
  ["numeric data spread removing a gap", '[1]: () => parseOther({}), ...{ 1.0: () => parseItem({}) }', false],
  ["numeric getter spread removing a gap", '"1": () => parseOther({}), ...{ get [1.0]() { return () => parseItem({}); } }', false],
  ["distinct decimal string key", '1: () => parseItem({}), "1.0": () => parseOther({})', false],
  ["distinct computed decimal string key", '1.0: () => parseItem({}), ...{ ["1.0"]: () => parseOther({}) }', false],
] as const) {
  for (const [selection, source] of [
    ["direct numeric", '[1]'],
    ["direct decimal numeric", '[1.0]'],
    ["direct string", '["1"]'],
    ["property-selected numeric", 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers[1];'],
    ["property-selected decimal numeric", 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers[1.0];'],
    ["property-selected string", 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers["1"];'],
    ["destructured numeric", 'import { createHandlers } from "./handler"; export const { 1: GET } = createHandlers();'],
    ["destructured decimal numeric", 'import { createHandlers } from "./handler"; export const { 1.0: GET } = createHandlers();'],
    ["destructured string", 'import { createHandlers } from "./handler"; export const { "1": GET } = createHandlers();'],
  ] as const) {
    for (const frozen of [false, true]) {
      test(`${selection} handlers resolve a ${name} for a ${frozen ? "frozen" : "fresh"} gap`, () => {
        const { write, manifest, violations } = undeclaredFixture();
        const imports = 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract";';
        if (selection.startsWith("direct")) {
          write(`app/api/${route}`, `${imports} export const GET = ({ ${members} })${source};`);
        } else {
          write(`app/api/${route}`, source);
          write("app/api/items/handler.ts", `${imports} export const createHandlers = () => ({ ${members} });`);
        }
        if (frozen) manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
        expect(violations()).toEqual(frozen ? undeclared ? [] : [{
          code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}`,
        }] : undeclared ? [undeclaredViolation] : []);
      });
    }
  }
}

for (const [name, source, undeclared] of [
  ["literal decimal string", 'export const GET = ({ 1: () => parseItem({}), "1.0": () => parseOther({}) })["1.0"];', true],
  ["unknown element key", 'const key = unknown(); export const GET = ({ 1: () => parseItem({}), 2: () => parseOther({}) })[key];', true],
  ["nonliteral element key", 'export const GET = ({ 1: () => parseItem({}), 2: () => parseOther({}) })[1 + 1];', true],
  ["nonmatching numeric property", 'export const GET = ({ GET: () => parseItem({}), 1: () => parseOther({}) }).GET;', false],
] as const) {
  for (const frozen of [false, true]) {
    test(`numeric member resolution preserves a ${name} for a ${frozen ? "frozen" : "fresh"} gap`, () => {
      const { write, manifest, violations } = undeclaredFixture();
      write(`app/api/${route}`, `import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; ${source}`);
      if (frozen) manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
      expect(violations()).toEqual(frozen ? undeclared ? [] : [{
        code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}`,
      }] : undeclared ? [undeclaredViolation] : []);
    });
  }
}

for (const [name, body, undeclared] of [
  ["catch binding", 'try {} catch (parseOther) { return { GET: () => parseOther }; }', false],
  ["destructured catch binding", 'try {} catch ({ parseOther }) { return { GET: () => parseOther() }; }', false],
  ["for binding", 'for (let parseOther = () => ({}); true;) { return { GET: () => parseOther() }; }', false],
  ["for-of binding", 'for (const parseOther of []) { return { GET: () => parseOther() }; }', false],
  ["for-in binding", 'for (const parseOther in {}) { return { GET: () => parseOther }; }', false],
  ["hoisted var", 'return { GET: () => parseOther() }; if (true) { var parseOther = () => ({}); }', false],
  ["outer function hoisted var", 'function nested() { return { GET: () => parseOther() }; } return nested(); if (true) { var parseOther = () => ({}); }', false],
  ["unrelated nested function var", 'function nested() { var parseOther = () => ({}); } return { GET: () => parseOther({}) };', true],
  ["parameter default outside the body var scope", 'return { GET: (value = parseOther({})) => { if (true) { var parseOther = () => ({}); } return parseItem(value); } };', true],
  ["genuinely imported parser", 'return { GET: () => parseOther({}) };', true],
] as const) {
  test(`selected factory handlers recognize a ${name}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, 'import { createHandlers } from "./handler"; export const { GET } = createHandlers();');
    write("app/api/items/handler.ts", `import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export function createHandlers() { ${body} }`);
    expect(violations()).toEqual(undeclared ? [undeclaredViolation] : []);
  });
}

for (const [binding, body] of [
  ["loop binding", 'for (const parseOther = actualOther; true;) return { GET: () => parseOther(parseItem({})) };'],
  ["var loop binding", 'for (var parseOther = actualOther; true;) return { GET: () => parseOther(parseItem({})) };'],
  ["hoisted var", 'if (true) { var parseOther = actualOther; } return { GET: () => parseOther(parseItem({})) };'],
] as const) {
  for (const [selection, source] of [
    ["property-selected", 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers.GET;'],
    ["destructured", 'import { createHandlers } from "./handler"; export const { GET } = createHandlers();'],
  ] as const) {
    for (const frozen of [false, true]) {
      test(`${selection} factory handlers preserve ${binding} initializer provenance for a ${frozen ? "frozen" : "fresh"} gap`, () => {
        const { write, manifest, violations } = undeclaredFixture();
        write(`app/api/${route}`, source);
        write("app/api/items/handler.ts", `import { parseItem } from "@/shared/items/contract"; import { parseOther, parseOther as actualOther } from "@/shared/other/contract"; export function createHandlers() { ${body} }`);
        if (frozen) manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
        expect(violations()).toEqual(frozen ? [] : [undeclaredViolation]);
      });
    }
  }
}

for (const [binding, body] of [
  ["object loop binding", 'for (const { parseOther } = { parseOther: () => ({}), unused: actualOther }; true;) return { GET: () => parseOther(parseItem({})) };'],
  ["array loop binding", 'for (const [parseOther] = [() => ({}), actualOther]; true;) return { GET: () => parseOther(parseItem({})) };'],
  ["object var loop binding", 'for (var { parseOther } = { parseOther: () => ({}), unused: actualOther }; true;) return { GET: () => parseOther(parseItem({})) };'],
  ["array var loop binding", 'for (var [parseOther] = [() => ({}), actualOther]; true;) return { GET: () => parseOther(parseItem({})) };'],
  ["object hoisted var", 'if (true) { var { parseOther } = { parseOther: () => ({}), unused: actualOther }; } return { GET: () => parseOther(parseItem({})) };'],
  ["array hoisted var", 'if (true) { var [parseOther] = [() => ({}), actualOther]; } return { GET: () => parseOther(parseItem({})) };'],
  ["duplicate var loop initializer", 'for (var parseOther = actualOther, parseOther = () => ({}); true;) return { GET: () => parseOther(parseItem({})) };'],
  ["nested-block var redeclaration", 'for (var parseOther = actualOther; true;) { { var parseOther = () => ({}); } return { GET: () => parseOther(parseItem({})) }; }'],
  ["loop-body and nested-block var redeclarations", 'for (var parseOther = actualOther; true;) { var parseOther = actualOther; { var parseOther = () => ({}); } return { GET: () => parseOther(parseItem({})) }; }'],
  ["nested loop-block var redeclarations", 'for (var parseOther = actualOther; true;) { { var parseOther = actualOther; { var parseOther = () => ({}); } return { GET: () => parseOther(parseItem({})) }; } }'],
] as const) {
  for (const [selection, source] of [
    ["property-selected", 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers.GET;'],
    ["destructured", 'import { createHandlers } from "./handler"; export const { GET } = createHandlers();'],
  ] as const) {
    for (const frozen of [false, true]) {
      test(`${selection} factory handlers ignore unused initializer contracts in a ${binding} for a ${frozen ? "frozen" : "fresh"} gap`, () => {
        const { write, manifest, violations } = undeclaredFixture();
        write(`app/api/${route}`, source);
        write("app/api/items/handler.ts", `import { parseItem } from "@/shared/items/contract"; import { parseOther, parseOther as actualOther } from "@/shared/other/contract"; export function createHandlers() { ${body} }`);
        if (frozen) manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
        expect(violations()).toEqual(frozen ? [{
          code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}`,
        }] : []);
      });
    }
  }
}

for (const [binding, declarations, body, undeclared] of [
  ["switch-case const shadow", "", 'switch (1) { case 1: const parseOther = () => ({}); return { GET: () => parseOther(parseItem({})) }; }', false],
  ["switch-case function shadow", "", 'switch (1) { case 1: function parseOther() { return {}; } return { GET: () => parseOther(parseItem({})) }; }', false],
  ["switch-case class shadow", "", 'switch (1) { case 1: class parseOther {} return { GET: () => new parseOther() }; }', false],
  ["switch-case const alias", "", 'switch (1) { case 1: const parseOther = actualOther; return { GET: () => parseOther(parseItem({})) }; }', true],
  ["switch-case let alias across clauses", "", 'switch (1) { case 0: let parseOther = actualOther; case 1: return { GET: () => parseOther(parseItem({})) }; }', true],
  ["switch-case var alias", "", 'switch (1) { case 1: var parseOther = actualOther; return { GET: () => parseOther(parseItem({})) }; }', true],
  ["switch-case object binding", "", 'switch (1) { case 1: const { parseOther } = { parseOther: () => ({}), unused: actualOther }; return { GET: () => parseOther() }; }', false],
  ["switch-case array binding", "", 'switch (1) { case 1: const [parseOther] = [() => ({}), actualOther]; return { GET: () => parseOther() }; }', false],
  ["switch-case duplicate var", "", 'switch (1) { case 0: var parseOther = actualOther; case 1: var parseOther = () => ({}); return { GET: () => parseOther() }; }', false],
  ["module-scope var alias", 'var decode = actualOther;', 'return { GET: () => decode(parseItem({})) };', true],
  ["module-scope let alias", 'let decode = actualOther;', 'return { GET: () => decode(parseItem({})) };', true],
  ["module-block hoisted var alias", 'if (true) { var decode = actualOther; }', 'return { GET: () => decode(parseItem({})) };', true],
  ["module-loop var alias", 'for (var decode = actualOther; false;) {}', 'return { GET: () => decode(parseItem({})) };', true],
  ["module-scope let shadow", 'let parseOther = () => ({});', 'return { GET: () => parseOther(parseItem({})) };', false],
  ["module-scope var shadow", 'var parseOther = () => ({});', 'return { GET: () => parseOther(parseItem({})) };', false],
  ["module-block hoisted var shadow", 'if (true) { var parseOther = () => ({}); }', 'return { GET: () => parseOther(parseItem({})) };', false],
  ["module-scope object binding", 'const { parseOther } = { parseOther: () => ({}), unused: actualOther };', 'return { GET: () => parseOther() };', false],
  ["module-scope array binding", 'const [parseOther] = [() => ({}), actualOther];', 'return { GET: () => parseOther() };', false],
  ["module-block duplicate var", 'var parseOther = actualOther; if (true) { var parseOther = () => ({}); }', 'return { GET: () => parseOther() };', false],
  ["unrelated module function var", 'function unrelated() { var parseOther = () => ({}); }', 'return { GET: () => parseOther(parseItem({})) };', true],
] as const) {
  for (const [selection, source] of [
    ["property-selected", 'import { createHandlers } from "./handler"; const handlers = createHandlers(); export const GET = handlers.GET;'],
    ["destructured", 'import { createHandlers } from "./handler"; export const { GET } = createHandlers();'],
  ] as const) {
    for (const frozen of [false, true]) {
      test(`${selection} factory handlers resolve a ${binding} for a ${frozen ? "frozen" : "fresh"} gap`, () => {
        const { write, manifest, violations } = undeclaredFixture();
        write(`app/api/${route}`, source);
        write("app/api/items/handler.ts", `import { parseItem } from "@/shared/items/contract"; import { parseOther, parseOther as actualOther } from "@/shared/other/contract"; ${declarations} export function createHandlers() { ${body} }`);
        if (frozen) manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
        expect(violations()).toEqual(frozen ? undeclared ? [] : [{
          code: "baseline-stale", path: route, detail: `Handler contract gap no longer applies: ${otherContract}`,
        }] : undeclared ? [undeclaredViolation] : []);
      });
    }
  }
}

for (const [selection, source] of [
  ["direct", 'export const GET = () => decode(parseItem({}));'],
  ["property-selected factory", 'function createHandlers() { return { GET: () => decode(parseItem({})) }; } const handlers = createHandlers(); export const GET = handlers.GET;'],
  ["destructured factory", 'function createHandlers() { return { GET: () => decode(parseItem({})) }; } export const { GET } = createHandlers();'],
] as const) {
  for (const frozen of [false, true]) {
    test(`${selection} handlers resolve module-scope overload implementations for a ${frozen ? "frozen" : "fresh"} gap`, () => {
      const { write, manifest, violations } = undeclaredFixture();
      write(`app/api/${route}`, `import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; function decode(value: unknown): unknown; function decode(value: unknown) { return parseOther(value); } ${source}`);
      if (frozen) manifest.baseline.undeclaredHandlerContracts[route] = [otherContract];
      expect(violations()).toEqual(frozen ? [] : [undeclaredViolation]);
    });
  }
}

test("cyclic destructured members still analyze their terminal handler", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const { GET } = GET(() => parseOther(parseItem({})));');
  expect(violations()).toEqual([undeclaredViolation]);
});

test("route-local selected members do not follow imported infrastructure calls", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { infrastructure } from "@/server/infrastructure"; function factory() { return { GET: () => infrastructure(parseItem({})) }; } const handlers = factory(); export const GET = handlers.GET;');
  write("server/infrastructure.ts", 'import { parseOther } from "@/shared/other/contract"; export const infrastructure = (value: unknown) => parseOther(value);');
  expect(violations()).toEqual([]);
});

test("property selection does not attribute sibling members or follow imported infrastructure calls", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { handlers } from "./handler"; export const GET = handlers.read;');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; import { infrastructure } from "@/server/infrastructure"; function factory() { return { read: () => infrastructure(parseItem({})), write: () => parseOther({}) }; } export const handlers = factory();');
  write("server/infrastructure.ts", 'import { parseOther } from "@/shared/other/contract"; export const infrastructure = (value: unknown) => parseOther(value);');
  expect(violations()).toEqual([]);
});

for (const source of [
  'export { parseOther as decode } from "@/shared/other/contract";',
  'import { parseOther } from "@/shared/other/contract"; export { parseOther as decode };',
  'export * from "./second";',
]) {
  test(`follows contract re-exports: ${source}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { decode } from "./barrel"; export const GET = () => decode(parseItem({}));');
    write("app/api/items/barrel.ts", source);
    write("app/api/items/second.ts", 'export { parseOther as decode } from "@/shared/other/contract"; export * from "./barrel";');
    expect(violations()).toEqual([undeclaredViolation]);
  });
}

for (const [name, source] of [
  ["parameter", 'export const GET = (parseOther: () => unknown) => parseOther();'],
  ["destructured parameter", 'export const GET = ({ parseOther }: { parseOther: () => unknown }) => parseOther();'],
  ["shadowed parameter default", 'export const GET = (parseOther = () => ({}), request = parseOther()) => parseItem(request);'],
  ["nested binding name with default", 'export const GET = ({ nested: { parseOther = () => ({}) } = {} } = {}) => parseItem(parseOther());'],
  ["local const", 'export const GET = () => { const parseOther = () => ({}); return parseOther(); };'],
  ["local let", 'export const GET = () => { let parseOther = () => ({}); return parseOther(); };'],
  ["hoisted var", 'export const GET = () => { parseOther(); if (true) { var parseOther = () => ({}); } };'],
  ["local function", 'export const GET = () => { function parseOther() { return {}; } return parseOther(); };'],
  ["local class", 'export const GET = () => { class parseOther {} return new parseOther(); };'],
  ["catch binding", 'export const GET = () => { try {} catch (parseOther) { return parseOther; } };'],
  ["loop binding", 'export const GET = () => { for (const parseOther of []) { parseOther(); } };'],
  ["property name", 'export const GET = () => ({ parseOther: true });'],
  ["type reference", 'export const GET = () => { let value: typeof parseOther; return value; };'],
] as const) {
  test(`ignores a contract identifier used as a ${name}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, `import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; ${source}`);
    expect(violations()).toEqual([]);
  });
}

test("a nested shadow does not hide an outer contract reference", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const GET = () => { const nested = (parseOther: unknown) => parseOther; { const parseOther = () => ({}); parseOther(); } return parseOther({}); };');
  expect(violations()).toEqual([undeclaredViolation]);
});

for (const source of [
  'import { createHandler } from "./handler"; export const GET = createHandler();',
  'import { handle } from "./handler"; export function GET(request: Request) { return handle(request); }',
]) {
  test(`does not follow imported infrastructure calls beyond the initial handler: ${source}`, () => {
    const { write, violations } = undeclaredFixture();
    write(`app/api/${route}`, source);
    write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; import { infrastructure } from "@/server/infrastructure"; export const handle = () => infrastructure(parseItem({})); export function createHandler() { return handle; }');
    write("server/infrastructure.ts", 'import { parseOther } from "@/shared/other/contract"; export const infrastructure = (value: unknown) => parseOther(value);');
    expect(violations()).toEqual([]);
  });
}

test("does not resolve an imported handler call shadowed by a parameter", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { handle } from "./handler"; export const GET = (handle: () => unknown) => handle();');
  write("app/api/items/handler.ts", 'import { parseOther } from "@/shared/other/contract"; export const handle = () => parseOther({});');
  expect(violations()).toEqual([]);
});

test("ignores type-only contract imports and unused runtime imports", () => {
  const { write, violations } = undeclaredFixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import type { parseOther } from "@/shared/other/contract"; export const GET = () => parseItem({});');
  expect(violations()).toEqual([]);
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; import { parseOther } from "@/shared/other/contract"; export const GET = () => parseItem({});');
  expect(violations()).toEqual([]);
});

test("requires per-method classification for a route exporting GET and POST", () => {
  const { write, codes } = fixture();
  write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; export const GET = () => parseItem({ version: 1 }); export const POST = () => parseItem({ version: 1 });');
  expect(codes()).toEqual([{ code: "method-unclassified", path: route }]);
});

for (const classified of [false, true]) {
  test(`${classified ? "accepts classified" : "requires per-method classification for"} destructured GET and POST exports`, () => {
    const { write, manifest, codes } = fixture();
    write(`app/api/${route}`, 'import { parseItem } from "@/shared/items/contract"; export const { GET, POST } = { GET: () => parseItem({ version: 1 }), POST: () => parseItem({ version: 1 }) };');
    if (classified) {
      const entry = manifest.routes[route];
      if (!entry) throw new Error("Fixture item route is missing");
      entry.methods = {
        GET: { contracts: [contract] },
        POST: { contracts: [contract] },
      };
    }
    expect(codes()).toEqual(classified ? [] : [{ code: "method-unclassified", path: route }]);
  });
}

test("requires per-method classification for star-re-exported GET and POST handlers", () => {
  const { write, manifest, codes } = fixture();
  write(`app/api/${route}`, 'export * from "./handler";');
  write("app/api/items/handler.ts", 'import { parseItem } from "@/shared/items/contract"; export const GET = () => parseItem({ version: 1 }); export const POST = () => parseItem({ version: 1 });');
  expect(codes()).toEqual([{ code: "method-unclassified", path: route }]);
  const entry = manifest.routes[route];
  if (!entry) throw new Error("Fixture item route is missing");
  entry.methods = {
    GET: { contracts: [contract] },
    POST: { contracts: [contract] },
  };
  expect(codes()).toEqual([]);
});

test("requires an allowance for an unversioned POST contract despite a versioned GET contract", () => {
  const { methods, codes } = mixedMethodFixture();
  expect(codes()).toEqual([{ code: "method-unversioned", path: route }]);
  methods.POST.allowance = {
    kind: "unversioned-compatibility",
    reason: "POST preserves the legacy unversioned response while existing clients migrate.",
  };
  expect(codes()).toEqual([]);
});

test("requires an allowance for a method binding both versioned and unversioned contracts", () => {
  const { methods, codes } = mixedMethodFixture();
  methods.GET.contracts = [contract, ...methods.POST.contracts];
  methods.POST.allowance = {
    kind: "unversioned-compatibility",
    reason: "POST preserves the legacy unversioned response while existing clients migrate.",
  };
  expect(codes()).toEqual([{ code: "method-unversioned", path: route }]);
  methods.GET.allowance = {
    kind: "unversioned-compatibility",
    reason: "GET preserves the legacy unversioned response while existing clients migrate.",
  };
  expect(codes()).toEqual([]);
});

for (const [name, allowance] of [
  ["unknown kind", { kind: "internal", reason: "POST preserves the legacy unversioned response while existing clients migrate." }],
  ["short trimmed reason", { kind: "unversioned-compatibility", reason: "    Too short    " }],
] as const) {
  test(`rejects a method allowance with ${name}`, () => {
    const { methods, codes } = mixedMethodFixture();
    methods.POST.allowance = allowance;
    expect(codes()).toEqual([
      { code: "method-allowance-invalid", path: route },
      { code: "method-unversioned", path: route },
    ]);
  });
}

test("rejects a method classification the route does not export", () => {
  const { manifest, codes } = fixture();
  const entry = manifest.routes[route];
  if (!entry) throw new Error("Fixture item route is missing");
  entry.methods = {
    GET: { contracts: [contract] },
    POST: { contracts: [contract] },
  };
  expect(codes()).toEqual([{ code: "method-unknown", path: route }]);
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
  manifest.baseline.undeclaredHandlerContracts = { "zulu/route.ts": [], "alpha/route.ts": [] };
  expect(codes()).toContainEqual({ code: "baseline-unsorted", path: "undeclaredHandlerContracts" });
  manifest.baseline.undeclaredHandlerContracts = { [route]: ["shared/zulu/contract.ts", "shared/alpha/contract.ts"] };
  expect(codes()).toContainEqual({ code: "baseline-unsorted", path: route });
  manifest.baseline.undeclaredHandlerContracts[route] = [otherContract, otherContract];
  expect(codes()).toContainEqual({ code: "baseline-stale", path: route });
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
