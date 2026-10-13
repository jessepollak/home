import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BASELINE_PATH, baseBudgetCandidates, countDisables, evaluateDisableBudget, hasFatalFindings, isLintedSource, readBaseBudget, readBaseCounts, readBaseInput, repositoryFiles, shrinkBudget } from "../lint-disables.mjs";
import { gitFixtureEnv } from "./git-fixture-env.mjs";

const budget = JSON.parse(readFileSync(new URL("../lint-disables-baseline.json", import.meta.url), "utf8"));
const files = repositoryFiles();
const clean = { increases: [], notes: [], invalid: [], raises: [] };
const path = "apps/web/shared/lint-disable-ratchet-fixture.tsx";
const initial = "// oxlint-disable-next-line home/a -- Reviewed fixture\nexport const value = 1;";
const fixture = (content = initial) => [{ path, content }];
const fixtureBudget = { files: { [path]: { "home/a": 1 } }, exceptions: [] };
const exception = { path, rule: "home/b", count: 1, issue: "#1250", reason: "Reviewed rule exception" };

function createMirror(t) {
  const directory = mkdtempSync(`${tmpdir()}/home-lint-disables-`);
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(`${directory}/scripts/gates`, { recursive: true });
  mkdirSync(`${directory}/apps/web/shared`, { recursive: true });
  copyFileSync(`${root}/scripts/gates/lint-disables.mjs`, `${directory}/scripts/gates/lint-disables.mjs`);
  writeFileSync(`${directory}/apps/web/package.json`, "{}\n");
  symlinkSync(`${root}/apps/web/node_modules`, `${directory}/apps/web/node_modules`, "dir");
  const git = (args) => execFileSync("git", args, { cwd: directory, env: gitFixtureEnv(), encoding: "utf8" }).trim();
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  return { directory, git };
}

test("linted tree stays within the shrinking baseline", () => {
  assert.ok(files.length > 0);
  const { reference, baseCounts, baseExceptions, changeTime } = readBaseInput(process.env.BASE_REF || "main", { files, budget });
  const findings = evaluateDisableBudget({ files, budget, reference, baseCounts, baseExceptions, enforceFloor: changeTime });
  assert.deepEqual(findings.increases, []);
  assert.deepEqual(findings.invalid, []);
  assert.deepEqual(findings.raises, []);
  assert.equal(hasFatalFindings(findings), false);
});

test("base counts include counted rules and zero counts for absent paths", () => {
  const absent = "apps/web/shared/absent.ts";
  const base = "a".repeat(40);
  const counts = readBaseCounts(base, [path, absent], (args) => {
    if (args[1] === `${base}:${path}`) return `${initial}\n// oxlint-disable-next-line home/b -- another fixture rule\nexport const next = 2;`;
    throw new Error("path absent at base");
  });
  assert.deepEqual(counts, new Map([[path, { "home/a": 1, "home/b": 1 }], [absent, {}]]));
  assert.equal(counts.has(absent), true);
});

test("a stale baseline cannot admit a re-added disable", () => {
  const current = fixture(`${initial}\n// oxlint-disable-next-line home/a -- second fixture use\nexport const next = 2;`);
  const budget = { files: { [path]: { "home/a": 2 } }, exceptions: [] };
  assert.deepEqual(evaluateDisableBudget({ files: current, budget }), clean);
  const findings = evaluateDisableBudget({ files: current, budget, baseCounts: new Map([[path, { "home/a": 1 }]]) });
  assert.deepEqual(findings, {
    ...clean,
    increases: [`${path}: home/a 2 > 1; remove the disable or add a reviewed exception with a linked issue`],
  });
  assert.equal(hasFatalFindings(findings), true);
});

test("a directive on a path absent at the base revision fails", () => {
  const findings = evaluateDisableBudget({ files: fixture(), budget: fixtureBudget, baseCounts: new Map([[path, {}]]) });
  assert.deepEqual(findings, {
    ...clean,
    increases: [`${path}: home/a 1 > 0; remove the disable or add a reviewed exception with a linked issue`],
  });
  assert.equal(hasFatalFindings(findings), true);
});

test("inherited exceptions grant no headroom beyond the base directive count", () => {
  const two = `${initial}\n// oxlint-disable-next-line home/a -- second fixture use\nexport const next = 2;`;
  const budget = { files: { [path]: { "home/a": 1 } }, exceptions: [{ ...exception, rule: "home/a" }] };
  const input = { budget, baseCounts: new Map([[path, { "home/a": 2 }]]), baseExceptions: budget.exceptions };
  assert.deepEqual(evaluateDisableBudget({ ...input, files: fixture(two) }), clean);
  assert.deepEqual(evaluateDisableBudget({ ...input, files: fixture(`${two}\n// oxlint-disable-next-line home/a -- third fixture use\nexport const third = 3;`) }), {
    ...clean,
    increases: [`${path}: home/a 3 > 2; remove the disable or add a reviewed exception with a linked issue`],
  });
});

test("removing a used exception while keeping its directives fails", () => {
  const two = `${initial}\n// oxlint-disable-next-line home/a -- second fixture use\nexport const next = 2;`;
  const baseExceptions = [{ ...exception, rule: "home/a" }];
  const kept = { files: { [path]: { "home/a": 1 } }, exceptions: baseExceptions };
  assert.deepEqual(evaluateDisableBudget({ files: fixture(two), budget: kept, baseCounts: new Map([[path, { "home/a": 2 }]]), baseExceptions }), clean);
  const removed = { files: { [path]: { "home/a": 1 } }, exceptions: [] };
  assert.deepEqual(evaluateDisableBudget({ files: fixture(two), budget: removed, baseCounts: new Map([[path, { "home/a": 2 }]]), baseExceptions }), {
    ...clean,
    increases: [`${path}: home/a 2 > 1; remove the disable or add a reviewed exception with a linked issue`],
  });
});

test("removing a directive together with its exception passes", () => {
  const baseExceptions = [{ ...exception, rule: "home/a" }];
  const budget = { files: { [path]: { "home/a": 1 } }, exceptions: [] };
  assert.deepEqual(evaluateDisableBudget({ files: fixture(), budget, baseCounts: new Map([[path, { "home/a": 2 }]]), baseExceptions }), clean);

test("a hand-lowered baseline below the shrink floor fails", () => {
  const two = `${initial}\n// oxlint-disable-next-line home/a -- second fixture use\nexport const next = 2;`;
  const reviewed = { ...exception, rule: "home/a" };
  const reference = { [path]: { "home/a": 2 } };
  const lowered = { files: { [path]: { "home/a": 1 } }, exceptions: [reviewed] };
  const findings = evaluateDisableBudget({ files: fixture(two), budget: lowered, reference, baseCounts: new Map([[path, { "home/a": 3 }]]), baseExceptions: [reviewed], enforceFloor: true });
  assert.deepEqual(findings.invalid, [`${path}: home/a baseline 1 is below the shrink floor 2; a baseline may only be lowered by bun run disables:shrink`]);
  assert.equal(hasFatalFindings(findings), true);
  const shrunk = shrinkBudget({ files: fixture(two), budget: { files: { [path]: { "home/a": 2 } }, exceptions: [reviewed] } });
  assert.deepEqual(shrunk, { files: { [path]: { "home/a": 2 } }, exceptions: [reviewed] });
  assert.deepEqual(evaluateDisableBudget({ files: fixture(two), budget: shrunk, reference, baseCounts: new Map([[path, { "home/a": 3 }]]), baseExceptions: [reviewed], enforceFloor: true }).invalid, []);
});
});

test("an exception exceeding current directives is a non-failing note", () => {
  const findings = evaluateDisableBudget({ files: fixture("export const value = 1;"), budget: { files: {}, exceptions: [{ ...exception, rule: "home/a" }] } });
  assert.deepEqual(findings, {
    ...clean,
    notes: [`${path}: home/a exception exceeds current count; edit the exception by hand`],
  });
  assert.equal(hasFatalFindings(findings), false);
});

test("reviewed exceptions retain headroom when the base revision is tighter", () => {
  const current = fixture(`${initial}\n// oxlint-disable-next-line home/a -- second fixture use\nexport const next = 2;`);
  const budget = { files: { [path]: { "home/a": 2 } }, exceptions: [{ ...exception, rule: "home/a" }] };
  const findings = evaluateDisableBudget({ files: current, budget, baseCounts: new Map([[path, { "home/a": 1 }]]) });
  assert.deepEqual(findings, clean);
  assert.equal(hasFatalFindings(findings), false);
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
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, remoteGit), { base: "origin/main", files: original, exceptions: [], notes: [] });
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
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, absentGit), { base: "origin/main", files: null, exceptions: [], notes: [`${BASELINE_PATH} is absent at origin/main; baseline raises were not checked.`] });
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
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, baselineGit({ files: {}, exceptions: [] })), { base: "origin/main", files: {}, exceptions: [], notes: [] });
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
  assert.deepEqual(readBaseBudget(revision, BASELINE_PATH, gitRunner), { base: revision, files: {}, exceptions: [], notes: [] });
  assert.deepEqual(calls, [["ls-tree", "--name-only", revision, "--", BASELINE_PATH], ["show", `${revision}:${BASELINE_PATH}`]]);
});

test("base input counts the sorted union of directive and baseline paths", () => {
  const currentOnly = "apps/web/shared/a-current.ts";
  const referenceOnly = "apps/web/shared/b-reference.ts";
  const budgetOnly = "apps/web/shared/c-budget.ts";
  const withoutDisables = "apps/web/shared/d-clean.ts";
  const files = [{ path: withoutDisables, content: "export const value = 1;" }, { path: currentOnly, content: initial }];
  const reference = { [referenceOnly]: { "home/a": 1 } };
  const budget = { files: { [budgetOnly]: { "home/a": 1 }, [currentOnly]: { "home/a": 1 } }, exceptions: [] };
  assert.deepEqual(baseBudgetCandidates(files, budget, reference), [currentOnly, referenceOnly, budgetOnly]);
  assert.deepEqual(baseBudgetCandidates(files, { files: [] }, []), [currentOnly]);
  const calls = [];
  const baseExceptions = [{ ...exception, path: referenceOnly, rule: "home/a" }];
  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "ls-tree") return BASELINE_PATH;
    if (args[1] === `origin/main:${BASELINE_PATH}`) return JSON.stringify({ files: reference, exceptions: baseExceptions });
    if (args[1] === `origin/main:${referenceOnly}`) return initial;
    throw new Error("path absent at base");
  };
  assert.deepEqual(readBaseInput("main", { files, budget, gitRunner }), {
    base: "origin/main", reference, baseExceptions, notes: [],
    baseCounts: new Map([[currentOnly, {}], [referenceOnly, { "home/a": 1 }], [budgetOnly, {}]]),
    changeTime: true,
  });
  assert.deepEqual(calls.slice(2), [currentOnly, referenceOnly, budgetOnly].map((file) => ["show", `origin/main:${file}`]));
});

test("base input grants baseline-only budgets only when the base baseline is absent", () => {
  const calls = [];
  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "ls-tree") return "";
    throw new Error("unexpected command");
  };
  assert.deepEqual(readBaseInput("main", { files: fixture(), budget: fixtureBudget, gitRunner }), {
    base: "origin/main", reference: null, baseCounts: null, baseExceptions: [],
    notes: [`${BASELINE_PATH} is absent at origin/main; baseline raises were not checked.`],
    changeTime: true,
  });
  assert.deepEqual(calls, [["ls-tree", "--name-only", "origin/main", "--", BASELINE_PATH]]);
  assert.throws(() => readBaseInput("main", { files: fixture(), budget: fixtureBudget, gitRunner: () => { throw new Error("unreadable base"); } }), /Could not inspect origin\/main: unreadable base/u);
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
  assert.deepEqual(unlinked, { increases: [`${path}: home/b 1 > 0; remove the disable or add a reviewed exception with a linked issue`], notes: [], invalid: [], raises: [] });
  for (const issue of ["#1250", "https://github.com/jessepollak/home/issues/1250"]) {
    assert.deepEqual(evaluateDisableBudget({ files: seeded, budget: { ...fixtureBudget, exceptions: [{ ...exception, issue }] } }), clean);
  }
  for (const changed of [
    { issue: undefined }, { issue: "not-linked" }, { issue: "#0" }, { issue: "#00" }, { issue: "https://github.com/jessepollak/home/issues/0" }, { issue: "https://example.com/issues/1250" }, { reason: " " }, { count: 0 }, { rule: "bad rule" }, { rule: ["home/a"] }, { path: "scripts/gates/file.ts" },
  ]) {
    assert.ok(evaluateDisableBudget({ files: seeded, budget: { ...fixtureBudget, exceptions: [{ ...exception, ...changed }] } }).invalid.length, JSON.stringify(changed));
  }
  assert.ok(evaluateDisableBudget({ files: seeded, budget: { ...fixtureBudget, exceptions: [exception, exception] } }).invalid.some((message) => message.includes("duplicate")));
  assert.ok(evaluateDisableBudget({ files: seeded, budget: { ...fixtureBudget, exceptions: [{ ...exception, count: 2 }] } }).notes.some((message) => message.includes("exceeds current count")));
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

test("deletions report non-failing notes until shrink, which never raises a count", () => {
  const smaller = fixture("export const value = 1;");
  const findings = evaluateDisableBudget({ files: smaller, budget: fixtureBudget });
  assert.deepEqual(findings.notes, [`${path}: home/a 0 < 1; lower the baseline with bun run disables:shrink`]);
  assert.equal(hasFatalFindings(findings), false);
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
  assert.ok(findings.notes.includes("apps/web/app/gone.ts: baseline file missing; drop it with bun run disables:shrink"));
  assert.ok(findings.notes.includes("apps/web/app/missing.ts: home/b exception file missing; remove the exception by hand"));
});

test("concurrent removals merge safely in either order without admitting re-adds", (t) => {
  for (const order of [["pr-a", "pr-b"], ["pr-b", "pr-a"]]) {
    const { directory, git } = createMirror(t);
    const fixturePath = "apps/web/shared/ratchet-fixture.ts";
    const lines = [
      "// oxlint-disable-next-line home/a -- first fixture use",
      "export const first = 1;",
      "// oxlint-disable-next-line home/a -- second fixture use",
      "export const second = 2;",
    ];
    const writeFixture = (content) => writeFileSync(`${directory}/${fixturePath}`, `${content.join("\n")}\n`);
    const writeBudget = (count) => writeFileSync(`${directory}/${BASELINE_PATH}`, `${JSON.stringify({ files: { [fixturePath]: { "home/a": count } }, exceptions: [] }, null, 2)}\n`);
    const commit = (message) => {
      git(["add", "--", fixturePath, BASELINE_PATH]);
      git(["commit", "-m", message]);
      return git(["rev-parse", "HEAD"]);
    };
    const cli = (base, args = []) => spawnSync(process.execPath, ["scripts/gates/lint-disables.mjs", ...args], {
      cwd: directory,
      env: { ...gitFixtureEnv(), BASE_REF: base },
      encoding: "utf8",
    });
    writeFixture(lines);
    writeBudget(2);
    const m0 = commit("initial fixture");
    for (const [branch, removed] of [["pr-a", 0], ["pr-b", 2]]) {
      git(["checkout", "-b", branch, m0]);
      writeFixture(lines.filter((_, index) => index !== removed));
      writeBudget(1);
      commit(`remove directive on ${branch}`);
      const result = cli(m0);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
    }
    git(["checkout", "main"]);
    for (const branch of order) git(["merge", "--no-edit", branch]);
    const merged = readFileSync(`${directory}/${fixturePath}`, "utf8");
    assert.deepEqual(countDisables(fixturePath, merged), {});
    assert.equal(JSON.parse(readFileSync(`${directory}/${BASELINE_PATH}`, "utf8")).files[fixturePath]["home/a"], 1);
    const result = cli(m0);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /lower the baseline with bun run disables:shrink/u);

    const m1 = git(["rev-parse", "HEAD"]);
    git(["checkout", "-b", "pr-c"]);
    writeFixture(lines.filter((_, index) => index !== 2));
    commit("re-add directive on stale baseline");
    const readded = cli(m1);
    assert.equal(readded.status, 1, readded.stderr);
    assert.equal(readded.stderr, `${fixturePath}: home/a 1 > 0; remove the disable or add a reviewed exception with a linked issue\n`);

    git(["checkout", "main"]);
    const shrunk = cli(m0, ["--shrink"]);
    assert.equal(shrunk.status, 0, shrunk.stderr);
    assert.equal(shrunk.stderr, "");
    assert.deepEqual(JSON.parse(readFileSync(`${directory}/${BASELINE_PATH}`, "utf8")), { files: {}, exceptions: [] });
  }
});

test("concurrent removals with an inherited exception merge safely in either order", (t) => {
  for (const order of [["pr-a", "pr-b"], ["pr-b", "pr-a"]]) {
    const { directory, git } = createMirror(t);
    const fixturePath = "apps/web/shared/ratchet-fixture.ts";
    const lines = [
      "// oxlint-disable-next-line home/a -- first fixture use",
      "export const first = 1;",
      "// oxlint-disable-next-line home/a -- second fixture use",
      "export const second = 2;",
    ];
    const reviewed = { ...exception, path: fixturePath, rule: "home/a" };
    const writeFixture = (content) => writeFileSync(`${directory}/${fixturePath}`, `${content.join("\n")}\n`);
    const commit = (message) => {
      git(["add", "--", fixturePath, BASELINE_PATH]);
      git(["commit", "-m", message]);
      return git(["rev-parse", "HEAD"]);
    };
    const cli = (base, args = []) => spawnSync(process.execPath, ["scripts/gates/lint-disables.mjs", ...args], {
      cwd: directory,
      env: { ...gitFixtureEnv(), BASE_REF: base },
      encoding: "utf8",
    });
    writeFixture(lines);
    writeFileSync(`${directory}/${BASELINE_PATH}`, `${JSON.stringify({ files: { [fixturePath]: { "home/a": 1 } }, exceptions: [reviewed] }, null, 2)}\n`);
    const m0 = commit("initial fixture with exception");
    for (const [branch, removed] of [["pr-a", 0], ["pr-b", 2]]) {
      git(["checkout", "-b", branch, m0]);
      writeFixture(lines.filter((_, index) => index !== removed));
      const shrunk = cli(m0, ["--shrink"]);
      assert.equal(shrunk.status, 0, shrunk.stderr);
      assert.equal(shrunk.stderr, "");
      assert.deepEqual(JSON.parse(readFileSync(`${directory}/${BASELINE_PATH}`, "utf8")), { files: { [fixturePath]: { "home/a": 1 } }, exceptions: [reviewed] });
      commit(`remove directive and shrink on ${branch}`);
    }
    git(["checkout", "main"]);
    for (const branch of order) git(["merge", "--no-edit", branch]);
    assert.deepEqual(countDisables(fixturePath, readFileSync(`${directory}/${fixturePath}`, "utf8")), {});
    assert.deepEqual(JSON.parse(readFileSync(`${directory}/${BASELINE_PATH}`, "utf8")), { files: { [fixturePath]: { "home/a": 1 } }, exceptions: [reviewed] });
    const merged = cli(git(["rev-parse", "HEAD"]));
    assert.equal(merged.status, 0, merged.stderr);
    assert.equal(merged.stderr, "");
    assert.match(merged.stdout, /exception exceeds current count; edit the exception by hand/u);
  }
});

test("an exception cleanup and a baseline shrink merge safely in either order", (t) => {
  for (const order of [["pr-a", "pr-b"], ["pr-b", "pr-a"]]) {
    const { directory, git } = createMirror(t);
    const fixturePath = "apps/web/shared/ratchet-fixture.ts";
    const lines = [
      "// oxlint-disable-next-line home/a -- first fixture use",
      "export const first = 1;",
      "// oxlint-disable-next-line home/a -- second fixture use",
      "export const second = 2;",
      "// oxlint-disable-next-line home/a -- third fixture use",
      "export const third = 3;",
    ];
    const reviewed = { ...exception, path: fixturePath, rule: "home/a" };
    const covered = { files: { [fixturePath]: { "home/a": 2 } }, exceptions: [reviewed] };
    const writeFixture = (content) => writeFileSync(`${directory}/${fixturePath}`, `${content.join("\n")}\n`);
    const writeBaseline = (value) => writeFileSync(`${directory}/${BASELINE_PATH}`, `${JSON.stringify(value, null, 2)}\n`);
    const commit = (message) => {
      git(["add", "--", fixturePath, BASELINE_PATH]);
      git(["commit", "-m", message]);
      return git(["rev-parse", "HEAD"]);
    };
    const cli = (base, args = []) => spawnSync(process.execPath, ["scripts/gates/lint-disables.mjs", ...args], { cwd: directory, env: { ...gitFixtureEnv(), BASE_REF: base }, encoding: "utf8" });
    writeFixture(lines);
    writeBaseline(covered);
    const m0 = commit("initial fixture with a covered exception");

    git(["checkout", "-b", "pr-a", m0]);
    writeFixture(lines.filter((_, index) => index !== 0));
    writeBaseline({ files: { [fixturePath]: { "home/a": 2 } }, exceptions: [] });
    commit("remove one directive and its exception");
    assert.equal(cli(m0).status, 0);

    git(["checkout", "-b", "pr-b", m0]);
    writeFixture(lines.filter((_, index) => index !== 0));
    const shrunk = cli(m0, ["--shrink"]);
    assert.equal(shrunk.status, 0, shrunk.stderr);
    assert.deepEqual(JSON.parse(readFileSync(`${directory}/${BASELINE_PATH}`, "utf8")), covered);
    commit("remove one directive and shrink");

    git(["checkout", "main"]);
    for (const branch of order) git(["merge", "--no-edit", branch]);
    assert.deepEqual(countDisables(fixturePath, readFileSync(`${directory}/${fixturePath}`, "utf8")), { "home/a": 2 });
    assert.deepEqual(JSON.parse(readFileSync(`${directory}/${BASELINE_PATH}`, "utf8")), { files: { [fixturePath]: { "home/a": 2 } }, exceptions: [] });
    for (const base of [m0, git(["rev-parse", "HEAD"])]) {
      const merged = cli(base);
      assert.equal(merged.status, 0, merged.stderr);
      assert.equal(merged.stderr, "");
    }
  }
});

test("an addition and a removal merge safely in either order", (t) => {
  for (const order of [["pr-a", "pr-b"], ["pr-b", "pr-a"]]) {
    const { directory, git } = createMirror(t);
    const fixturePath = "apps/web/shared/ratchet-fixture.ts";
    const lines = [
      "// oxlint-disable-next-line home/a -- first fixture use",
      "export const first = 1;",
      "// oxlint-disable-next-line home/a -- second fixture use",
      "export const second = 2;",
    ];
    const added = [
      "// oxlint-disable-next-line home/a -- third fixture use",
      "export const third = 3;",
    ];
    const reviewed = { ...exception, path: fixturePath, rule: "home/a" };
    const writeFixture = (content) => writeFileSync(`${directory}/${fixturePath}`, `${content.join("\n")}\n`);
    const writeBaseline = (value) => writeFileSync(`${directory}/${BASELINE_PATH}`, `${JSON.stringify(value, null, 2)}\n`);
    const commit = (message) => {
      git(["add", "--", fixturePath, BASELINE_PATH]);
      git(["commit", "-m", message]);
      return git(["rev-parse", "HEAD"]);
    };
    const cli = (base, args = []) => spawnSync(process.execPath, ["scripts/gates/lint-disables.mjs", ...args], { cwd: directory, env: { ...gitFixtureEnv(), BASE_REF: base }, encoding: "utf8" });
    writeFixture(lines);
    writeBaseline({ files: { [fixturePath]: { "home/a": 2 } }, exceptions: [] });
    const m0 = commit("initial fixture");

    git(["checkout", "-b", "pr-a", m0]);
    writeFixture([lines[1], lines[2], lines[3]]);
    writeBaseline({ files: { [fixturePath]: { "home/a": 1 } }, exceptions: [] });
    commit("remove one directive and shrink");
    assert.equal(cli(m0).status, 0);

    git(["checkout", "-b", "pr-b", m0]);
    writeFixture([...lines, ...added]);
    writeBaseline({ files: { [fixturePath]: { "home/a": 2 } }, exceptions: [reviewed] });
    commit("add one directive with an exception");
    assert.equal(cli(m0).status, 0);

    git(["checkout", "main"]);
    for (const branch of order) git(["merge", "--no-edit", branch]);
    assert.deepEqual(countDisables(fixturePath, readFileSync(`${directory}/${fixturePath}`, "utf8")), { "home/a": 2 });
    assert.deepEqual(JSON.parse(readFileSync(`${directory}/${BASELINE_PATH}`, "utf8")), { files: { [fixturePath]: { "home/a": 1 } }, exceptions: [reviewed] });
    const merged = cli(m0);
    assert.equal(merged.status, 0, merged.stderr);
    assert.equal(merged.stderr, "");
  }
});

test("scope tracks Oxlint's linted source extensions and ignore patterns", () => {
  for (const file of ["apps/web/app/page.tsx", "apps/web/server/a.mts", "apps/web/stories/a.jsx", "apps/web/lib/a.cjs"]) assert.equal(isLintedSource(file), true, file);
  for (const file of ["apps/web/.storybook/static/mockServiceWorker.js", "apps/web/next-env.d.ts", "apps/web/node_modules/x.ts", "apps/web/.next/x.ts", "apps/web/out/a.js", "apps/web/build/a.js", "apps/web/storybook-static/a.js", "apps/web/stories/a.md", "scripts/gates/a.mjs"]) assert.equal(isLintedSource(file), false, file);
});
