import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
import { clientGetExceptions, queryKeyExceptions } from "../policy/client-data.mjs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
applyRuleCheckTimeout();

const { directory, lint: lintFixtures, lintWithConfig } = await createOxlintWorkspace("home-oxlint-client-data-", {
  rules: ["no-fetch-in-client-components", "query-key-factory"],
});

let fixtureIndex = 0;
async function lint(code, path = `client/fixture-${++fixtureIndex}.ts`, request = {}) {
  return (await lintFixtures({ fixture: { code, path } }, request)).fixture;
}

const fetchMessage = "Move client reads into the query factories instead of calling fetch from a component or effect; keep fetch for event-handler mutations.";
const queryKeyMessage = "Build query keys with the registered scope factories instead of an inline or aliased key literal.";

describe("no-fetch-in-client-components", () => {
  const rejected = [
    ["awaited GET", 'const response = await fetch("/api/thing");'],
    ["promise GET", 'fetch("/api/thing").then((response) => response.json());'],
    ["empty init", 'await fetch("/api/thing", {});'],
    ["headers-only init", 'await fetch("/api/thing", { headers: { accept: "application/json" } });'],
    ["explicit GET", 'await fetch("/api/thing", { method: "GET" });'],
    ["lowercase GET", 'await fetch("/api/thing", { method: "get", headers });'],
    ["effect helper GET", 'const load = () => fetch("/api/thing"); useEffect(() => { void load(); }, []);'],
    ["window GET", 'await window.fetch("/api/thing");'],
    ["dynamic URL GET", 'await fetch(`/api/thing?owner=${owner}`);'],
    ["globalThis GET", 'await globalThis.fetch("/api/thing");'],
    ["template GET method", 'await fetch("/api/thing", { method: `gEt` });'],
    ["literal spread overrides POST with GET", 'fetch(url, { method: "POST", ...{ method: "GET" } });'],
    ["nested literal spread GET", 'fetch(url, { ...{ ...({ method: "GET" } as RequestInit) } });'],
    ["last direct method overrides spread POST", 'fetch(url, { ...{ method: "POST" }, method: "GET" });'],
    ["unknown spread before GET", 'fetch(url, { ...init, method: "GET" });'],
    ["nested unknown spread before GET", 'fetch(url, { ...{ ...init, method: "GET" } });'],
    ["nested explicit GET after unknown spread", 'fetch(url, { ...init, ...{ method: "get" } });'],
    ["explicit GET after computed key", 'fetch(url, { [key]: "POST", method: "GET" });'],
    ["numeric key cannot override a GET", 'fetch(url, { method: "GET", 0: "POST" });'],
    ["computed numeric key cannot override a GET", 'fetch(url, { method: "GET", [0]: "POST" });'],
    ["numeric spread cannot override a GET", 'fetch(url, { method: "GET", ...{ 0: "POST" } });'],
    ["default Request GET", 'fetch(new Request(url));'],
    ["explicit Request GET", 'fetch(new Request(url, { method: "GET" }));'],
    ["empty init inherits Request GET", 'fetch(new Request(url), {});'],
    ["fetch init overrides Request POST", 'fetch(new Request(url, { method: "POST" }), { method: "GET" });'],
    ["nested default Request GET", 'fetch(new Request(new Request(url)));'],
    ["nested Request init overrides inherited POST", 'fetch(new Request(new Request(url, { method: "POST" }), { method: "GET" }));'],
    ["fetch init overrides nested Request POST", 'fetch(new Request(new Request(url, { method: "POST" })), { method: "GET" });'],
    ["immutable fetch alias", 'const get = fetch; get(url);'],
    ["immutable chained fetch alias", 'const get = (fetch as typeof fetch); const load = get; load(url);'],
    ["immutable window fetch alias", 'const get = window.fetch; get(url);'],
    ["opaque Request variable retains GET classification", 'const postRequest = new Request(url, { method: "POST" }); fetch(postRequest, {});'],
  ];
  for (const [name, code] of rejected) {
    it(`rejects ${name}`, async () => {
      const findings = await lint(code);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("home(no-fetch-in-client-components)");
      expect(findings[0].message).toBe(fetchMessage);
    }, budgetMs);
  }

  const clean = [
    ["POST mutation", 'await fetch("/api/thing", { method: "POST", body });'],
    ["PUT mutation", 'await fetch("/api/thing", { method: "PUT", body });'],
    ["DELETE mutation", 'await fetch("/api/thing", { method: "DELETE" });'],
    ["PATCH mutation with spread", 'await fetch("/api/thing", { ...init, method: "PATCH" });'],
    ["computed key after GET makes the method unknown", 'fetch(url, { ...init, method: "GET", [key]: "POST" });'],
    ["transport callback", 'const send = (url, init) => fetch(url, init);'],
    ["unknown init", 'await fetch(url, init);'],
    ["account resource mutation", 'await fetchAccountResource("/api/account/country-preference", { method: "PUT", body });'],
    ["query refetch", 'queryClient.refetchQueries({ queryKey: key });'],
    ["init call", 'fetch(url, makeInit());'],
    ["spread argument", 'fetch(url, ...args);'],
    ["dynamic method", 'fetch(url, { method });'],
    ["dynamic template method", 'fetch(url, { method: `${method}` });'],
    ["other fetch member", 'transport.fetch(url); window["fetch"](url);'],
    ["literal spread overrides GET with POST", 'fetch(url, { method: "GET", ...{ method: "POST" } });'],
    ["literal spread POST", 'fetch(url, { ...{ method: "POST" } });'],
    ["unknown spread", 'fetch(url, { ...init });'],
    ["unknown spread after GET", 'fetch(url, { method: "GET", ...init });'],
    ["dynamic method after unknown spread", 'fetch(url, { ...init, method });'],
    ["nested unknown spread", 'fetch(url, { ...{ ...init } });'],
    ["Request POST", 'fetch(new Request(url, { method: "POST", body }));'],
    ["empty init inherits Request POST", 'fetch(new Request(url, { method: "POST" }), {});'],
    ["Request spread POST", 'fetch(new Request(url, { method: "GET", ...{ method: "POST" } }));'],
    ["Request unknown init", 'fetch(new Request(url, init));'],
    ["nested Request inherits POST", 'fetch(new Request(new Request(url, { method: "POST" })));'],
    ["nested Request empty init inherits POST", 'fetch(new Request(new Request(url, { method: "POST" }), {}));'],
    ["nested Request init overrides inherited GET", 'fetch(new Request(new Request(url), { method: "POST" }));'],
    ["nested Request unknown init", 'fetch(new Request(new Request(url, init)));'],
    ["deep wrapped Request inherits POST", 'fetch(new (Request as typeof Request)(new Request(new Request(url, { method: "POST" }))));'],
    ["fetch init overrides Request GET", 'fetch(new Request(url), { method: "PATCH" });'],
    ["shadowed fetch parameter", 'function run(fetch: (id: string) => number) { return fetch("item"); }'],
    ["shadowed fetch const", 'const fetch = (id) => id; fetch("item");'],
    ["shadowed fetch let", 'let fetch = (id) => id; fetch("item");'],
    ["shadowed fetch var", 'var fetch = (id) => id; fetch("item");'],
    ["shadowed fetch declaration", 'function fetch(id) { return id; } fetch("item");'],
    ["imported fetch", 'import { fetch } from "transport"; fetch(url);'],
    ["aliased fetch import", 'import { cachedLookup as fetch } from "./cache"; fetch(url);'],
    ["immutable alias of imported fetch", 'import { cachedLookup as fetch } from "./cache"; const get = fetch; get(url);'],
    ["shadowed fetch alias", 'function run(fetch) { const get = fetch; get(url); }'],
    ["written fetch alias", 'const get = fetch; get = transport; get(url);'],
    ["shadowed window", 'function run(window) { window.fetch(url); }'],
    ["shadowed globalThis", 'const globalThis = transport; globalThis.fetch(url);'],
  ];
  for (const [name, code] of clean) {
    it(`accepts ${name}`, async () => {
      expect(await lint(code)).toHaveLength(0);
    }, budgetMs);
  }

  it("unwraps callee, global object, init, and method expressions", async () => {
    expect(await lint(`
      (fetch as typeof fetch)(url);
      (fetch!)(url);
      (fetch satisfies typeof fetch)(url);
      (<typeof fetch>fetch)(url);
      fetch?.(url);
      (window as Window).fetch(url);
      (globalThis!).fetch(url);
      fetch(url, ({ method: ("GET" as string) } as RequestInit));
    `)).toHaveLength(8);
  }, budgetMs);

  it("recognizes platform variables with zero definitions", async () => {
    const config = ".oxlintrc-platform.json";
    await writeFile(path.join(directory, config), JSON.stringify({
      plugins: [], categories: { correctness: "off" },
      env: { browser: true, node: true, es2024: true },
      jsPlugins: ["./oxlint/home-plugin.mjs"],
      rules: { "home/no-fetch-in-client-components": "error" },
    }));
    const findings = await lintWithConfig({
      global: 'fetch(url); window.fetch(url); globalThis.fetch(url);',
    }, { config });
    expect(findings.global).toHaveLength(3);
  }, budgetMs);

  it("does not inherit methods from shadowed Request bindings", async () => {
    expect(await lint(`
      function run(Request) { fetch(new Request(url, { method: "POST" })); }
      function other() {
        const Request = CustomRequest;
        fetch(new Request(url, { method: "POST" }));
      }
    `)).toHaveLength(2);
    expect(await lint('import { CustomRequest as Request } from "./requests"; fetch(new Request(url, { method: "POST" }));')).toHaveLength(1);
  }, budgetMs);
});

describe("query-key-factory", () => {
  const rejected = [
    ["queryOptions array", 'queryOptions({ queryKey: ["balances", owner], queryFn });'],
    ["useQuery array", 'useQuery({ queryKey: ["activity"], queryFn });'],
    ["invalidation array", 'queryClient.invalidateQueries({ queryKey: ["balances"] });'],
    ["const array alias", 'const key = ["balances", owner]; useQuery({ queryKey: key, queryFn });'],
    ["array containing a scope alias", 'const scope = "activity"; useQuery({ queryKey: [scope], queryFn });'],
    ["const template alias", 'const key = `balances`; queryClient.setQueryData({ queryKey: key }, value);'],
    ["array before options spread", 'useQuery({ queryKey: ["balances"], ...rest });'],
    ["inline string", 'useQuery({ queryKey: "balances", queryFn });'],
    ["inline template", 'useQuery({ queryKey: `balances`, queryFn });'],
    ["const string alias", 'const key = "balances"; useQuery({ queryKey: key, queryFn });'],
    ["shorthand key", 'const queryKey = ["balances"]; useQuery({ queryKey, queryFn });'],
    ["quoted property name", 'useQuery({ "queryKey": ["balances"] });'],
    ["computed string property name", 'useQuery({ ["queryKey"]: ["balances"] });'],
    ["computed template property name", 'useQuery({ [`queryKey`]: ["balances"] });'],
  ];
  for (const [name, code] of rejected) {
    it(`rejects ${name}`, async () => {
      const findings = await lint(code);
      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe("home(query-key-factory)");
      expect(findings[0].message).toBe(queryKeyMessage);
    }, budgetMs);
  }

  const clean = [
    ["ownerQuery options", 'useQuery(ownerQuery({ owner, scope: "balances", queryFn }));'],
    ["ownerQueryKey invalidation", 'queryClient.invalidateQueries({ queryKey: ownerQueryKey(ownerKey, "actions") });'],
    ["publicQueryKey options", 'queryOptions({ queryKey: publicQueryKey("market-prices", "/api/market-prices"), queryFn });'],
    ["parameter key", 'function useData(key) { useQuery({ queryKey: key, queryFn }); }'],
    ["imported key", 'import { key } from "./registry"; useQuery({ queryKey: key, queryFn });'],
    ["disabled factory key", 'useQuery({ queryKey: disabledQueryKey(scope, ...key), queryFn });'],
    ["positional factory key", 'client.setQueryData(ownerQueryKey(owner, "actions"), payload);'],
    ["unknown registry key", 'const options = { queryKey: someRegistryKey, staleTime: 0 };'],
    ["dynamic template key", 'useQuery({ queryKey: `balances-${owner}`, queryFn });'],
    ["let key", 'let key = ["balances"]; useQuery({ queryKey: key, queryFn });'],
    ["written const binding", 'const key = ["balances"]; key = registryKey; useQuery({ queryKey: key, queryFn });'],
    ["dynamic computed property name", 'useQuery({ [field]: ["balances"] });'],
    ["computed identifier property name", 'useQuery({ [queryKey]: ["balances"] });'],
    ["number key", 'useQuery({ queryKey: 12, queryFn });'],
    ["destructured key", 'const { key } = registry; useQuery({ queryKey: key, queryFn });'],
  ];
  for (const [name, code] of clean) {
    it(`accepts ${name}`, async () => {
      expect(await lint(code)).toHaveLength(0);
    }, budgetMs);
  }

  it("unwraps literals and immutable alias initializers", async () => {
    expect(await lint(`
      const base = (["balances"] as const);
      const key = (base satisfies readonly string[]);
      useQuery({ queryKey: key! });
      useQuery({ queryKey: (<readonly string[]>["activity"]) });
      useQuery({ queryKey: ("balances" as string) });
    `)).toHaveLength(3);
  }, budgetMs);

  it("follows five const definitions but not a sixth", async () => {
    expect(await lint(`
      const a = ["balances"], b = a, c = b, d = c, e = d, f = e;
      useQuery({ queryKey: e });
      useQuery({ queryKey: f });
    `)).toHaveLength(1);
  }, budgetMs);

  it("terminates cyclic aliases without reporting a literal", async () => {
    expect(await lint(`
      const a = b, b = a;
      useQuery({ queryKey: a });
    `)).toHaveLength(0);
  }, budgetMs);

  it("respects shadowing and declaration order", async () => {
    expect(await lint(`
      useQuery({ queryKey: key });
      const key = ["balances"];
      function inner(key) { useQuery({ queryKey: key }); }
      function outer() {
        const key = registryKey;
        useQuery({ queryKey: key });
      }
    `)).toHaveLength(1);
  }, budgetMs);
});

describe("client data exceptions", () => {
  it("has no grandfathered files in either policy registry", () => {
    expect(clientGetExceptions.size).toBe(0);
    expect(queryKeyExceptions.size).toBe(0);
  }, budgetMs);

  for (const [rule, rejected, clean] of [
    ["no-fetch-in-client-components", 'fetch("/api/thing");', 'fetch("/api/thing", { method: "POST", body });'],
    ["query-key-factory", 'useQuery({ queryKey: ["balances"] });', 'useQuery({ queryKey: publicQueryKey("market-prices") });'],
  ]) {
    it(`${rule} replaces the policy with an explicit allow option`, async () => {
      const path = "client/allowed-data.ts";
      expect(await lint(clean, path, { rule, options: { allow: [] } })).toHaveLength(0);
      expect(await lint(rejected, path, { rule, options: { allow: [] } })).toHaveLength(1);
      expect(await lint(rejected, path, { rule, options: { allow: [path] } })).toHaveLength(0);
      expect(await lint(rejected, "client/not-allowed-data.ts", { rule, options: { allow: [path] } })).toHaveLength(1);
      expect(await lint(rejected, `nested/${path}`, { rule, options: { allow: [path] } })).toHaveLength(1);
      expect(await lint(rejected, `./${path}`, { rule, options: { allow: [path] } })).toHaveLength(0);
      const exemptionPath = "shared/formatting/address.ts";
      expect(await lint(rejected, exemptionPath, { rule, options: { allow: [exemptionPath] } })).toHaveLength(0);
      expect(await lint(rejected, "shared/nested/apps/web/shared/formatting/address.ts", { rule, options: { allow: [exemptionPath] } })).toHaveLength(1);
    }, budgetMs);
  }
});
