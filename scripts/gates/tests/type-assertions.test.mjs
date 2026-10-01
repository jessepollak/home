import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertionDebtReport, assertionExceptions, changedProductionTypeScript, changedScopedTypeScript, countAssertions, evaluateAssertionDelta, isProductionTypeScript, isTestOrStoryTypeScript, mergeBaseRevision, resolveBaseRevision } from "../type-assertions.mjs";
import { gitFixtureEnv } from "./git-fixture-env.mjs";

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

test("test and story scope follows the shared exclusion patterns without overlapping production", () => {
  const included = [
    "apps/web/app/a.test.ts", "apps/web/components/a.stories.tsx", "apps/web/server/tests/a.ts",
    "apps/web/client/testing/a.ts", "apps/web/client/account/dom-test-harness.ts",
    "apps/web/client/smoke-fixture-provider.tsx", "apps/web/stories/journeys/a.stories.tsx",
    "apps/web/client/account/a.test.helpers.ts", "apps/web/server/tests/a.mts", "apps/web/server/tests/a.cts",
    "apps/web/scripts/a.test.ts", "apps/web/oxlint/tests/a.ts", "apps/web/.storybook/a.stories.tsx",
    "apps/web/shared/explorations/a.test.ts", "apps/web/shared/explorations/a.stories.tsx",
    "apps/web/scripts/probe-test-harness.mts", "apps/web/shared/explorations/smoke-fixture-probe.cts",
    "apps/web/.storybook/foo-test-harness.cts",
  ];
  const excluded = [
    "apps/web/app/page.tsx", "apps/web/server/index.mts", "apps/web/shared/a.cts",
    "apps/web/instrumentation.node.ts", "apps/web/proxy.ts", "apps/web/next.config.ts",
    "apps/web/app/a.js", "apps/web/app/a.test.js", "apps/web/app/a.test.mjs", "apps/web/app/a.test.cjs",
    "apps/web/shared/explorations/a.ts", "apps/web/oxlint/rules/a.ts", "apps/web/stories/a.tsx",
    "apps/web/playwright.config.ts", "apps/web/.storybook/main.ts", "apps/web/scripts/a.ts",
    "scripts/gates/tests/a.ts",
    "apps/web/client/foo-test-harness.mts",
  ];
  for (const file of included) assert.equal(isTestOrStoryTypeScript(file), true, file);
  for (const file of excluded) assert.equal(isTestOrStoryTypeScript(file), false, file);
  assert.equal(isProductionTypeScript("apps/web/client/foo-test-harness.mts"), true);
  for (const file of [...included, ...excluded]) assert.equal(isProductionTypeScript(file) && isTestOrStoryTypeScript(file), false, file);
});

test("test assertion and non-null increases fail only in the test budget", () => {
  const testFile = "apps/web/client/example.test.ts";
  for (const [kind, content] of [
    ["assertion", "const seeded = value as unknown;"],
    ["nonNull", "const seeded = value!;"],
  ]) {
    const changed = [change(content, "const seeded = value;", testFile)];
    assert.deepEqual(evaluateAssertionDelta({ changed, exceptions: [], baseExceptions: [], scope: isTestOrStoryTypeScript }), {
      ...clean,
      increases: [`${testFile}: ${kind} 1 > 0; narrow the new use with a runtime guard or add a reviewed exception with a reason`],
    });
    assert.deepEqual(evaluate(changed), clean);
  }
});

test("reviewed exceptions are valid only in their own scope", () => {
  const testFile = "apps/web/client/example.test.ts";
  const testException = { ...exception, path: testFile };
  const changed = [change("const seeded = value as unknown;", "const seeded = value;", testFile)];
  assert.deepEqual(evaluateAssertionDelta({ changed, exceptions: [testException], baseExceptions: [], scope: isTestOrStoryTypeScript }), clean);
  assert.deepEqual(evaluate(changed, [testException]), {
    ...clean,
    invalid: [`${testFile}: invalid assertion exception (positive count and reason required)`],
  });
  assert.deepEqual(evaluateAssertionDelta({ changed: [], exceptions: [exception], baseExceptions: [], scope: isTestOrStoryTypeScript }), {
    ...clean,
    invalid: [`${file}: invalid assertion exception (positive count and reason required)`],
  });
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
  const env = gitFixtureEnv();
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

test("real git compares changed test TypeScript only in its own scope", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "type-assertions-tests-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = gitFixtureEnv();
  const gitRunner = (args, options = {}) => execFileSync("git", args, { cwd: options.cwd ?? cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const git = (...args) => gitRunner(args);
  const testFile = "apps/web/client/example.test.ts";
  const baseContent = "const seeded = value;";
  const content = "const seeded = value as unknown;";
  git("init", "--template=");
  mkdirSync(path.join(cwd, "apps/web/client"), { recursive: true });
  writeFileSync(path.join(cwd, testFile), baseContent);
  git("add", "--", testFile);
  git("-c", "user.name=Gate Test", "-c", "user.email=gate-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "test fixture");
  writeFileSync(path.join(cwd, testFile), content);
  const changed = changedScopedTypeScript({ base: "HEAD", scope: isTestOrStoryTypeScript, cwd, gitRunner });
  assert.deepEqual(changed, [{ path: testFile, basePath: testFile, content, baseContent }]);
  assert.deepEqual(evaluateAssertionDelta({ changed, exceptions: [], baseExceptions: [], scope: isTestOrStoryTypeScript }), {
    ...clean,
    increases: [`${testFile}: assertion 1 > 0; narrow the new use with a runtime guard or add a reviewed exception with a reason`],
  });
  assert.deepEqual(changedScopedTypeScript({ base: "HEAD", cwd, gitRunner }), []);
  assert.deepEqual(changedProductionTypeScript({ base: "HEAD", cwd, gitRunner }), []);
});

test("real git debt report enforces test and story increases with rename and exception inheritance", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "type-assertions-report-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = gitFixtureEnv();
  const realGitRunner = (args, options = {}) => execFileSync("git", args, { cwd: options.cwd ?? cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const git = (...args) => realGitRunner(args);
  const testFile = "apps/web/client/example.test.ts";
  const storyFile = "apps/web/stories/journeys/example.stories.tsx";
  const source = "apps/web/client/renamed-source.test.ts";
  const target = "apps/web/client/renamed-target.test.ts";
  const inheritedFile = "apps/web/client/inherited.test.ts";
  const productionExceptions = "scripts/gates/type-assertions-exceptions.json";
  const testExceptions = "scripts/gates/type-assertions-test-exceptions.json";
  git("init", "--template=");
  for (const directory of ["apps/web/client", "apps/web/stories/journeys", "scripts/gates"]) mkdirSync(path.join(cwd, directory), { recursive: true });
  writeFileSync(path.join(cwd, testFile), "const value = input as string;");
  writeFileSync(path.join(cwd, storyFile), "const story = input as string;");
  writeFileSync(path.join(cwd, source), "const kept = input as string;");
  writeFileSync(path.join(cwd, inheritedFile), "const value = input as string;");
  writeFileSync(path.join(cwd, productionExceptions), JSON.stringify({ exceptions: [] }));
  writeFileSync(path.join(cwd, testExceptions), JSON.stringify({ exceptions: [{ path: inheritedFile, kind: "assertion", count: 1, reason: "Reviewed fixture boundary" }] }));
  git("add", ".");
  git("-c", "user.name=Gate Test", "-c", "user.email=gate-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "test fixture");
  const fixtureCommit = String(git("rev-parse", "HEAD")).trim();
  const baseRef = process.env.BASE_REF;
  const baseIsSha = /^[0-9a-f]{40}$/iu.test(baseRef ?? "");
  git("update-ref", "refs/remotes/origin/main", fixtureCommit);
  if (baseRef && !baseIsSha) git("update-ref", `refs/remotes/origin/${baseRef}`, fixtureCommit);
  const gitRunner = (args, options) => {
    if (args[0] === "rev-parse" && args[1] === "--verify") return fixtureCommit;
    return realGitRunner(baseIsSha ? args.map((arg) => arg.replace(baseRef, fixtureCommit)) : args, options);
  };
  writeFileSync(path.join(cwd, testFile), "const value = input as string;\nconst cast = input as unknown;\nconst forced = input!;\n// eslint-disable-next-line x\nparseJsonColumn<Row>(source);");
  writeFileSync(path.join(cwd, storyFile), "const story = input as string;\nconst cast = input as unknown;");
  git("mv", source, target);
  writeFileSync(path.join(cwd, inheritedFile), "const value = input as string;\nconst cast = input as unknown;");
  const { base, results } = assertionDebtReport({ cwd, gitRunner });
  assert.equal(base, fixtureCommit);
  assert.deepEqual(results[0].result, clean);
  assert.deepEqual(results[1].result, {
    ...clean,
    increases: [
      `${testFile}: assertion 2 > 1; narrow the new use with a runtime guard or add a reviewed exception with a reason`,
      `${testFile}: genericParse 1 > 0; narrow the new use with a runtime guard or add a reviewed exception with a reason`,
      `${testFile}: nonNull 1 > 0; narrow the new use with a runtime guard or add a reviewed exception with a reason`,
      `${testFile}: suppression 1 > 0; narrow the new use with a runtime guard or add a reviewed exception with a reason`,
      `${inheritedFile}: assertion 2 > 1; narrow the new use with a runtime guard or add a reviewed exception with a reason`,
      `${storyFile}: assertion 2 > 1; narrow the new use with a runtime guard or add a reviewed exception with a reason`,
    ].sort(),
  });
});

test("real git reads base exceptions padded beyond 1 MiB without re-granting inherited debt", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "type-assertions-large-base-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = gitFixtureEnv();
  const realGitRunner = (args, options = {}) => execFileSync("git", args, { cwd: options.cwd ?? cwd, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  const git = (...args) => realGitRunner(args);
  const testFile = "apps/web/client/inherited.test.ts";
  const productionExceptions = "scripts/gates/type-assertions-exceptions.json";
  const testExceptions = "scripts/gates/type-assertions-test-exceptions.json";
  const paddedExceptions = JSON.stringify({ exceptions: [{ ...exception, path: testFile }] }) + "\n".repeat(1024 * 1024);
  assert.ok(Buffer.byteLength(paddedExceptions) > 1024 * 1024);
  git("init", "--template=");
  for (const directory of ["apps/web/client", "scripts/gates"]) mkdirSync(path.join(cwd, directory), { recursive: true });
  writeFileSync(path.join(cwd, testFile), original);
  writeFileSync(path.join(cwd, productionExceptions), JSON.stringify({ exceptions: [] }));
  writeFileSync(path.join(cwd, testExceptions), paddedExceptions);
  git("add", ".");
  git("-c", "user.name=Gate Test", "-c", "user.email=gate-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "test fixture");
  const fixtureCommit = String(git("rev-parse", "HEAD")).trim();
  const baseRef = process.env.BASE_REF;
  const baseIsSha = /^[0-9a-f]{40}$/iu.test(baseRef ?? "");
  git("update-ref", "refs/remotes/origin/main", fixtureCommit);
  if (baseRef && !baseIsSha) git("update-ref", `refs/remotes/origin/${baseRef}`, fixtureCommit);
  const gitRunner = (args, options) => {
    if (args[0] === "rev-parse" && args[1] === "--verify") return fixtureCommit;
    return realGitRunner(baseIsSha ? args.map((arg) => arg.replace(baseRef, fixtureCommit)) : args, options);
  };
  writeFileSync(path.join(cwd, testFile), original + "\nconst cast = input as unknown;");
  const expected = [clean, {
    ...clean,
    increases: [`${testFile}: assertion 2 > 1; narrow the new use with a runtime guard or add a reviewed exception with a reason`],
  }];
  const { base, results } = assertionDebtReport({ cwd, gitRunner });
  assert.equal(base, fixtureCommit);
  assert.deepEqual(results.map(({ result }) => result), expected);
  const defaultRunnerResults = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
    `import { assertionDebtReport } from ${JSON.stringify(new URL("../type-assertions.mjs", import.meta.url).href)}; console.log(JSON.stringify(assertionDebtReport({ cwd: process.cwd() }).results.map(({ result }) => result)));`,
  ], { cwd, env: { ...env, BASE_REF: fixtureCommit }, encoding: "utf8" }));
  assert.deepEqual(defaultRunnerResults, expected);
});

test("real git fails closed when the base tree lists an exceptions file with a missing blob", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "type-assertions-missing-blob-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = gitFixtureEnv();
  const git = (...args) => execFileSync("git", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const testFile = "apps/web/client/inherited.test.ts";
  const productionExceptions = "scripts/gates/type-assertions-exceptions.json";
  const testExceptions = "scripts/gates/type-assertions-test-exceptions.json";
  git("init", "--template=");
  git("config", "gc.auto", "0");
  for (const directory of ["apps/web/client", "scripts/gates"]) mkdirSync(path.join(cwd, directory), { recursive: true });
  writeFileSync(path.join(cwd, testFile), original);
  writeFileSync(path.join(cwd, productionExceptions), JSON.stringify({ exceptions: [] }));
  writeFileSync(path.join(cwd, testExceptions), JSON.stringify({ exceptions: [{ ...exception, path: testFile }] }));
  git("add", ".");
  git("-c", "user.name=Gate Test", "-c", "user.email=gate-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "test fixture");
  const fixtureCommit = String(git("rev-parse", "HEAD")).trim();
  const exceptionsBlob = String(git("rev-parse", `HEAD:${testExceptions}`)).trim();
  rmSync(path.join(cwd, ".git/objects", exceptionsBlob.slice(0, 2), exceptionsBlob.slice(2)));
  writeFileSync(path.join(cwd, testFile), original + "\nconst cast = input as unknown;");
  assert.equal(String(git("ls-tree", "-z", "--name-only", fixtureCommit, "--", testExceptions)), `${testExceptions}\0`);
  assert.throws(() => git("cat-file", "-e", `${fixtureCommit}:${testExceptions}`), (error) => error.status === 1);
  assert.throws(() => git("show", `${fixtureCommit}:${testExceptions}`), (error) => error.status === 128);
  const { base, results } = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e",
    `import { assertionDebtReport } from ${JSON.stringify(new URL("../type-assertions.mjs", import.meta.url).href)}; console.log(JSON.stringify(assertionDebtReport({ cwd: process.cwd() })));`,
  ], { cwd, env: { ...env, BASE_REF: fixtureCommit }, encoding: "utf8" }));
  assert.equal(base, fixtureCommit);
  assert.deepEqual(results[0].result, clean);
  assert.deepEqual(results[1].result.invalid, [`${testExceptions} at ${fixtureCommit}: invalid base exceptions file (unreadable, unparsable, or exceptions must be an array)`]);
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

test("each budget reads its own exceptions and fails closed on an unreadable head file", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "type-assertions-exceptions-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const productionPath = "scripts/gates/type-assertions-exceptions.json";
  const testPath = "scripts/gates/type-assertions-test-exceptions.json";
  const testException = { ...exception, path: "apps/web/client/example.test.ts" };
  mkdirSync(path.join(cwd, "scripts/gates"), { recursive: true });
  writeFileSync(path.join(cwd, productionPath), JSON.stringify({ exceptions: [exception] }));
  writeFileSync(path.join(cwd, testPath), JSON.stringify({ exceptions: [testException] }));
  const calls = [];
  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "merge-base") return "abc1234";
    if (args[0] === "rev-parse") return "resolved";
    if (args[0] === "diff" || args[0] === "ls-files") return "";
    if (args[0] === "ls-tree" && args.at(-1) === productionPath) return `${productionPath}\0`;
    if (args[0] === "ls-tree" && args.at(-1) === testPath) return "";
    if (args[0] === "show" && args[1] === `abc1234:${productionPath}`) return JSON.stringify({ exceptions: [exception] });
    if (args[0] === "show" && args[1] === `abc1234:${testPath}`) throw new Error("test exceptions not present at base");
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  assert.deepEqual(assertionExceptions({ cwd, gitRunner }), [exception]);
  assert.deepEqual(assertionExceptions({ path: testPath, cwd, gitRunner }), [testException]);
  assert.equal(assertionExceptions({ revision: "abc1234", path: testPath, cwd, gitRunner }), null);
  calls.length = 0;
  const { results } = assertionDebtReport({ cwd, gitRunner });
  assert.deepEqual(results.map(({ result }) => result), [clean, clean]);
  for (const exceptionsPath of [productionPath, testPath]) assert.ok(calls.some((args) => JSON.stringify(args) === JSON.stringify(["ls-tree", "-z", "--name-only", "abc1234", "--", exceptionsPath])));
  assert.ok(calls.some(([command, revisionPath]) => command === "show" && revisionPath === `abc1234:${productionPath}`));
  assert.ok(!calls.some(([command, revisionPath]) => command === "show" && revisionPath === `abc1234:${testPath}`));
  for (const content of [undefined, "not JSON", '{"exceptions": {}}']) {
    if (content === undefined) rmSync(path.join(cwd, testPath));
    else writeFileSync(path.join(cwd, testPath), content);
    assert.equal(assertionExceptions({ path: testPath, cwd, gitRunner }), null);
    const { results } = assertionDebtReport({ cwd, gitRunner });
    assert.deepEqual(results[0].result, clean);
    assert.deepEqual(results[1].result, {
      ...clean,
      invalid: [`${testPath}: invalid exceptions file (missing, unparsable, or exceptions must be an array)`],
    });
  }
});

test("existing unreadable or malformed base exceptions fail closed while absent files grant nothing", (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), "type-assertions-invalid-base-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const exceptionsPaths = ["scripts/gates/type-assertions-exceptions.json", "scripts/gates/type-assertions-test-exceptions.json"];
  mkdirSync(path.join(cwd, "scripts/gates"), { recursive: true });
  for (const file of exceptionsPaths) writeFileSync(path.join(cwd, file), JSON.stringify({ exceptions: [] }));
  for (const state of ["unreadable", "not JSON", '{"exceptions": {}}', "absent", "tree-unreadable"]) {
    const gitRunner = (args) => {
      if (args[0] === "merge-base") return "abc1234";
      if (args[0] === "rev-parse") return "resolved";
      if (args[0] === "diff" || args[0] === "ls-files") return "";
      if (args[0] === "ls-tree" && exceptionsPaths.includes(args.at(-1))) {
        assert.deepEqual(args.slice(0, -1), ["ls-tree", "-z", "--name-only", "abc1234", "--"]);
        if (state === "tree-unreadable") throw new Error("base tree cannot be read");
        return state === "absent" ? "" : `${args.at(-1)}\0`;
      }
      if (args[0] === "show" && exceptionsPaths.some((file) => args[1] === `abc1234:${file}`)) {
        if (state === "unreadable" || state === "absent") throw new Error("exceptions cannot be read");
        return state;
      }
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    };
    const { results } = assertionDebtReport({ cwd, gitRunner });
    assert.deepEqual(results.map(({ result }) => result), exceptionsPaths.map((file) => ({
      ...clean,
      invalid: state === "absent" ? [] : [`${file} at abc1234: invalid base exceptions file (unreadable, unparsable, or exceptions must be an array)`],
    })), state);
  }
});

test("neither TypeScript budget adds assertion debt relative to the base revision", () => {
  const { result, results } = assertionDebtReport();
  assert.equal(result, results[0].result);
  assert.deepEqual(results.map(({ budget }) => budget.reportKey), ["production", "testAndStory"]);
  for (const { budget, result } of results) {
    assert.deepEqual(result.increases, [], budget.label);
    assert.deepEqual(result.invalid, [], budget.label);
  }
});

test("the report command prints the current debt inventory as JSON", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const report = JSON.parse(execFileSync("node", ["scripts/gates/type-assertions.mjs", "--report"], { cwd: root, encoding: "utf8" }));
  assert.deepEqual(Object.keys(report), ["production", "testAndStory"]);
  for (const [key, scope, exceptionsFile] of [
    ["production", isProductionTypeScript, "type-assertions-exceptions.json"],
    ["testAndStory", isTestOrStoryTypeScript, "type-assertions-test-exceptions.json"],
  ]) {
    const declared = JSON.parse(readFileSync(new URL(`../${exceptionsFile}`, import.meta.url), "utf8")).exceptions;
    assert.deepEqual(report[key].exceptions, declared);
    assert.ok(Object.keys(report[key].files).length > 0, key);
    for (const [path, counts] of Object.entries(report[key].files)) {
      assert.ok(scope(path), path);
      assert.ok(Object.keys(counts).length > 0, path);
      for (const [kind, count] of Object.entries(counts)) {
        assert.ok(["assertion", "nonNull", "suppression", "genericParse"].includes(kind), `${path}: ${kind}`);
        assert.ok(Number.isSafeInteger(count) && count > 0, `${path}: ${kind} ${count}`);
      }
    }
  }
});
