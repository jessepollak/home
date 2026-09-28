import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { countAssertions, evaluateAssertionBudget, isProductionTypeScript, repositoryFiles, shrinkBudget } from "../type-assertions.mjs";

const budget = JSON.parse(readFileSync(new URL("../type-assertions-baseline.json", import.meta.url), "utf8"));
const files = repositoryFiles();
const clean = { increases: [], stale: [], invalid: [] };

const fixture = { path: "apps/web/shared/ratchet-fixture.ts", content: "export function status(value: { status: unknown }) { return value.status as string; }" };
const fixtureFiles = [...files, fixture];
const fixtureBudget = { ...budget, files: { ...budget.files, [fixture.path]: { assertion: 1 } } };

function seeded(file, content) {
  return fixtureFiles.map((entry) => entry.path === file ? { path: file, content } : entry);
}

test("production tree exactly matches the shrinking baseline", () => {
  assert.ok(files.length > 0);
  assert.deepEqual(evaluateAssertionBudget({ files, budget }), clean);
});

test("counts only syntactic assertions, not const assertions or guards", () => {
  for (const [source, kind, expected] of [
    ["x as Foo", "assertion", 1], ["x as unknown", "assertion", 1], ["<Foo>x", "assertion", 1],
    ["x as const", "assertion", 0], ["<const>x", "assertion", 0], ["x satisfies Foo", "assertion", 0],
    ["x!", "nonNull", 1], ["x!.y", "nonNull", 1], ["class C { name!: string }", "nonNull", 1],
    ["let x!: string;", "nonNull", 1], ["class C { name?: string }", "nonNull", 0], ["a !== b", "nonNull", 0],
    ["if (isFoo(x)) use(x);", "assertion", 0], ["typeof x === 'string'", "assertion", 0],
    ["response.json<Foo>()", "genericParse", 1], ["parseJsonColumn<Row>(x)", "genericParse", 1],
    ["parser['parseJson']<Foo>()", "genericParse", 1], ["load<Foo>()", "genericParse", 0],
    ["function parseJson<T>(v: string) {}", "genericParse", 0],
  ]) {
    assert.equal(countAssertions("apps/web/client/example.ts", source)[kind], expected, source);
  }
});

test("counts generic parse calls through imported and const aliases", () => {
  for (const [source, expected] of [
    ['import { parseJson as read } from "./parser"; read<Row>(x);', 1],
    ['const read = parseJsonColumn; read<Row>(x);', 1],
    ['const read = helpers.parseJson; read<Row>(x);', 1],
    ['const a = parseJsonColumn; const b = a; b<Row>(x);', 1],
    ['(parseJsonColumn)<Row>(x); (helpers.json)<Row>();', 2],
    ['const { parseJsonColumn: read } = helpers; read<Row>(x);', 1],
    ['const { load: read } = helpers; read<Row>(x);', 0],
    ['import { load as read } from "./parser"; read<Row>(x);', 0],
    ['import read from "./parseJson"; read<Row>(x);', 1],
    ['import read from "./values"; read<Row>(x);', 0],
    ['let read = parseJsonColumn; read = load; read<Row>(x);', 0],
    ['const read = helpers.load; read<Row>(x);', 0],
  ]) assert.equal(countAssertions("apps/web/client/example.ts", source).genericParse, expected, source);
});

test("counts comments even in TSX and at EOF but not directive-looking text", () => {
  for (const [source, expected] of [
    ["// @ts-expect-error", 1], ["/* oxlint-disable-next-line r */", 1],
    ["// eslint-disable-line", 1], ["// @ts-ignore\n/* @ts-nocheck */", 2],
    ["const a = '// eslint-disable';", 0], ["const a = `// @ts-ignore`;", 0],
    ["const a = <div> // @ts-ignore /* oxlint-disable */ </div>;", 0],
    ["const a = <div>{/* oxlint-disable-next-line r */}</div>;", 1],
  ]) assert.equal(countAssertions("apps/web/client/example.tsx", source).suppression, expected, source);
});

test("scope follows the production TypeScript override", () => {
  for (const file of ["apps/web/app/page.tsx", "apps/web/server/index.mts", "apps/web/shared/a.cts", "apps/web/instrumentation.node.ts", "apps/web/proxy.ts", "apps/web/next.config.ts"]) assert.equal(isProductionTypeScript(file), true, file);
  for (const file of ["apps/web/app/a.test.ts", "apps/web/components/a.stories.tsx", "apps/web/server/tests/a.ts", "apps/web/client/testing/a.ts", "apps/web/shared/explorations/a.ts", "apps/web/client/account/dom-test-harness.ts", "apps/web/client/smoke-fixture-provider.tsx", "apps/web/oxlint/rules/a.ts", "apps/web/scripts/a.ts", "apps/web/stories/a.tsx", "apps/web/app/a.js"]) assert.equal(isProductionTypeScript(file), false, file);
});

test("the baseline rejects seeded increases of every kind", () => {
  const existing = fixture;
  for (const suffix of ["\nconst unchecked = 1 as unknown;", "\nconst forced = value!;", "\n// eslint-disable-next-line x\n", "\nparseJsonColumn<Row>(source);", "\nconst read = parseJsonColumn;\nconst again = read;\n(again)<Row>(source);"]) {
    const result = evaluateAssertionBudget({ files: seeded(existing.path, existing.content + suffix), budget: fixtureBudget });
    assert.equal(result.increases.length, 1, suffix);
    assert.deepEqual(result.invalid, []);
  }
  const newFile = { path: "apps/web/shared/ratchet-new.ts", content: "class RatchetNew { name!: string }" };
  assert.equal(evaluateAssertionBudget({ files: [...files, newFile], budget }).increases.length, 1);
  assert.deepEqual(evaluateAssertionBudget({ files: [...files, { path: newFile.path, content: "if (typeof value === 'string') use(value);" }], budget }), clean);
});

test("removing a cast is stale until shrink, and shrink never raises a baseline", () => {
  assert.deepEqual(evaluateAssertionBudget({ files: fixtureFiles, budget: fixtureBudget }), clean);
  const guarded = { path: fixture.path, content: "export function status(value: { status: unknown }) { return typeof value.status === 'string' ? value.status : undefined; }" };
  const smaller = [...files, guarded];
  const result = evaluateAssertionBudget({ files: smaller, budget: fixtureBudget });
  assert.deepEqual(result.increases, []);
  assert.equal(result.stale.length, 1);
  const shrunk = shrinkBudget({ files: smaller, budget: fixtureBudget });
  assert.deepEqual(evaluateAssertionBudget({ files: smaller, budget: shrunk }), clean);
  assert.equal(shrunk.files[fixture.path], undefined);
  const raised = [...files, { path: fixture.path, content: `${fixture.content}\nconst unchecked = 1 as unknown;` }];
  assert.equal(shrinkBudget({ files: raised, budget: fixtureBudget }).files[fixture.path].assertion, 1);
  assert.equal(evaluateAssertionBudget({ files: raised, budget: shrinkBudget({ files: raised, budget: fixtureBudget }) }).increases.length, 1);
});

test("a reviewed exception offsets only its kind; invalid and missing entries fail", () => {
  const existing = fixture;
  const path = existing.path;
  const seededFiles = seeded(path, existing.content + "\nconst unchecked = 1 as unknown;");
  const exception = { path, kind: "assertion", count: 1, reason: "Narrow runtime boundary needs this conversion" };
  assert.deepEqual(evaluateAssertionBudget({ files: seededFiles, budget: { ...fixtureBudget, exceptions: [exception] } }), clean);
  assert.equal(evaluateAssertionBudget({ files: seededFiles, budget: { ...fixtureBudget, exceptions: [{ ...exception, reason: " " }] } }).invalid.length, 1);
  assert.ok(evaluateAssertionBudget({ files: fixtureFiles, budget: { ...fixtureBudget, exceptions: [exception] } }).stale.length > 0);
  assert.ok(evaluateAssertionBudget({ files: fixtureFiles, budget: { ...fixtureBudget, exceptions: [{ ...exception, count: 1000 }] } }).invalid.some((message) => message.includes("exceeds current count")));
  const broken = { files: { ...fixtureBudget.files, [path]: { ...fixtureBudget.files[path], nonNull: 0, madeUp: 1 }, "apps/web/app/missing.ts": { assertion: 1 }, "apps/web/client/empty.ts": {} }, exceptions: [exception, exception, { ...exception, kind: "unknown", count: -1 }] };
  const findings = evaluateAssertionBudget({ files: fixtureFiles, budget: broken });
  assert.ok(findings.invalid.length >= 5);
  assert.ok(findings.stale.some((message) => message.includes("missing.ts")));
  assert.ok(findings.invalid.some((message) => message.includes("duplicate")));
  const malformed = evaluateAssertionBudget({ files: fixtureFiles, budget: { ...fixtureBudget, exceptions: [null, { ...exception, path: "apps/web/app/gone.ts" }] } });
  assert.ok(malformed.invalid.some((message) => message.includes("invalid")));
  assert.ok(malformed.stale.some((message) => message.includes("gone.ts")));
  assert.deepEqual(shrinkBudget({ files, budget }).exceptions, []);
});
