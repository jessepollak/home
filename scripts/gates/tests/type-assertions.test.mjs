import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertionDebtReport, assertionExceptions, changedProductionTypeScript, countAssertions, evaluateAssertionDelta, isProductionTypeScript, mergeBaseRevision, resolveBaseRevision } from "../type-assertions.mjs";

const file = "apps/web/shared/ratchet-fixture.ts";
const original = "export const value = input as string;";
const exception = { path: file, kind: "assertion", count: 1, reason: "Reviewed boundary conversion" };
const clean = { increases: [], notes: [], invalid: [] };
const change = (content, baseContent = original, path = file, basePath = path) => ({ path, content, basePath, baseContent });
const evaluate = (changed, exceptions = [], baseExceptions = []) => evaluateAssertionDelta({ changed, exceptions, baseExceptions });

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

test("unchanged counts and identical content are clean", () => {
  assert.deepEqual(evaluate([change(original)]), clean);
  assert.deepEqual(evaluate([change("export const value = input as string;\nconst safe = 1;")]), clean);
});

test("added assertions of each kind fail only for that kind and file", () => {
  for (const [kind, suffix] of [
    ["assertion", "\nconst cast = input as unknown;"],
    ["nonNull", "\nconst forced = input!;"],
    ["suppression", "\n// eslint-disable-next-line x\n"],
    ["genericParse", "\nparseJsonColumn<Row>(source);"],
  ]) {
    const { increases, notes, invalid } = evaluate([change(original + suffix)]);
    const before = kind === "assertion" ? 1 : 0;
    const actual = before + 1;
    assert.deepEqual(increases, [`${file}: ${kind} ${actual} > ${before}; narrow the new use with a runtime guard or add a reviewed exception with a reason`]);
    assert.deepEqual(notes, []);
    assert.deepEqual(invalid, []);
  }
});

test("new files start from zero debt", () => {
  const newFile = "apps/web/client/new-ratchet.ts";
  assert.equal(evaluate([{ ...change("const cast = input as string;", original, newFile), baseContent: undefined }]).increases.length, 1);
  assert.deepEqual(evaluate([{ ...change("const safe = input;", original, newFile), baseContent: undefined }]), clean);
});

test("renames carry the source file's base debt", () => {
  assert.deepEqual(evaluate([change(original, original, "apps/web/client/renamed.ts", file)]), clean);
});

test("a rename parses its base content as the destination does", () => {
  const content = "const value = <number>input;";
  assert.deepEqual(evaluate([change(content, content, "apps/web/client/target.ts", "apps/web/client/source.tsx")]), clean);
});

test("a transferred exception does not grant new debt for a renamed path", () => {
  const renamed = "apps/web/client/renamed.ts";
  const moved = [change(original + "\nconst cast = input as unknown;", original, renamed, file)];
  assert.deepEqual(evaluate(moved, [{ ...exception, path: renamed }], [exception]).increases, [
    `${renamed}: assertion 2 > 1; narrow the new use with a runtime guard or add a reviewed exception with a reason`,
  ]);
});

test("a renamed destination's inherited exception grants no new debt", () => {
  const renamed = "apps/web/client/renamed.ts";
  const added = [change(original + "\nconst cast = input as unknown;", original, renamed, file)];
  const destinationException = { ...exception, path: renamed };
  for (const baseExceptions of [[destinationException], [exception, destinationException]]) {
    const inherited = baseExceptions.reduce((total, entry) => total + entry.count, 0);
    assert.deepEqual(evaluate(added, [{ ...destinationException, count: inherited }], baseExceptions), {
      ...clean,
      increases: [`${renamed}: assertion 2 > 1; narrow the new use with a runtime guard or add a reviewed exception with a reason`],
    });
    assert.deepEqual(evaluate(added, [{ ...destinationException, count: inherited + 1 }], baseExceptions), clean);
    assert.deepEqual(evaluate(added, [{ ...destinationException, count: inherited + 2 }], baseExceptions), {
      ...clean,
      notes: [`${renamed}: assertion exception allows 2 but this change adds 1; remove or narrow it`],
    });
  }
});

test("reviewed exceptions cover only newly granted debt", () => {
  const added = [change(original + "\nconst cast = input as unknown;")];
  assert.deepEqual(evaluate(added, [exception]), clean);
  assert.deepEqual(evaluate(added, [exception], [exception]).increases, [
    `${file}: assertion 2 > 1; narrow the new use with a runtime guard or add a reviewed exception with a reason`,
  ]);
  assert.deepEqual(evaluate(added, [{ ...exception, count: 2 }], [exception]), clean);
});

test("oversized and unused exceptions are non-failing notes", () => {
  for (const content of [original, original + "\nconst cast = input as unknown;"]) {
    const result = evaluate([change(content)], [{ ...exception, count: 2 }]);
    assert.deepEqual(result.increases, []);
    assert.deepEqual(result.invalid, []);
    assert.deepEqual(result.notes, [`${file}: assertion exception allows 2 but this change adds ${content === original ? 0 : 1}; remove or narrow it`]);
  }
});

test("duplicate exceptions sum for one path and kind", () => {
  const added = [change(original + "\nconst one = input as unknown;\nconst two = input as string;")];
  assert.deepEqual(evaluate(added, [exception, exception]), clean);
});

test("malformed exceptions are invalid findings", () => {
  const malformed = [
    { ...exception, path: "apps/web/client/example.test.ts" },
    { ...exception, kind: "unknown" },
    { ...exception, count: 0 },
    { ...exception, count: -1 },
    { ...exception, reason: " " },
    { path: file, kind: "assertion", count: 1 },
    null,
  ];
  const result = evaluate([], malformed);
  assert.deepEqual(result.increases, []);
  assert.deepEqual(result.notes, []);
  assert.equal(result.invalid.length, malformed.length);
  assert.ok(result.invalid.every((message) => message.includes("invalid") && message.includes("exception")));
});

test("unchanged paths cannot produce increases", () => {
  assert.deepEqual(evaluate([], [exception]).increases, []);
  assert.deepEqual(evaluate([change(original)]).increases, []);
});

test("the changed set follows renames, additions, moves, and untracked files", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const kept = "apps/web/client/account/basename-profile.ts";
  const renamed = "apps/web/client/account/cdp-sdk-provider.tsx";
  const source = "apps/web/client/account/session-client.ts";
  const moved = "apps/web/client/account/native-base-bridge.tsx";
  const movedFrom = "apps/web/client/account/moved-from.ts";
  const added = "apps/web/client/account/resource-failure.ts";
  const baseContent = "const probe = value as string;";
  const movedContent = "const moved = value as string;";
  const blob = "b".repeat(40);
  const runner = (args) => {
    if (args[0] === "diff") {
      assert.ok(args.includes("-z"));
      return `C100\0${source}\0apps/web/client/account/copied.ts\0M\0${kept}\0D\0${movedFrom}\0R100\0${source}\0${renamed}\0M\0apps/web/client/account/basename-profile.test.ts\0`;
    }
    if (args[0] === "ls-files") return `${moved}\0${added}\0apps/web/client/account/native-base-bridge.test.tsx\0`;
    if (args[0] === "rev-parse") return String(args.at(-1)) === `origin/main:${movedFrom}` ? blob : "";
    if (args[0] === "hash-object") return [kept, moved, added].includes(String(args.at(-1))) ? blob : "";
    if (args[0] === "cat-file") {
      if ([moved, added].some((file) => String(args.at(-1)).endsWith(file))) throw new Error("absent at the base revision");
      return "present";
    }
    if (args[0] === "show") return String(args.at(-1)).endsWith(movedFrom) ? movedContent : baseContent;
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const changed = changedProductionTypeScript({ base: "origin/main", cwd: root, gitRunner: runner });
  assert.deepEqual(changed.map(({ path, basePath, baseContent: content }) => [path, basePath, content === undefined ? null : content]), [
    [kept, kept, baseContent],
    [renamed, source, baseContent],
    [moved, movedFrom, movedContent],
    [added, added, null],
  ]);
});

test("a production path that comes from an excluded source starts from zero", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const excluded = "apps/web/client/account/legacy.test.ts";
  const target = "apps/web/client/account/cdp-sdk-provider.tsx";
  const blob = "c".repeat(40);
  const runner = (args) => {
    if (args[0] === "diff") {
      assert.ok(args.includes("-z"));
      return `D\0${excluded}\0`;
    }
    if (args[0] === "ls-files") return `${target}\0`;
    if (args[0] === "rev-parse") return String(args.at(-1)) === `origin/main:${excluded}` ? blob : "";
    if (args[0] === "hash-object") return String(args.at(-1)) === target ? blob : "";
    if (args[0] === "cat-file") throw new Error("absent at the base revision");
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const changed = changedProductionTypeScript({ base: "origin/main", cwd: root, gitRunner: runner });
  assert.deepEqual(changed.map(({ path, basePath, baseContent }) => [path, basePath, baseContent === undefined ? null : baseContent]), [[target, target, null]]);
});

test("a rewritten rename keeps its source's counts", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const source = "apps/web/client/account/session-client.ts";
  const destination = "apps/web/client/account/native-base-bridge.tsx";
  const baseContent = "const kept = value as string;";
  const runner = (args) => {
    if (args[0] === "diff") {
      assert.ok(args.includes("-z"));
      return `R51\0${source}\0${destination}\0`;
    }
    if (args[0] === "ls-files") return "";
    if (args[0] === "cat-file") return "present";
    if (args[0] === "show") return baseContent;
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const changed = changedProductionTypeScript({ base: "origin/main", cwd: root, gitRunner: runner });
  assert.deepEqual(changed.map(({ path, basePath, baseContent: content }) => [path, basePath, content]), [[destination, source, baseContent]]);
});

test("real git includes non-ASCII production additions and rename destinations", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "type-assertions-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null" };
  const gitRunner = (args, options = {}) => execFileSync("git", args, { cwd: options.cwd ?? cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const git = (...args) => gitRunner(args);
  const source = "apps/web/shared/source.ts";
  const added = "apps/web/shared/café.ts";
  const renamed = "apps/web/shared/renommé.ts";
  git("init", "--template=");
  git("config", "core.quotePath", "true");
  mkdirSync(path.join(cwd, "apps/web/shared"), { recursive: true });
  writeFileSync(path.join(cwd, source), original);
  git("add", "--", source);
  git("-c", "user.name=Gate Test", "-c", "user.email=gate-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "test fixture");
  renameSync(path.join(cwd, source), path.join(cwd, renamed));
  writeFileSync(path.join(cwd, added), "const added = input as number;");
  git("add", "--", "apps/web");
  const changed = changedProductionTypeScript({ base: "HEAD", cwd, gitRunner });
  assert.deepEqual(changed, [
    { path: added, basePath: added, content: "const added = input as number;", baseContent: undefined },
    { path: renamed, basePath: source, content: original, baseContent: original },
  ]);
  assert.deepEqual(evaluate(changed), {
    ...clean,
    increases: [`${added}: assertion 1 > 0; narrow the new use with a runtime guard or add a reviewed exception with a reason`],
  });
});

test("base resolution verifies commits and fetches unresolved branches", () => {
  const calls = [];
  const sha = "a".repeat(40);
  const runner = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "rev-parse" && args.at(-1) === "origin/topic" && calls.filter((call) => call.includes("origin/topic")).length === 1) throw new Error("not fetched");
    if (args[0] === "rev-parse" && args.at(-1) === `${sha}^{commit}`) return sha;
    if (args[0] === "rev-parse" && String(args.at(-1)).startsWith("0".repeat(40))) throw new Error("unresolvable");
    return "ok";
  };
  assert.equal(resolveBaseRevision({ base: sha, gitRunner: runner }), sha);
  assert.throws(() => resolveBaseRevision({ base: "0".repeat(40), gitRunner: runner }), /could not resolve base revision 0{40}; fetch more history or set BASE_REF/u);
  assert.equal(resolveBaseRevision({ base: "topic", gitRunner: runner }), "origin/topic");
  assert.ok(calls.includes("fetch --no-tags --depth=200 origin topic"));
  assert.throws(() => resolveBaseRevision({ base: "missing", gitRunner: () => { throw new Error("unavailable"); } }), /could not resolve base ref origin\/missing; fetch it or set BASE_REF/u);
  assert.throws(() => resolveBaseRevision({ base: sha, gitRunner: () => { throw new Error("unavailable"); } }), /could not resolve base revision a{40}; fetch more history or set BASE_REF/u);
  assert.equal(mergeBaseRevision({ revision: "origin/topic", gitRunner: () => "abc1234\n" }), "abc1234");
  assert.equal(mergeBaseRevision({ revision: "origin/topic", gitRunner: (args) => { if (args[1] === "--is-ancestor") return ""; throw new Error("unavailable"); } }), "origin/topic");
  assert.throws(() => mergeBaseRevision({ revision: "origin/topic", gitRunner: () => { throw new Error("unavailable"); } }), /could not determine the merge base of origin\/topic and HEAD/u);
});

test("production TypeScript does not add assertion debt relative to the base revision", () => {
  const { result } = assertionDebtReport();
  assert.deepEqual(result.increases, []);
  assert.deepEqual(result.invalid, []);
});

test("the report command prints the current debt inventory as JSON", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const report = JSON.parse(execFileSync("node", ["scripts/gates/type-assertions.mjs", "--report"], { cwd: root, encoding: "utf8" }));
  const declared = JSON.parse(readFileSync(new URL("../type-assertions-exceptions.json", import.meta.url), "utf8")).exceptions;
  assert.deepEqual(report.exceptions, declared);
  assert.ok(Object.keys(report.files).length > 0);
  for (const [path, counts] of Object.entries(report.files)) {
    assert.ok(isProductionTypeScript(path), path);
    for (const [kind, count] of Object.entries(counts)) {
      assert.ok(["assertion", "nonNull", "suppression", "genericParse"].includes(kind), `${path}: ${kind}`);
      assert.ok(Number.isSafeInteger(count) && count > 0, `${path}: ${kind} ${count}`);
    }
  }
});
