import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BASELINE_PATH, countDisables, evaluateDisableBudget, isLintedSource, readBaseBudget, repositoryFiles, shrinkBudget } from "../lint-disables.mjs";

const budget = JSON.parse(readFileSync(new URL("../lint-disables-baseline.json", import.meta.url), "utf8"));
const files = repositoryFiles();
const clean = { increases: [], stale: [], invalid: [], raises: [] };
const path = "apps/web/shared/lint-disable-ratchet-fixture.tsx";
const initial = "// oxlint-disable-next-line home/a -- Reviewed fixture\nexport const value = 1;";
const fixture = (content = initial) => [{ path, content }];
const fixtureBudget = { files: { [path]: { "home/a": 1 } }, exceptions: [] };
const exception = { path, rule: "home/b", count: 1, issue: "#1250", reason: "Reviewed rule exception" };

test("linted tree exactly matches the shrinking baseline", () => {
  assert.ok(files.length > 0);
  const reference = readBaseBudget(process.env.BASE_REF || "main").files;
  assert.deepEqual(evaluateDisableBudget({ files, budget, reference }), clean);
});

test("base budget resolution uses the remote branch tip, fails without it and notes a missing remote baseline", () => {
  const calls = [];
  const original = { [path]: { "home/a": 1 } };
  const remoteGit = (args) => {
    calls.push(args);
    if (args[0] === "ls-tree") return BASELINE_PATH;
    if (args[0] === "show") return JSON.stringify({ files: original, exceptions: [] });
    throw new Error("unexpected command");
  };
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, remoteGit), { base: "origin/main", files: original, notes: [] });
  assert.deepEqual(calls, [["ls-tree", "--name-only", "origin/main", "--", BASELINE_PATH], ["show", `origin/main:${BASELINE_PATH}`]]);
  calls.length = 0;
  const localGit = (args) => {
    calls.push(args);
    if (args[0] === "ls-tree" && args[2] === "origin/main") throw new Error("remote unavailable");
    if (args[0] === "ls-tree") return BASELINE_PATH;
    if (args[0] === "show") return JSON.stringify({ files: original, exceptions: [] });
    throw new Error("unexpected command");
  };
  assert.throws(() => readBaseBudget("main", BASELINE_PATH, localGit), /Could not inspect origin\/main: remote unavailable/);
  assert.deepEqual(calls, [["ls-tree", "--name-only", "origin/main", "--", BASELINE_PATH]]);
  calls.length = 0;
  assert.throws(() => readBaseBudget("main", BASELINE_PATH, (args) => { calls.push(args); throw new Error("missing base"); }), /Could not inspect origin\/main: missing base/);
  assert.deepEqual(calls, [["ls-tree", "--name-only", "origin/main", "--", BASELINE_PATH]]);
  calls.length = 0;
  const absentGit = (args) => {
    calls.push(args);
    if (args[0] === "ls-tree") return "";
    throw new Error("unexpected command");
  };
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, absentGit), { base: "origin/main", files: null, notes: [`${BASELINE_PATH} is absent at origin/main; baseline raises were not checked.`] });
  assert.deepEqual(calls, [["ls-tree", "--name-only", "origin/main", "--", BASELINE_PATH]]);
  calls.length = 0;
  assert.throws(() => readBaseBudget("--independent", BASELINE_PATH, (args) => calls.push(args)), /Invalid base ref/);
  assert.deepEqual(calls, []);
  const baselineGit = (parsed) => (args) => {
    if (args[0] === "ls-tree") return BASELINE_PATH;
    if (args[0] === "show") return JSON.stringify(parsed);
    throw new Error("unexpected command");
  };
  for (const malformed of [{ files: [] }, { files: "corrupt" }, {}, [], "corrupt"]) {
    assert.throws(() => readBaseBudget("main", BASELINE_PATH, baselineGit(malformed)), /is invalid: budget.files must be an object/);
  }
  for (const malformed of [
    { files: { "apps/web/shared/ghost.ts": null }, exceptions: [] },
    { files: { "apps/web/app/a.ts": { "home/a": 0 } }, exceptions: [] },
    { files: { "scripts/gates/a.ts": { "home/a": 1 } }, exceptions: [] },
    { files: { "apps/web/app/a.ts": { "bad rule": 1 } }, exceptions: [] },
    { files: { "apps/web/shared/example.ts": {} }, exceptions: [] },
  ]) {
    assert.throws(() => readBaseBudget("main", BASELINE_PATH, baselineGit(malformed)), /is invalid: .*invalid (?:or empty baseline entry|.*baseline count)/);
  }
  assert.throws(() => readBaseBudget("main", BASELINE_PATH, baselineGit({ files: {} })), /is invalid: budget.exceptions must be an array/);
  assert.throws(() => readBaseBudget("main", BASELINE_PATH, baselineGit({ files: {}, exceptions: null })), /is invalid: budget.exceptions must be an array/);
  for (const exceptions of [[null], [{ path: "apps/web/app/a.ts", rule: "home/a", count: 1, issue: "not-linked", reason: "x" }]]) {
    assert.throws(() => readBaseBudget("main", BASELINE_PATH, baselineGit({ files: {}, exceptions })), /is invalid: .*invalid .* exception/);
  }
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, baselineGit({ files: {}, exceptions: [] })), { base: "origin/main", files: {}, notes: [] });
});

test("base budget resolution accepts the push event's commit SHA", () => {
  const revision = "a".repeat(40);
  const calls = [];
  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "ls-tree") return BASELINE_PATH;
    if (args[0] === "show") return JSON.stringify({ files: {}, exceptions: [] });
    throw new Error("unexpected command");
  };
  assert.deepEqual(readBaseBudget(revision, BASELINE_PATH, gitRunner), { base: revision, files: {}, notes: [] });
  assert.deepEqual(calls, [["ls-tree", "--name-only", revision, "--", BASELINE_PATH], ["show", `${revision}:${BASELINE_PATH}`]]);
});

test("CLI fails when the base ref cannot be resolved", () => {
  const result = spawnSync("node", ["scripts/gates/lint-disables.mjs"], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    env: { ...process.env, BASE_REF: "not-a-real-base-ref" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Base baseline unavailable or invalid/);
  assert.match(result.stderr, /Could not inspect origin\/not-a-real-base-ref/);
});

test("counts rules per real comment, including block and JSX comments", () => {
  const source = [
    "// oxlint-disable-next-line home/a -- reason",
    "/* oxlint-disable home/b, home/c -- reason */",
    "// eslint-disable-line home/d -- reason",
    "/* oxlint-disable-next-line home/b,",
    "   home/c -- multiline reason */",
    "const element = <div>{/* oxlint-disable-next-line home/e -- reason */}</div>;",
    "// oxlint-disable -- reason",
    "const literal = '// oxlint-disable home/f -- reason';",
    "const template = `/* oxlint-disable home/f -- reason */`;",
    "const regex = /oxlint-disable home\\/f -- reason/;",
    "const text = <div> // oxlint-disable home/f -- reason </div>;",
    "// tslint:disable home/f -- reason",
  ].join("\n");
  assert.deepEqual(countDisables(path, source), { "home/a": 1, "home/b": 2, "home/c": 2, "home/d": 1, "home/e": 1, "*": 1 });
  assert.deepEqual(countDisables(path, "const a = `// oxlint-disable home/f -- reason`; const b = /\\/\\/ oxlint-disable home\\/f -- reason/;"), {});
  const inherited = countDisables(path, "// oxlint-disable __proto__, constructor -- reason");
  assert.deepEqual(Object.entries(inherited), [["__proto__", 1], ["constructor", 1]]);
  assert.equal(evaluateDisableBudget({ files: fixture("// oxlint-disable __proto__ -- reason"), budget: { files: {}, exceptions: [] } }).increases.length, 1);
});

test("ordinary type and test assertions do not consume the disable budget", () => {
  const source = [
    "const value: unknown = 'fixture';",
    "const asserted = value as string;",
    "const nonNull = asserted!;",
    "class Fixture { value!: string; }",
    "const literal = { value: nonNull } as const;",
    "const checked = literal satisfies { value: string };",
    "const parsed = JSON.parse<string>('\\\"fixture\\\"');",
    "assert.equal(parsed, checked.value);",
    "expect(parsed).toBe('fixture');",
  ].join("\n");
  assert.deepEqual(countDisables(path, source), {});
  assert.deepEqual(evaluateDisableBudget({ files: fixture(source), budget: { files: {}, exceptions: [] } }), clean);
});

test("new disables require a reviewed linked exception", () => {
  assert.deepEqual(evaluateDisableBudget({ files: fixture(), budget: fixtureBudget }), clean);
  const seeded = fixture(`${initial}\n// oxlint-disable-next-line home/b -- reason\nexport const next = 2;`);
  const unlinked = evaluateDisableBudget({ files: seeded, budget: fixtureBudget });
  assert.deepEqual(unlinked, { increases: [`${path}: home/b 1 > 0; remove the disable or add a reviewed exception with a linked issue`], stale: [], invalid: [], raises: [] });
  for (const issue of ["#1250", "https://github.com/jessepollak/home/issues/1250"]) {
    assert.deepEqual(evaluateDisableBudget({ files: seeded, budget: { ...fixtureBudget, exceptions: [{ ...exception, issue }] } }), clean);
  }
  for (const changed of [
    { issue: undefined }, { issue: "not-linked" }, { issue: "#0" }, { issue: "#00" }, { issue: "https://github.com/jessepollak/home/issues/0" }, { issue: "https://example.com/issues/1250" }, { reason: " " }, { count: 0 }, { rule: "bad rule" }, { rule: ["home/a"] }, { path: "scripts/gates/file.ts" },
  ]) {
    assert.ok(evaluateDisableBudget({ files: seeded, budget: { ...fixtureBudget, exceptions: [{ ...exception, ...changed }] } }).invalid.length, JSON.stringify(changed));
  }
  assert.ok(evaluateDisableBudget({ files: seeded, budget: { ...fixtureBudget, exceptions: [exception, exception] } }).invalid.some((message) => message.includes("duplicate")));
  assert.ok(evaluateDisableBudget({ files: seeded, budget: { ...fixtureBudget, exceptions: [{ ...exception, count: 2 }] } }).invalid.some((message) => message.includes("exceeds current count")));
  assert.ok(evaluateDisableBudget({ files: fixture("// oxlint-disable-next-line home/a\nexport const value = 1;"), budget: fixtureBudget }).invalid.includes(`${path}: oxlint-disable directive needs " -- <reason>"`));
  assert.ok(evaluateDisableBudget({ files: fixture("// eslint-disable-line home/a --  \nexport const value = 1;"), budget: fixtureBudget }).invalid.includes(`${path}: oxlint-disable directive needs " -- <reason>"`));
  assert.ok(evaluateDisableBudget({ files: fixture("// oxlint-disable bad rule -- reason"), budget: fixtureBudget }).invalid.includes(`${path}: invalid rule name "bad rule" in an oxlint-disable directive`));
});

test("hand-raised baseline counts fail independently of scanned count", () => {
  const reference = { [path]: { "home/a": 1 } };
  const raised = { files: { [path]: { "home/a": 2 } }, exceptions: [] };
  const current = fixture(`${initial}\n// oxlint-disable-next-line home/a -- second use`);
  const message = `${path}: home/a baseline 2 > 1; the checked-in baseline may only shrink: merge or rebase the base branch if it lowered this count, or revert the raise and admit the disable through a reviewed exception with a linked issue`;
  assert.deepEqual(evaluateDisableBudget({ files: current, budget: raised, reference }).raises, [message]);
  assert.deepEqual(evaluateDisableBudget({ files: current, budget: raised, reference: null }).raises, []);
  assert.deepEqual(evaluateDisableBudget({ files: fixture(), budget: fixtureBudget, reference: { [path]: { "home/a": 2 } } }).raises, []);
});

test("empty rule tokens are invalid but do not discard valid rules", () => {
  const invalid = `${path}: invalid rule name "" in an oxlint-disable directive`;
  for (const [rules, counts] of [["home/a,", { "home/a": 1 }], [",home/a", { "home/a": 1 }], ["home/a,,home/b", { "home/a": 1, "home/b": 1 }]]) {
    const content = `// oxlint-disable-next-line ${rules} -- reason`;
    assert.deepEqual(countDisables(path, content), counts);
    assert.deepEqual(evaluateDisableBudget({ files: fixture(content), budget: { files: { [path]: counts }, exceptions: [] } }).invalid, [invalid]);
  }
  assert.deepEqual(countDisables(path, "// oxlint-disable -- reason"), { "*": 1 });
  const typescript = "// oxlint-disable-next-line @typescript-eslint/no-explicit-any -- reason";
  assert.deepEqual(countDisables(path, typescript), { "@typescript-eslint/no-explicit-any": 1 });
  assert.deepEqual(evaluateDisableBudget({ files: fixture(typescript), budget: { files: { [path]: { "@typescript-eslint/no-explicit-any": 1 } }, exceptions: [] } }), clean);
});

test("the reason separator is whitespace-delimited so consecutive hyphens stay in the rule", () => {
  const hyphenated = "// oxlint-disable-next-line home/no--foo -- reason";
  assert.deepEqual(countDisables(path, hyphenated), { "home/no--foo": 1 });
  assert.deepEqual(evaluateDisableBudget({ files: fixture(hyphenated), budget: { files: { [path]: { "home/no--foo": 1 } }, exceptions: [] } }), clean);
  assert.deepEqual(evaluateDisableBudget({ files: fixture(hyphenated), budget: { files: { [path]: { "home/no": 1 } }, exceptions: [] } }).increases, [`${path}: home/no--foo 1 > 0; remove the disable or add a reviewed exception with a linked issue`]);
  const unreasoned = "// oxlint-disable-next-line home/no--foo";
  assert.deepEqual(countDisables(path, unreasoned), { "home/no--foo": 1 });
  assert.deepEqual(evaluateDisableBudget({ files: fixture(unreasoned), budget: { files: { [path]: { "home/no--foo": 1 } }, exceptions: [] } }).invalid, [`${path}: oxlint-disable directive needs " -- <reason>"`]);
  assert.deepEqual(countDisables(path, "// oxlint-disable-next-line home/a -- mirrors the --flag contract"), { "home/a": 1 });
});

test("deletions remain stale until shrink, which never raises a count", () => {
  const smaller = fixture("export const value = 1;");
  assert.deepEqual(evaluateDisableBudget({ files: smaller, budget: fixtureBudget }).stale, [`${path}: home/a 0 < 1; run bun run disables:shrink`]);
  const shrunk = shrinkBudget({ files: smaller, budget: fixtureBudget });
  assert.deepEqual(shrunk, { files: {}, exceptions: [] });
  assert.deepEqual(evaluateDisableBudget({ files: smaller, budget: shrunk }), clean);
  const raised = fixture(`${initial}\n// oxlint-disable-line home/a -- second use`);
  assert.equal(shrinkBudget({ files: raised, budget: fixtureBudget }).files[path]["home/a"], 1);
  assert.equal(evaluateDisableBudget({ files: raised, budget: shrinkBudget({ files: raised, budget: fixtureBudget }) }).increases.length, 1);
  assert.deepEqual(shrinkBudget({ files: fixture("// oxlint-disable-next-line home/b -- reason"), budget: { ...fixtureBudget, exceptions: [exception] } }).exceptions, [exception]);
});

test("invalid budget entries and missing files report findings rather than throw", () => {
  for (const malformed of [null, undefined]) assert.ok(evaluateDisableBudget({ files: fixture(), budget: { ...fixtureBudget, exceptions: [malformed] } }).invalid.length);
  for (const malformed of [null, [], "bad"]) assert.ok(evaluateDisableBudget({ files: fixture(), budget: { ...fixtureBudget, files: malformed } }).invalid.length);
  assert.ok(evaluateDisableBudget({ files: fixture(), budget: { ...fixtureBudget, exceptions: null } }).invalid.length);
  const broken = { files: { ...fixtureBudget.files, "apps/web/app/gone.ts": { "home/b": 1 }, "apps/web/app/empty.ts": {}, "apps/web/app/invalid.ts": { "bad rule": 1, "home/b": -1 } }, exceptions: [{ ...exception, path: "apps/web/app/missing.ts" }] };
  const findings = evaluateDisableBudget({ files: fixture(), budget: broken });
  assert.ok(findings.invalid.length >= 3);
  assert.ok(findings.stale.includes("apps/web/app/gone.ts: baseline file missing; run bun run disables:shrink"));
  assert.ok(findings.stale.includes("apps/web/app/missing.ts: home/b exception file missing; remove the exception by hand"));
});

test("scope tracks Oxlint's linted source extensions and ignore patterns", () => {
  for (const file of ["apps/web/app/page.tsx", "apps/web/server/a.mts", "apps/web/stories/a.jsx", "apps/web/lib/a.cjs"]) assert.equal(isLintedSource(file), true, file);
  for (const file of ["apps/web/.storybook/static/mockServiceWorker.js", "apps/web/next-env.d.ts", "apps/web/node_modules/x.ts", "apps/web/.next/x.ts", "apps/web/out/a.js", "apps/web/build/a.js", "apps/web/storybook-static/a.js", "apps/web/stories/a.md", "scripts/gates/a.mjs"]) assert.equal(isLintedSource(file), false, file);
});
