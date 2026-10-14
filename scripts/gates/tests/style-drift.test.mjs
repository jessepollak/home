import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BASELINE_PATH, countStyleDrift, evaluateStyleDriftBudget, isStyleDriftSource, readBaseBudget, repositoryFiles, shrinkBudget } from "../style-drift.mjs";

const budget = JSON.parse(readFileSync(new URL("../../../apps/web/oxlint/policy/style-drift-baseline.json", import.meta.url), "utf8"));
const clean = { increases: [], stale: [], invalid: [], raises: [] };
const path = "client/style-drift-fixture.tsx";
const fixture = (content = 'export const value = "shadow-md";') => [{ path, content }];
const fixtureBudget = { files: { [path]: { "shadow-md": 1 } } };

test("style drift tree exactly matches the shrinking baseline", () => {
  const files = repositoryFiles();
  assert.ok(files.length > 0);
  const reference = readBaseBudget(process.env.BASE_REF || "main").files;
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget, reference }), clean);
});

test("new off-token utilities exceed the budget", () => {
  assert.deepEqual(evaluateStyleDriftBudget({ files: fixture(), budget: fixtureBudget }), clean);
  assert.deepEqual(evaluateStyleDriftBudget({ files: fixture('export const value = "shadow-md hover:shadow-md ease-out";'), budget: fixtureBudget }), {
    increases: [
      `${path}: ease-out 1 > 0; remove the off-token utility or fix it through an owned variant`,
      `${path}: shadow-md 2 > 1; remove the off-token utility or fix it through an owned variant`,
    ], stale: [], invalid: [], raises: [],
  });
});

test("deletions remain stale until shrink, which never raises a count", () => {
  const files = fixture('export const value = "allowed";');
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: fixtureBudget }).stale, [`${path}: shadow-md 0 < 1; run bun run style-drift:shrink`]);
  const smaller = shrinkBudget({ files, budget: fixtureBudget });
  assert.deepEqual(smaller, { files: {} });
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: smaller }), clean);
  const raised = fixture('export const value = "shadow-md shadow-md duration-200";');
  assert.deepEqual(shrinkBudget({ files: raised, budget: fixtureBudget }), fixtureBudget);
  assert.equal(evaluateStyleDriftBudget({ files: raised, budget: shrinkBudget({ files: raised, budget: fixtureBudget }) }).increases.length, 2);
  assert.deepEqual(evaluateStyleDriftBudget({ files: [], budget: fixtureBudget }).stale, [`${path}: baseline file missing; run bun run style-drift:shrink`]);
});

test("baseline raises fail independently of matching source counts", () => {
  const raised = { files: { [path]: { "shadow-md": 2, "duration-200": 1 } } };
  const files = fixture('export const value = "shadow-md shadow-md duration-200";');
  const findings = evaluateStyleDriftBudget({ files, budget: raised, reference: fixtureBudget.files });
  assert.deepEqual(findings.increases, []);
  assert.deepEqual(findings.stale, []);
  assert.deepEqual(findings.raises, [
    `${path}: duration-200 baseline 1 > 0; the checked-in baseline may only shrink: merge or rebase the base branch if it lowered this count, or revert the raise`,
    `${path}: shadow-md baseline 2 > 1; the checked-in baseline may only shrink: merge or rebase the base branch if it lowered this count, or revert the raise`,
  ]);
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: raised, reference: null }).raises, []);
  assert.deepEqual(evaluateStyleDriftBudget({ files: fixture(), budget: fixtureBudget, reference: raised.files }), clean);
});

test("invalid baseline shapes, paths, tokens and counts report rather than throw", () => {
  for (const malformed of [null, [], "corrupt", {}, { files: null }, { files: [] }, { files: "corrupt" }]) {
    assert.deepEqual(evaluateStyleDriftBudget({ files: [], budget: malformed }).invalid, ["budget.files must be an object"]);
  }
  for (const file of ["apps/web/client/a.tsx", "shared/a.ts", "client/../a.ts", "client/a.test.ts", "client/a.stories.tsx", "client/tests/a.ts", "components/ui/a.tsx", "client/a.css"]) {
    assert.ok(evaluateStyleDriftBudget({ files: [], budget: { files: { [file]: { "shadow-md": 1 } } } }).invalid.length, file);
  }
  for (const counts of [null, [], "corrupt", {}, { "shadow-md": 0 }, { "shadow-md": -1 }, { "shadow-md": 1.5 }, { "shadow-md": "1" }, { "hover:shadow-md": 1 }, { "shadow-raised": 1 }, { "shadow-md ease-out": 1 }, { unknown: 1 }]) {
    assert.ok(evaluateStyleDriftBudget({ files: fixture(), budget: { files: { [path]: counts } } }).invalid.length, JSON.stringify(counts));
  }
});

test("extraction counts string literals and template segments, not comments or JSX text", () => {
  const content = [
    '// "shadow-md"',
    'export const literal = "shadow-md hover:shadow-md";',
    'export const plain = `duration-150`;',
    'export const template = `ease-out ${literal} rounded-[3px] ${plain} duration-[80ms]`;',
    'export const jsx = <div className="shadow-2xs">ease-out</div>;',
    'export const raw = String.raw`shadow-[color:var(--shadow)]`;',
  ].join("\n");
  assert.deepEqual(countStyleDrift(path, content), {
    "shadow-md": 2, "duration-150": 1, "ease-out": 1, "rounded-[3px]": 1, "duration-[80ms]": 1, "shadow-2xs": 1, "shadow-[color:var(--shadow)]": 1,
  });
});

test("escaped no-substitution templates share cooked baseline keys with the rule", () => {
  const content = 'export const allowed = `duration-\\u0066ast`; export const drift = `duration-\\u0031\\u0035\\u0030`; export const interpolated = `duration-\\u0066ast ${""}`;';
  assert.deepEqual(countStyleDrift(path, content), { "duration-150": 1, [String.raw`duration-\u0066ast`]: 1 });
  const budget = { files: { [path]: { "duration-150": 1, [String.raw`duration-\u0066ast`]: 1 } } };
  assert.deepEqual(evaluateStyleDriftBudget({ files: fixture(content), budget }), clean);
});

test("file scope mirrors the production override relative to apps/web", () => {
  for (const file of ["app/page.tsx", "client/a.mts", "components/a.cjs", "client/explorations/a.tsx", "client/a.test.fixture.ts", "client/testing/a.ts"]) assert.equal(isStyleDriftSource(file), true, file);
  for (const file of ["server/a.ts", "shared/a.ts", "stories/a.tsx", "components/ui/a.tsx", "client/a.test.tsx", "client/a.stories.jsx", "client/tests/a.ts", "app/tests/a.ts", "components/a.css", "apps/web/client/a.tsx"]) assert.equal(isStyleDriftSource(file), false, file);
});

test("base budget reader resolves remote branches and push SHAs and notes an absent baseline", () => {
  for (const [ref, base] of [["main", "origin/main"], ["origin/main", "origin/main"], ["a".repeat(40), "a".repeat(40)]]) {
    const calls = [];
    const git = (args) => { calls.push(args); return args[0] === "ls-tree" ? BASELINE_PATH : JSON.stringify(fixtureBudget); };
    assert.deepEqual(readBaseBudget(ref, BASELINE_PATH, git), { base, files: fixtureBudget.files, notes: [] });
    assert.deepEqual(calls, [["ls-tree", "--name-only", base, "--", BASELINE_PATH], ["show", `${base}:${BASELINE_PATH}`]]);
  }
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, () => ""), { base: "origin/main", files: null, notes: [`${BASELINE_PATH} is absent at origin/main; baseline raises were not checked.`] });
  assert.throws(() => readBaseBudget("main", BASELINE_PATH, () => { throw new Error("missing base"); }), /Could not inspect origin\/main: missing base/);
  assert.throws(() => readBaseBudget("--independent", BASELINE_PATH, () => { assert.fail("git must not run"); }), /Invalid base ref/);
});

test("base budget reader rejects malformed JSON and invalid baselines", () => {
  const gitFor = (value) => (args) => args[0] === "ls-tree" ? BASELINE_PATH : value;
  assert.throws(() => readBaseBudget("main", BASELINE_PATH, gitFor("invalid JSON")), SyntaxError);
  for (const malformed of [{}, { files: [] }, { files: { [path]: {} } }, { files: { [path]: { "shadow-md": 0 } } }, { files: { "components/ui/a.tsx": { "shadow-md": 1 } } }]) {
    assert.throws(() => readBaseBudget("main", BASELINE_PATH, gitFor(JSON.stringify(malformed))), /is invalid/);
  }
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, gitFor('{"files":{}}')), { base: "origin/main", files: {}, notes: [] });
});

test("CLI fails when the base ref cannot be resolved", () => {
  const result = spawnSync("node", ["scripts/gates/style-drift.mjs"], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    env: { ...process.env, BASE_REF: "not-a-real-base-ref" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Base baseline unavailable or invalid/);
  assert.match(result.stderr, /Could not inspect origin\/not-a-real-base-ref/);
});
