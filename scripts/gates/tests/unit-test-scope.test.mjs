import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { CATEGORY_IDS, MANIFEST_PATH, checkUnitTestScope, run, unitTestCases } from "../unit-test-scope.mjs";
import { gitFixtureEnv } from "./git-fixture-env.mjs";

const protectedFile = "server/actions/confirm.test.ts";
const residue = "client/query/cache.test.ts";
const scope = { pattern: "server/actions/**", category: "action-lifecycle" };
const grandfather = { path: residue, reason: "Existing query plumbing suite." };
const manifest = () => ({ categories: Object.fromEntries(CATEGORY_IDS.map((id) => [id, "Protected policy category."])), scopes: [{ ...scope }], grandfathered: [{ ...grandfather }] });

function fixture(t, paths = [protectedFile, residue], contents = {}) {
  const root = mkdtempSync(join(tmpdir(), "unit-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, env: gitFixtureEnv(), stdio: "pipe" });
  const write = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  git("init", "-q");
  for (const path of paths) write(`apps/web/${path}`, contents[path] ?? "export {};\n");
  const save = (value) => write(MANIFEST_PATH, JSON.stringify(value));
  save(manifest());
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "initial");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return { root, git, write, save, check: () => checkUnitTestScope({ root, baseRef: "main" }) };
}

function findings(t, change) {
  const f = fixture(t);
  const value = manifest();
  change(value, f);
  f.save(value);
  return f.check().findings.join("\n");
}

test("the real indexed unit tests all have a policy category or reasoned residue", () => {
  const result = checkUnitTestScope();
  assert.ok(result.total > 0);
  assert.deepEqual(result.findings, []);
  assert.equal(result.scoped + result.grandfathered, result.total);
});

test("fixture discovery covers Bun names and extensions, excludes stories and Playwright, and reads the index", (t) => {
  const paths = [protectedFile, residue, ...["js", "jsx", "ts", "tsx", "mts", "cts", "mjs", "cjs"].map((ext, i) => `server/actions/case${i}${[".test.", "_test.", ".spec.", "_spec."][i % 4]}${ext}`), "server/actions/browser.test.pw.ts", "stories/board.test.ts", "server/actions/view.test.stories.tsx", ".hidden/ignored.test.ts", "node_modules/ignored.test.ts", "storybook-static/ignored.test.ts"];
  const f = fixture(t, paths);
  f.write("apps/web/client/query/not-indexed.test.ts", "export {};\n");
  assert.equal(f.check().total, 10);
  assert.deepEqual(f.check().findings.map((line) => line.split(":")[0]), ["server/actions/case1_test.jsx", "server/actions/case2.spec.ts", "server/actions/case3_spec.tsx", "server/actions/case5_test.cts", "server/actions/case6.spec.mjs", "server/actions/case7_spec.cjs"]);
  f.git("add", "apps/web/client/query/not-indexed.test.ts");
  assert.match(f.check().findings.join("\n"), /not-indexed.test.ts.*docs\/architecture.md#test-policy.*scope requires a policy category/);
});

test("an unclassified indexed test names its path, policy and scope requirement", (t) => {
  assert.match(findings(t, (value) => { value.grandfathered = []; }), /client\/query\/cache.test.ts.*docs\/architecture.md#test-policy.*adding a scope requires a policy category/);
});

test("deleted grandfathered tests must leave the residue list", (t) => {
  assert.match(findings(t, (_value, f) => { f.git("rm", `apps/web/${residue}`); }), /Stale grandfathered path: client\/query\/cache.test.ts.*no longer exists/);
});

test("newly protected grandfathered tests must leave the residue list", (t) => {
  assert.match(findings(t, (value) => { value.scopes.push({ pattern: residue, category: "auth" }); }), /Stale grandfathered path: client\/query\/cache.test.ts.*now matches a scope/);
});

test("empty scopes fail rather than silently surviving deletion", (t) => {
  assert.match(findings(t, (value) => { value.scopes.push({ pattern: "server/auth/**", category: "auth" }); }), /Scope server\/auth\/\*\* matches zero/);
});

for (const target of ["categories", "scopes"]) {
  test(`unknown ${target} category ids fail`, (t) => {
    assert.match(findings(t, (value) => {
      if (target === "categories") value.categories.presentation = "Not protected.";
      else value.scopes[0] = { ...scope, category: "presentation" };
    }), /Unknown category id: presentation/);
  });
}

for (const target of ["scopes", "grandfathered"]) {
  test(`duplicate ${target} entries fail`, (t) => {
    assert.match(findings(t, (value) => { value[target].push(value[target][0]); }), /Duplicate (?:scope pattern|grandfathered path)/);
  });
}

test("overlapping scopes cannot classify one test twice", (t) => {
  assert.match(findings(t, (value) => { value.scopes.push({ pattern: protectedFile, category: "auth" }); }), /Duplicate scope classification: server\/actions\/confirm.test.ts/);
});

for (const pattern of ["**", "server/**", "shared/**", "client/account/**", "components/**", "server/*/confirm.test.ts", "server/{actions,auth}/**", "../server/actions/**"]) {
  test(`overbroad scope ${pattern} fails`, (t) => {
    assert.match(findings(t, (value) => { value.scopes[0] = { pattern, category: "auth" }; }), /Invalid scope/);
  });
}

test("shared parser globs and one-directory client filename globs stay narrow", (t) => {
  const f = fixture(t, [protectedFile, residue, "shared/funding/contract-order.test.ts"]);
  const value = manifest();
  value.grandfathered = [];
  value.scopes.push({ pattern: "client/query/cache*.test.ts", category: "auth" }, { pattern: "shared/**/contract*.test.ts", category: "route-contract-parser" });
  f.save(value);
  assert.deepEqual(f.check().findings, []);
});

test("grandfathering can shrink but cannot admit a new path against the base", (t) => {
  const f = fixture(t);
  const value = manifest();
  f.write("apps/web/client/query/new.test.ts", "export {};\n");
  f.git("add", "apps/web/client/query/new.test.ts");
  value.grandfathered.push({ path: "client/query/new.test.ts", reason: "New debt." });
  f.save(value);
  assert.match(f.check().findings.join("\n"), /New grandfathered path: client\/query\/new.test.ts.*only shrink/);
  f.git("rm", "--cached", "apps/web/client/query/new.test.ts");
  f.git("rm", `apps/web/${residue}`);
  value.grandfathered = [];
  f.save(value);
  assert.deepEqual(f.check().findings, []);
});

test("a grandfathered file cannot gain a case against the merge base", (t) => {
  const seeded = 'import { test } from "bun:test";\ntest("existing case", () => {});\n';
  const f = fixture(t, [protectedFile, residue], { [residue]: seeded });
  f.write(`apps/web/${residue}`, `${seeded}test("added case", () => {});\n`);
  const result = f.check().findings.join("\n");
  assert.match(result, /client\/query\/cache\.test\.ts: new unit test case "added case" in a grandfathered file/);
  assert.match(result, /move it into a protected category \(docs\/architecture\.md#test-policy\), cover it with a story, or delete it/);
});

test("an unchanged grandfathered file keeps its cases", (t) => {
  const seeded = 'import { test } from "bun:test";\ntest("existing case", () => {});\n';
  const f = fixture(t, [protectedFile, residue], { [residue]: seeded });
  assert.deepEqual(f.check().findings, []);
});

test("a grandfathered file may still lose cases", (t) => {
  const seeded = 'import { test } from "bun:test";\ntest("first", () => {});\ntest("second", () => {});\n';
  const f = fixture(t, [protectedFile, residue], { [residue]: seeded });
  f.write(`apps/web/${residue}`, 'import { test } from "bun:test";\ntest("first", () => {});\n');
  assert.deepEqual(f.check().findings, []);
});

test("reformatting, comments, strings and describe moves keep the case set stable", (t) => {
  const seeded = 'import { describe, test } from "bun:test";\ntest("alpha", () => {});\ndescribe("group", () => { test("beta", () => {}); });\n';
  const head = [
    'import { describe, test } from "bun:test";',
    '// test("commented out", () => {});',
    'const quoted = \'test("inside a string", () => {})\';',
    'test(',
    '  "alpha",',
    '  () => {},',
    ');',
    'describe("group", () => {',
    '  test.each([1, 2])("beta", () => {});',
    '});',
    "",
  ].join("\n");
  const f = fixture(t, [protectedFile, residue], { [residue]: seeded });
  f.write(`apps/web/${residue}`, head);
  assert.deepEqual(f.check().findings, []);
});

test("cases the base branch removed do not count against a branch that kept them", (t) => {
  const seeded = 'import { test } from "bun:test";\ntest("kept", () => {});\ntest("dropped later", () => {});\n';
  const f = fixture(t, [protectedFile, residue], { [residue]: seeded });
  f.git("checkout", "-q", "-b", "base-tip");
  f.write(`apps/web/${residue}`, 'import { test } from "bun:test";\ntest("kept", () => {});\n');
  f.git("add", `apps/web/${residue}`);
  f.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "base drops a case");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.git("checkout", "-q", "-");
  assert.deepEqual(f.check().findings, []);
});

test("a base manifest that lists a file missing at the merge base fails closed", (t) => {
  const f = fixture(t);
  f.git("rm", `apps/web/${residue}`);
  f.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "drop residue");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.write(`apps/web/${residue}`, 'import { test } from "bun:test";\ntest("reintroduced", () => {});\n');
  f.git("add", `apps/web/${residue}`);
  assert.throws(() => f.check(), /missing from the merge base/);
});

test("case extraction ignores comments and strings, spans lines and names each declaration once", () => {
  const source = [
    'import { describe, it, test } from "bun:test";',
    '// test("commented out", () => {});',
    'const quoted = \'test("inside a string", () => {})\';',
    'test(',
    '  "multi line",',
    '  () => {},',
    ');',
    'it.skip("skipped case", () => {});',
    'test.each([1, 2])("each case %i", () => {});',
    'describe("container", () => { test("nested", () => {}); });',
    'test.todo("todo case");',
    "",
  ].join("\n");
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", source), ["multi line", "skipped case", "each case %i", "nested", "todo case"]);
});

test("JSX text and attributes are not test declarations", () => {
  const source = 'export const View = () => <div title="test(\'nope\', () => {})">test("jsx text")</div>;\ntest("real", () => {});\n';
  assert.deepEqual(unitTestCases("client/query/view.test.tsx", source), ["real"]);
});

test("case extraction resolves wrapped, aliased and member declarations", () => {
  const source = [
    'import { describe, it, test } from "bun:test";',
    'import { test as check } from "bun:test";',
    'import * as bun from "bun:test";',
    'test("plain", () => {});',
    '(test)("parenthesized", () => {});',
    '(it as any)("asserted", () => {});',
    'check("aliased", () => {});',
    'bun.test("namespace", () => {});',
    'bun.it.skip("namespace skip", () => {});',
    'test["skip"]("computed", () => {});',
    'test.skipIf(false).each([1, 2])("chained", () => {});',
    'describe("container", () => { test("nested", () => {}); });',
    "",
  ].join("\n");
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", source), ["plain", "parenthesized", "asserted", "aliased", "namespace", "namespace skip", "computed", "chained", "nested"]);
});

test("case extraction follows local aliases and ignores shadowed bindings", () => {
  const source = [
    'import { test as check } from "bun:test";',
    'import * as bun from "bun:test";',
    'const alias = test;',
    'const { test: destructured } = bun;',
    'alias("alias", () => {});',
    'destructured("destructured", () => {});',
    '(void test("void wrapped", () => {}))?.();',
    '(test.each<[number]>)([[1]])("generic", () => {});',
    'function helper(check) { check("shadowed", () => {}); }',
    'function namespace(tests) { tests[key]("shadowed", () => {}); }',
    "",
  ].join("\n");
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", source), ["alias", "destructured", "void wrapped", "generic"]);
});

test("an unsupported dynamic namespace declaration fails closed", () => {
  const source = 'import * as bun from "bun:test";\nbun[handler]("dynamic", () => {});\n';
  assert.throws(() => unitTestCases("client/query/cache.test.ts", source), /unsupported dynamic member call/);
});

test("a chained modifier change is not a new case", (t) => {
  const seeded = 'import { test } from "bun:test";\ntest.skipIf(false).each([1, 2])("existing", () => {});\n';
  const f = fixture(t, [protectedFile, residue], { [residue]: seeded });
  f.write(`apps/web/${residue}`, 'import { test } from "bun:test";\ntest.skipIf(true).each([1, 2])("existing", () => {});\n');
  assert.deepEqual(f.check().findings, []);
});

test("an aliased declaration added to a grandfathered file fails", (t) => {
  const seeded = 'import { test as check } from "bun:test";\ncheck("existing", () => {});\n';
  const f = fixture(t, [protectedFile, residue], { [residue]: seeded });
  f.write(`apps/web/${residue}`, `${seeded}check("added", () => {});\n`);
  assert.match(f.check().findings.join("\n"), /client\/query\/cache\.test\.ts: new unit test case "added" in a grandfathered file/);
});

test("wrapped and aliased declarations added to a grandfathered file fail", (t) => {
  const seeded = 'const check = test;\ncheck("existing", () => {});\n';
  const f = fixture(t, [protectedFile, residue], { [residue]: seeded });
  f.write(`apps/web/${residue}`, `${seeded}(void test("added", () => {}))?.();\n`);
  assert.match(f.check().findings.join("\n"), /client\/query\/cache\.test\.ts: new unit test case "added" in a grandfathered file/);
});

test("case extraction follows every Bun modifier and fails closed on escapes", () => {
  const modifiers = 'xtest("xtest case", () => {});\ntest.todoIf(false)("todo case", () => {});\ntest.concurrentIf(false)("concurrent", () => {});\n';
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", modifiers), ["xtest case", "todo case", "concurrent"]);
  const switchCase = 'switch (1) { case 1: const check = test; check("switch case", () => {}); break; }\n';
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", switchCase), ["switch case"]);
  const shadowed = 'import { test as check } from "bun:test";\nfunction helper(){ if (true) { var check = () => {}; } check("fake", () => {}); }\nconst named = function check(n = 0) { if (n === 0) check("fake", () => {}); };\nconst test = () => {};\ntest("fake", () => {});\n';
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", shadowed), []);
  assert.throws(() => unitTestCases("client/query/cache.test.ts", 'let check = test;\ncheck("new", () => {});\n'), /unsupported mutable alias/);
  assert.throws(() => unitTestCases("client/query/cache.test.ts", 'const [check] = [test];\ncheck("new", () => {});\n'), /unsupported use/);
  assert.throws(() => unitTestCases("client/query/cache.test.ts", 'import * as tests from "bun:test";\nconst key = "test";\nconst check = tests[key];\ncheck("new", () => {});\n'), /unsupported dynamic/);
});

test("an unmodeled escape fails the gate rather than allowing a case", (t) => {
  const f = fixture(t, [protectedFile, residue]);
  f.write(`apps/web/${residue}`, 'let check = test;\ncheck("new", () => {});\n');
  assert.throws(() => f.check(), /unsupported mutable alias/);
});

test("case extraction scopes declarations and fails closed on unsupported forms", () => {
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'describe("suite", () => { for (let test = 0; test < 1; test++) {} test("loop", () => {}); });'), ["loop"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'describe("suite", () => { const obj = { test() {} }; test("method", () => {}); });'), ["method"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'const check = test;\nfunction test(...args) { return args; }\ncheck("shadowed", () => {});\n'), []);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'import * as tests from "bun:test";\nconst { ["test"]: check } = tests;\ncheck("computed", () => {});\n'), ["computed"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'const { test: check } = await import("bun:test");\ncheck("dynamic", () => {});\n'), ["dynamic"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'const { test: check } = require("bun:test");\ncheck("require", () => {});\n'), ["require"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'globalThis.test("global", () => {});\n'), ["global"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'import test from "node:assert/strict";\ntest(true);\nfunction helper<test>(a: test) { return a; }\nenum Values { test }\nconst C = class test { static run() { return test.name; } };\n'), []);
  assert.throws(() => unitTestCases("client/query/cache.test.ts", 'test.call(undefined, "new", () => {});\n'), /unsupported invocation form/);
});

test("a shadowed base alias does not credit a new case", (t) => {
  const seeded = 'const check = test;\nfunction test(...args) { return args; }\ncheck("existing", () => {});\n';
  const f = fixture(t, [protectedFile, residue], { [residue]: seeded });
  f.write(`apps/web/${residue}`, 'test("added", () => {});\n');
  assert.match(f.check().findings.join("\n"), /client\/query\/cache\.test\.ts: new unit test case "added" in a grandfathered file/);
});

test("case extraction scopes namespaces, static blocks and enums and rejects unmodeled module loads", () => {
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'function h(){ if (true) { var test = (...a) => a; } const t = test; t("new", () => {}); }\nh();'), []);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'import { test } from "bun:test";\nfunction h(){ class C { static { var test = () => {}; } } test("new", () => {}); }\nh();'), ["new"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'namespace N { export const test = (...a) => a; test("new", () => {}); }'), []);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'import { test } from "bun:test";\nenum E { test, next = test + 1 }'), []);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'const bun = await import("bun:test");\nbun.test("ok", () => {});'), ["ok"]);
  assert.throws(() => unitTestCases("client/query/cache.test.ts", 'await import("bun:test").then(({test:t}) => t("new", () => {}));\n'), /unsupported (?:bun:test module load|dynamic member call)/);
  assert.throws(() => unitTestCases("client/query/cache.test.ts", 'const {serial:t} = test;\nt("new", () => {});\n'), /unsupported destructuring/);
  assert.throws(() => unitTestCases("client/query/cache.test.ts", 'globalThis[key]("new", () => {});\n'), /unsupported dynamic/);
});

test("case extraction resolves module aliases and rejects unmodeled module loads", () => {
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'if (true) { var test = (...a) => a; }\nconst t = test;\nt("new", () => {});'), []);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'const [t] = [(await import("bun:test")).test];\nt("new", () => {});'), ["new"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'import bun from "bun:test";\nbun.test("new", () => {});'), ["new"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'import * as bun from "bun:test";\nbun.default.test("new", () => {});'), ["new"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'import bun = require("bun:test");\nbun.test("new", () => {});'), ["new"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'const bun = await import("bun:test", {});\nbun.test("new", () => {});'), ["new"]);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'import { test } from "bun:test";\nenum E { "test", next = test + 1 }'), []);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'const { expect } = (await import("bun:test")) as typeof import("bun:test");'), []);
  assert.deepEqual(unitTestCases("client/query/cache.test.ts", 'function invoke(globalThis, key) { return globalThis[key](); }\ninvoke({ run() {} }, "run");'), []);
  assert.throws(() => unitTestCases("client/query/cache.test.ts", 'import { test } from "bun:test";\nfunction h(register = test) { var test = () => {}; register("new", () => {}); }\nh();\n'), /unsupported tracked parameter default/);
  assert.throws(() => unitTestCases("client/query/cache.test.ts", 'const bun = import("bun:test");\nawait bun.then(({test:t}) => t("new", () => {}));\n'), /unsupported dynamic/);
});

for (const mutation of [
  (value) => { delete value.categories.auth; },
  (value) => { value.categories.auth = ""; },
  (value) => { value.scopes = null; },
  (value) => { value.grandfathered = null; },
  (value) => { value.grandfathered[0].reason = " "; },
]) {
  test("malformed policy input fails closed", (t) => assert.ok(findings(t, mutation).length));
}

test("a missing base manifest admits the initial residue, but unreadable bases fail closed", (t) => {
  const f = fixture(t);
  f.git("rm", MANIFEST_PATH);
  f.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "without manifest");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.save(manifest());
  assert.deepEqual(f.check().findings, []);
  assert.throws(() => checkUnitTestScope({ root: f.root, baseRef: "missing" }));
});

test("CLI entrypoint returns failure for an invalid manifest", (t) => {
  const f = fixture(t);
  f.save({});
  assert.equal(run({ root: f.root, baseRef: "main" }), 1);
});
