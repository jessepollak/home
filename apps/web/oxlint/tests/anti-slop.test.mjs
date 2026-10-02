import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-anti-slop-", {
  path: (name) => `client/${name}.ts`,
});
const outsideRoot = await mkdtemp(path.join(tmpdir(), "home-oxlint-outside-root-"));
afterAll(() => rm(outsideRoot, { recursive: true, force: true }), budgetMs);

async function expectHits(found, count = 1) {
  expect(found).toHaveLength(count);
}

async function expectClean(found) {
  expect(found).toHaveLength(0);
}

describe("existing anti-slop rules", () => {
  it("rejects mixed chained assertions, including parentheses and angle syntax", async () => {
    const results = await lint({
      fixture1: "const value = input as unknown as User;",
      fixture2: "const value = (input as unknown) as User;",
      fixture3: "const value = <User>(<unknown>input);",
      fixture4: "const value = ({ id: 1 } as const) as const;",
    }, { rule: "no-chained-type-assertions" });
    await expectHits(results.fixture1);
    await expectHits(results.fixture2);
    await expectHits(results.fixture3);
    await expectClean(results.fixture4);
  }, budgetMs);

  it("keeps direct Reflect, parameter, and alias policies isolated", async () => {
    const results = await lint({
      fixture1: "Reflect.get(value, 'id'); Reflect.apply(fn, null, []);",
      fixture2: "value.id; fn();",
    }, { rule: "no-reflect-indirection" });
    await expectHits(results.fixture1, 2);
    await expectClean(results.fixture2);
    const results2 = await lint({
      fixture3: "function read(value: object) { return value; }",
      fixture4: "function read(value: { id: string }) { return value.id; }",
    }, { rule: "no-vague-object-parameters" });
    await expectHits(results2.fixture3);
    await expectClean(results2.fixture4);
    const results3 = await lint({
      fixture5: "type Payload = unknown;",
      fixture6: "type Payload = { id: string };",
    }, { rule: "no-unknown-aliases" });
    await expectHits(results3.fixture5);
    await expectClean(results3.fixture6);
  }, budgetMs);

  it("resolves direct, aliased, namespace, computed, and immutable Bun mock bindings", async () => {
    const results = await lint({
      fixture1: { path: "tests/fixture1.ts", code: `
      import { mock as bunMock } from "bun:test";
      import * as bunTest from "bun:test";
      const alias = bunMock;
      const namespaceAlias = bunTest;
      const { mock: destructuredAlias } = bunTest;
      bunMock.module("unreviewed", () => ({}));
      bunTest.mock.module("unreviewed", () => ({}));
      alias["module"]("unreviewed", () => ({}));
      namespaceAlias["mock"].module("unreviewed", () => ({}));
      destructuredAlias.module("unreviewed", () => ({}));
    ` },
    }, { rule: "exact-mock-modules" });
    await expectHits(results.fixture1, 5);
  }, budgetMs);

  it("ignores unrelated, shadowed, and mutable mock lookalikes", async () => {
    const results = await lint({
      fixture1: { path: "tests/fixture1.ts", code: `
      import { mock as bunMock } from "bun:test";
      const mock = { module() {} };
      mock.module("unreviewed", () => ({}));
      function run(bunMock: { module(name: string, factory: () => object): void }) {
        bunMock.module("unreviewed", () => ({}));
      }
      let mutableAlias = bunMock;
      mutableAlias = mock;
      mutableAlias.module("unreviewed", () => ({}));
      run(mock);
    ` },
    }, { rule: "exact-mock-modules" });
    await expectClean(results.fixture1);
  }, budgetMs);

  it("uses exact canonical paths and still rejects dynamic module names", async () => {
    const results = await lint({
      fixture1: { path: "tests/server-only-preload.ts", code: "import { mock } from 'bun:test'; mock.module('server-only', () => ({}));" },
      fixture2: { path: "nested/tests/server-only-preload.ts", code: "import { mock } from 'bun:test'; mock.module('server-only', () => ({}));" },
    }, { rule: "exact-mock-modules" });
    await expectClean(results.fixture1);
    await expectHits(results.fixture2, 1);
    const results2 = await lint({
      fixture3: { path: "tests/server-only-preload.ts", code: "import { mock } from 'bun:test'; const name = 'server-only'; mock.module(name, () => ({}));" },
    }, { rule: "exact-mock-modules" });
    await expectHits(results2.fixture3, 1);
  }, budgetMs);

  it("never derives an approved identity from an absolute path outside cwd", async () => {
    const results = await lint({
      fixture1: { path: path.join(outsideRoot, "collision/apps/web/tests/server-only-preload.ts"), code: "import { mock } from 'bun:test'; mock.module('server-only', () => ({}));" },
    }, { rule: "exact-mock-modules" });
    const diagnostics = results.fixture1;
    expect(diagnostics).toHaveLength(1);
  }, budgetMs);
});

describe("reducer accumulation rules", () => {
  it("recognizes reducer variants, immutable aliases, and nested returns for spread", async () => {
    const results = await lint({
      fixture1: "items.reduceRight((acc, item) => ({ ...acc, [item.id]: item }), {});",
      fixture2: "items['reduce']((acc, item) => { const alias = acc; if (item) { return { ...alias }; } return acc; }, {});",
      fixture3: "items.reduce((acc, item) => { const alias = acc; return [[{ ...alias }]]; }, {});",
      fixture4: "items.reduce((acc, item) => ({ ...item }), {});",
      fixture5: "items.reduce((acc, item) => { const alias = item; return { ...alias }; }, {});",
      fixture6: "function merge(acc, item) { return { ...acc, item }; } items.reduce(merge, {});",
    }, { rule: "no-reducer-accumulator-spread" });
    await expectHits(results.fixture1);
    await expectHits(results.fixture2);
    await expectHits(results.fixture3);
    await expectClean(results.fixture4);
    await expectClean(results.fixture5);
    await expectClean(results.fixture6);
  }, budgetMs);

  it("rejects Object.assign and Array.from accumulator copies", async () => {
    const results = await lint({
      fixture1: "items.reduce((acc, item) => Object.assign({}, acc, item), {});",
      fixture2: "items['reduceRight']((acc, item) => { const alias = acc; if (item) return Array['from'](alias); return acc; }, []);",
      fixture3: "items.reduce((acc, item) => Object.assign(acc, item), {});",
      fixture4: "items.reduce((acc, item) => { acc.push(Object.assign({}, item)); return acc; }, []);",
      fixture5: "const Object = custom; items.reduce((acc, item) => Object.assign({}, acc), {});",
      fixture6: "const Array = custom; items.reduce((acc, item) => Array.from(acc), []);",
      fixture7: "function copy(acc) { return Object.assign({}, acc); } items.reduce(copy, {});",
    }, { rule: "no-reduce-accumulator-copy" });
    await expectHits(results.fixture1);
    await expectHits(results.fixture2);
    await expectClean(results.fixture3);
    await expectClean(results.fixture4);
    await expectClean(results.fixture5);
    await expectClean(results.fixture6);
    await expectClean(results.fixture7);
  }, budgetMs);

  it("rejects all bounded array copy methods only with array evidence", async () => {
    const expressions = [
      "acc.concat(item)",
      "acc.slice()",
      "acc.toSpliced(0, 0, item)",
      "acc.toSorted()",
      "acc.toReversed()",
      "acc.with(0, item)",
    ];
    const found = await lint({
      ...Object.fromEntries(expressions.map((expression, index) => [`expression${index}`, `items.reduce((acc, item) => ${expression}, []);`])),
      initial: "const initial: Item[] = []; items.reduceRight((acc, item) => { const alias = acc; return alias['concat'](item); }, initial);",
      string: "items.reduce((acc, item) => acc.concat(item), '');",
      custom: "items.reduce((acc, item) => acc.concat(item), customCollection);",
      item: "items.reduce((acc, item) => item.slice(), []);",
      mutable: "items.reduce((acc, item) => { let alias = acc; alias = item; return alias.concat(item); }, []);",
    }, { rule: "no-reduce-accumulator-copy" });
    for (const expression of expressions) await expectHits(found[`expression${expressions.indexOf(expression)}`]);
    await expectHits(found.initial);
    await expectClean(found.string);
    await expectClean(found.custom);
    await expectClean(found.item);
    await expectClean(found.mutable);
  }, budgetMs);
});

describe("no-widen-then-assert", () => {
  it("reports known evidence widened through every approved broad type", async () => {
    const results = await lint({
      fixture1: "const source = { id: 'x' }; const erased: unknown = source; const value = erased as { id: string };",
      fixture2: "const source = { id: 'x' }; const erased: any = source; const value = <{ id: string }>(erased);",
      fixture3: "const source = { id: 'x' }; const erased: object = source; const value = (erased) as typeof source;",
      fixture4: "const source = { id: 'x' }; const erased: Record<string, unknown> = source; const value = erased as Record<'id', string>;",
      fixture5: "const source = { id: 'x' }; const erased = source as unknown; const value = erased as { id: string };",
    }, { rule: "no-widen-then-assert" });
    await expectHits(results.fixture1);
    await expectHits(results.fixture2);
    await expectHits(results.fixture3);
    await expectHits(results.fixture4);
    await expectHits(results.fixture5);
  }, budgetMs);

  it("keeps genuine boundaries, validation, mutation, and function boundaries clean", async () => {
    const results = await lint({
      fixture1: "declare const input: unknown; const value = input as { id: string };",
      fixture2: "declare const input: unknown; const erased: unknown = input; const value = erased as { id: string };",
      fixture3: "const source = { id: 'x' }; let erased: unknown = source; erased = read(); const value = erased as { id: string };",
      fixture4: "let source: { id: string } = { id: 'x' }; const erased: unknown = source; source = { id: 'y' }; const value = erased as { id: string };",
      fixture5: "const source = { id: 'x' }; const erased: unknown = source; function later() { return erased as { id: string }; }",
      fixture6: "const source = { id: 'x' }; const erased: unknown = source; if (isPayload(erased)) use(erased);",
      fixture7: "const source = { id: 'x' }; const checked = source satisfies Record<string, unknown>;",
    }, { rule: "no-widen-then-assert" });
    await expectClean(results.fixture1);
    await expectClean(results.fixture2);
    await expectClean(results.fixture3);
    await expectClean(results.fixture4);
    await expectClean(results.fixture5);
    await expectClean(results.fixture6);
    await expectClean(results.fixture7);
  }, budgetMs);

  it("does not report direct or same-width assertions", async () => {
    const results = await lint({
      fixture1: "const source = { id: 'x' }; const value = source as { id: string };",
      fixture2: "const source = { id: 'x' }; const erased: unknown = source; const value = erased as any;",
      fixture3: "const source = { id: 'x' }; const erased: object = source; const value = erased as object;",
      fixture4: "const source = { id: 'x' }; const erased: Record<string, unknown> = source; const value = erased as Readonly<Record<string, unknown>>;",
    }, { rule: "no-widen-then-assert" });
    await expectClean(results.fixture1);
    await expectClean(results.fixture2);
    await expectClean(results.fixture3);
    await expectClean(results.fixture4);
  }, budgetMs);

  it("keeps runtime-keyed maps and mutable Record fixtures clean", async () => {
    const results = await lint({
      fixture1: "const byRuntimeKey: Record<string, Item> = {}; for (const item of items) byRuntimeKey[item.id] = item;",
      fixture2: "const submissions: Record<string, string>[] = []; submissions.push(Object.fromEntries(new FormData(form)) as Record<string, string>);",
    }, { rule: "no-widen-then-assert" });
    await expectClean(results.fixture1);
    await expectClean(results.fixture2);
  }, budgetMs);

  it("catches burn-down escape cases but leaves genuine boundaries to the assertion ratchet", async () => {
    const results = await lint({
      fixture1: "const typed: Row = read(); const erased = typed as any; const value = erased as Row;",
      fixture2: "const source = { id: 'x' }; const alias = source; const erased: unknown = alias; const value = erased as { id: string };",
      fixture3: "const source = { id: 'x' }; const erased = <unknown>source; const value = <{ id: string }>erased;",
      fixture5: "const erased: unknown = await response.json(); const value = erased as Row;",
      fixture6: "const payload: unknown = JSON.parse(text); if (isRow(payload)) use(payload);",
    }, { rule: "no-widen-then-assert" });
    await expectHits(results.fixture1);
    await expectHits(results.fixture2);
    await expectHits(results.fixture3);
    const results2 = await lint({
      fixture4: "const source = { id: 'x' }; const erased: any = source; const value = erased as unknown as { id: string };",
    }, { rule: "no-chained-type-assertions" });
    await expectHits(results2.fixture4);
    await expectClean(results.fixture5);
    await expectClean(results.fixture6);
  }, budgetMs);
});
