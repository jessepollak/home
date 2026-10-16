import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyStyleUtility } from "../../../apps/web/oxlint/policy/style-drift.mjs";
import { BASELINE_PATH, countStyleDrift, evaluateStyleDriftBudget, isStyleDriftSource, readBaseBudget, repositoryFiles, shrinkBudget } from "../style-drift.mjs";

const budget = JSON.parse(readFileSync(new URL("../../../apps/web/oxlint/policy/style-drift-baseline.json", import.meta.url), "utf8"));
const families = ["shadow", "duration", "ease", "radius", "status-color", "status-motion", "status-mark"];
const scopes = ["components/ui/"];
const legacyFamilies = ["shadow", "duration", "ease", "radius"];
const clean = { increases: [], stale: [], invalid: [], raises: [] };
const path = "client/style-drift-fixture.tsx";
const fixture = (content = 'export const value = "shadow-md";') => [{ path, content }];
const fixtureBudget = { families, scopes, files: { [path]: { "shadow-md": 1 } } };

test("style drift tree exactly matches the shrinking baseline", () => {
  const files = repositoryFiles();
  assert.ok(files.length > 0);
  const reference = readBaseBudget(process.env.BASE_REF || "main");
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
  assert.deepEqual(smaller, { families, scopes, files: {} });
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: smaller }), clean);
  const raised = fixture('export const value = "shadow-md shadow-md duration-200";');
  assert.deepEqual(shrinkBudget({ files: raised, budget: fixtureBudget }), fixtureBudget);
  assert.equal(evaluateStyleDriftBudget({ files: raised, budget: shrinkBudget({ files: raised, budget: fixtureBudget }) }).increases.length, 2);
  assert.deepEqual(evaluateStyleDriftBudget({ files: [], budget: fixtureBudget }).stale, [`${path}: baseline file missing; run bun run style-drift:shrink`]);
});

test("baseline raises fail independently of matching source counts", () => {
  const raised = { families, scopes, files: { [path]: { "shadow-md": 2, "duration-200": 1 } } };
  const files = fixture('export const value = "shadow-md shadow-md duration-200";');
  const findings = evaluateStyleDriftBudget({ files, budget: raised, reference: fixtureBudget });
  assert.deepEqual(findings.increases, []);
  assert.deepEqual(findings.stale, []);
  assert.deepEqual(findings.raises, [
    `${path}: duration-200 baseline 1 > 0; the checked-in baseline may only shrink: merge or rebase the base branch if it lowered this count, or revert the raise`,
    `${path}: shadow-md baseline 2 > 1; the checked-in baseline may only shrink: merge or rebase the base branch if it lowered this count, or revert the raise`,
  ]);
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: raised, reference: null }).raises, []);
  assert.deepEqual(evaluateStyleDriftBudget({ files: fixture(), budget: fixtureBudget, reference: raised }), clean);
});

test("invalid baseline shapes, paths, tokens and counts report rather than throw", () => {
  for (const malformed of [null, [], "corrupt", {}, { files: null }, { files: [] }, { files: "corrupt" }]) {
    assert.deepEqual(evaluateStyleDriftBudget({ files: [], budget: malformed }).invalid, ["budget.families must list the ratcheted style-drift families exactly once", "budget.files must be an object", "budget.scopes must list components/ui/ exactly once so primitive status styling stays ratcheted"]);
  }
  for (const file of ["apps/web/client/a.tsx", "shared/a.ts", "client/../a.ts", "client/a.test.ts", "client/a.stories.tsx", "client/tests/a.ts", "components/ui/a.tsx", "client/a.css"]) {
    assert.ok(evaluateStyleDriftBudget({ files: [], budget: { families, scopes, files: { [file]: { "shadow-md": 1 } } } }).invalid.length, file);
  }
  for (const counts of [null, [], "corrupt", {}, { "shadow-md": 0 }, { "shadow-md": -1 }, { "shadow-md": 1.5 }, { "shadow-md": "1" }, { "hover:shadow-md": 1 }, { "shadow-raised": 1 }, { "shadow-md ease-out": 1 }, { unknown: 1 }]) {
    assert.ok(evaluateStyleDriftBudget({ files: fixture(), budget: { families, scopes, files: { [path]: counts } } }).invalid.length, JSON.stringify(counts));
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
  const budget = { families, scopes, files: { [path]: { "duration-150": 1, [String.raw`duration-\u0066ast`]: 1 } } };
  assert.deepEqual(evaluateStyleDriftBudget({ files: fixture(content), budget }), clean);
});

test("file scope mirrors the production override relative to apps/web", () => {
  for (const file of ["app/page.tsx", "client/a.mts", "components/a.cjs", "components/ui/a.tsx", "components/ui/status-texture.tsx", "client/explorations/a.tsx", "client/a.test.fixture.ts", "client/testing/a.ts"]) assert.equal(isStyleDriftSource(file), true, file);
  for (const file of ["server/a.ts", "shared/a.ts", "stories/a.tsx", "client/a.test.tsx", "client/a.stories.jsx", "client/tests/a.ts", "app/tests/a.ts", "components/a.css", "apps/web/client/a.tsx"]) assert.equal(isStyleDriftSource(file), false, file);
});

test("base budget reader resolves remote branches and push SHAs and notes an absent baseline", () => {
  for (const [ref, base] of [["main", "origin/main"], ["origin/main", "origin/main"], ["a".repeat(40), "a".repeat(40)]]) {
    const calls = [];
    const git = (args) => { calls.push(args); return args[0] === "ls-tree" ? BASELINE_PATH : JSON.stringify(fixtureBudget); };
    assert.deepEqual(readBaseBudget(ref, BASELINE_PATH, git), { base, families, scopes, files: fixtureBudget.files, notes: [] });
    assert.deepEqual(calls, [["ls-tree", "--name-only", base, "--", BASELINE_PATH], ["show", `${base}:${BASELINE_PATH}`]]);
  }
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, () => ""), { base: "origin/main", families: [], scopes: [], files: null, notes: [`${BASELINE_PATH} is absent at origin/main; baseline raises were not checked.`] });
  assert.throws(() => readBaseBudget("main", BASELINE_PATH, () => { throw new Error("missing base"); }), /Could not inspect origin\/main: missing base/);
  assert.throws(() => readBaseBudget("--independent", BASELINE_PATH, () => { assert.fail("git must not run"); }), /Invalid base ref/);
});

test("base budget reader rejects malformed JSON and invalid baselines", () => {
  const gitFor = (value) => (args) => args[0] === "ls-tree" ? BASELINE_PATH : value;
  assert.throws(() => readBaseBudget("main", BASELINE_PATH, gitFor("invalid JSON")), SyntaxError);
  for (const malformed of [{}, { files: [] }, { files: { [path]: {} } }, { files: { [path]: { "shadow-md": 0 } } }, { files: { "components/ui/a.tsx": { "shadow-md": 1 } } }]) {
    assert.throws(() => readBaseBudget("main", BASELINE_PATH, gitFor(JSON.stringify(malformed))), /is invalid/);
  }
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, gitFor('{"files":{}}')), { base: "origin/main", families: legacyFamilies, scopes: [], files: {}, notes: [] });
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


test("status utility families normalize variants and reject new occurrences with the texture fix", () => {
  const tokens = ["text-destructive", "hover:bg-destructive/10", "**:data-[slot=alert-title]:text-destructive", "!border-warning", "ring-status-positive/50!", "outline-status-caution", "fill-status-negative", "stroke-warning", "from-destructive", "via-warning", "to-status-positive", "divide-warning", "decoration-destructive", "accent-warning", "caret-destructive", "motion-safe:animate-spin", "animate-pulse", "animate-ping", "animate-bounce"];
  const files = fixture(`export const value = ${JSON.stringify(tokens.join(" "))};`);
  const findings = evaluateStyleDriftBudget({ files, budget: { families, scopes, files: {} } });
  assert.equal(findings.increases.length, 18);
  assert.ok(findings.increases.every((message) => message.endsWith("use a status texture from components/ui/status-texture; presenters return a texture name and owned components render it")));
  assert.equal(countStyleDrift(path, files[0].content)["text-destructive"], 2);
  const allowed = 'export const value = <Button variant="destructive" className="text-market-gain bg-market-loss animate-none text-warning-foreground bg-destructive-foreground text-destructiveish" />; export const name = "LoaderCircle destructive warning spin";';
  assert.deepEqual(countStyleDrift(path, allowed), {});
});

test("custom-property status colors and arbitrary status animations exceed the budget", () => {
  const tokens = ["text-(--warning)", "bg-(--destructive)", "text-[var(--warning)]", "bg-[var(--destructive)]", "border-[color:var(--status-positive)]", "ring-[var(--status-caution)]/50", "fill-(--status-negative)", "bg-[var(--status-negative)]/50", "text-(--brand-warning)", "bg-[var(--brand-destructive)]", "border-(--semantic-status-negative)", "ring-[color:var(--ui-status-caution)]/50", "text-(color:--brand-warning)/50", "fill-[var(--semantic-status-positive)]", "animate-[spin_1s_linear_infinite]", "animate-[pulse_2s_ease-in-out_infinite]", "animate-[ping_1s_cubic-bezier(0,0,0.2,1)_infinite]", "animate-[bounce_1s_infinite]", "animate-(--animate-spin)", "animate-(--animate-pulse)", "animate-(--my-spin)", "animate-(--animate-spin-slow)", "animate-(--pulse-slow)", "animate-(--bounce-in)", "animate-(--my-ping-slow)", "text-[var(--warning,var(--foreground))]", "bg-[color-mix(in_oklab,var(--warning),var(--background))]", "animate-[var(--animate-spin)]", "animate-[var(--animate-spin)_1s]", "hover:animate-[var(--animate-spin)]", "animate-[var(--fade)_spin_1s]", "animate-[1s_var(--fade)_pulse]", "animate-[var(--fade)_linear_spin_1s]", "text-(--warning,red)", "text-(--warning,var(--foreground))", "text-(--brand-warning,red)", "bg-[VAR(--warning)]", "bg-[Var(--warning)]", "text-[theme(colors.warning)]", "bg-[theme(colors.status-negative)]", "animate-[var(--missing,spin_1s_linear_infinite)]", "animate-[var(--missing,var(--also-missing,pulse_2s_infinite))]", "animate-(animation:--animate-spin)", "[color:var(--warning)]", "[color:var(--warning)]/50", "bg-[var(--warning,']')]", "[animation:spin_1s_linear_infinite]", "[animation:var(--animate-spin)]", "[animation-name:spin]", "[animation-name:var(--animate-spin)]", "text-(--missing,var(--warning))", "animate-(--missing,spin_1s_linear_infinite)", "animate-(--missing,var(--animate-spin))", "animate-[var(--missing,spin)_1s_linear_infinite]", "animate-[var(--missing,1s_spin)]"];
  const allowed = ["text-warning-foreground", "bg-destructive-foreground", "text-[var(--warning-foreground)]", "text-(--muted-foreground)", "text-(--brand-warning-foreground)", "text-[var(--surface)]", "bg-[var(--surface-raised)]", "text-market-gain", "animate-none", "animate-[fade_200ms_ease-out]", "animate-[var(--fade-in)_200ms]", "animate-[var(--fade)_linear_1s]", "animate-[wiggle_1s]", "animate-(--fade-in)", "animate-(--accordion-down)", "animate-(--animate-in)", "animate-(--animate-out)", "animate-(--animate-accordion-down)", "animate-(--animate-accordion-up)", "animate-(--animate-collapsible-down)", "animate-(--animate-collapsible-up)", "animate-(--animate-caret-blink)", "animate-(--spinning)", "animate-[var(--animate-in)]", "animate-[var(--animate-out)]", "animate-[var(--animate-accordion-down)]", "animate-[var(--animate-collapsible-up)]", "animate-[var(--animate-caret-blink)]", "m-(--drawer-inset,0px)", "pb-[max(1rem,calc(env(safe-area-inset-bottom)_-_var(--sheet-keyboard-inset,0px)))]!", "duration-fast", "rounded-lg", "content-['var(--warning)']", 'content-["theme(colors.warning)"]'];
  assert.deepEqual(classifyStyleUtility("bg-[var( --warning )]"), { family: "status-color", token: "bg-[var( --warning )]" });
  assert.deepEqual(classifyStyleUtility("shadow-[color:var(--shadow)]"), { family: "shadow", token: "shadow-[color:var(--shadow)]" });
  assert.deepEqual(countStyleDrift(path, 'export const value = "shadow-[color:var(--shadow)]";'), { "shadow-[color:var(--shadow)]": 1 });
  const files = fixture(`export const value = ${JSON.stringify([...tokens, ...allowed].join(" "))};`);
  const counts = {};
  for (const token of tokens) {
    const normalized = token.replace(/^hover:/u, "");
    counts[normalized] = (counts[normalized] ?? 0) + 1;
  }
  assert.deepEqual(countStyleDrift(path, files[0].content), counts);
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: { families, scopes, files: {} } }), {
    increases: Object.entries(counts).map(([token, count]) => `${path}: ${token} ${count} > 0; use a status texture from components/ui/status-texture; presenters return a texture name and owned components render it`).sort(),
    stale: [], invalid: [], raises: [],
  });
});

test("unterminated quoted contents classify without throwing", () => {
  const token = `content-['${"\\'".repeat(8192)}var(--warning)]`;
  assert.equal(classifyStyleUtility(token), null);
  assert.deepEqual(countStyleDrift(path, `export const value = ${JSON.stringify(token)};`), {});
});

test("directional borders and ring offsets share the status-color budget", () => {
  const prefixes = ["border-x", "border-y", "border-t", "border-r", "border-b", "border-l", "border-s", "border-e", "border-bs", "border-be", "ring-offset", "inset-ring", "inset-shadow", "text-shadow", "drop-shadow"];
  const colors = ["destructive", "warning", "status-positive", "status-caution", "status-negative"];
  const tokens = prefixes.flatMap((prefix) => colors.flatMap((color) => [`${prefix}-${color}`, `${prefix}-${color}/50`]));
  const counts = Object.fromEntries(tokens.map((token) => [token, 1]));
  const files = fixture(`export const value = ${JSON.stringify([...tokens, "border-t-border", "ring-offset-background"].join(" "))};`);
  assert.deepEqual(countStyleDrift(path, files[0].content), counts);
  assert.equal(evaluateStyleDriftBudget({ files, budget: { families, scopes, files: {} } }).increases.length, tokens.length);
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: { families, scopes, files: { [path]: counts } } }), clean);
});

test("spinner imports count each lucide specifier by its imported name only", () => {
  const content = [
    'import { Loader, Loader as Again, Loader2 as Spinner, LoaderCircle, LoaderPinwheel, LoaderIcon, Loader2Icon, LoaderCircleIcon, LoaderPinwheelIcon, CircleCheck } from "lucide-react";',
    'import { LoaderCircle as Unrelated } from "other-icons";',
    'import LoaderDefault, * as Icons from "lucide-react";',
    'export const value = <LoaderCircle />; export const name = "LoaderCircle <LoaderCircle>";',
  ].join("\n");
  const counts = { "<Loader>": 2, "<Loader2>": 1, "<LoaderCircle>": 1, "<LoaderPinwheel>": 1, "<LoaderIcon>": 1, "<Loader2Icon>": 1, "<LoaderCircleIcon>": 1, "<LoaderPinwheelIcon>": 1 };
  assert.deepEqual(countStyleDrift(path, content), counts);
  const files = fixture(content);
  const exact = { families, scopes, files: { [path]: counts } };
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: exact }), clean);
  assert.equal(evaluateStyleDriftBudget({ files, budget: { families, scopes, files: {} } }).increases.length, 8);
  assert.deepEqual(shrinkBudget({ files: fixture('import { Loader } from "lucide-react";'), budget: exact }), { families, scopes, files: { [path]: { "<Loader>": 1 } } });
});

test("owned status renderers exempt only status families", () => {
  const content = 'import { LoaderCircle } from "lucide-react"; export const value = "text-destructive animate-pulse duration-150 shadow-md ease-out rounded-[3px]";';
  for (const file of ["components/finance-rows.tsx", "components/load-error.tsx"]) {
    assert.deepEqual(countStyleDrift(file, content), { "duration-150": 1, "shadow-md": 1, "ease-out": 1, "rounded-[3px]": 1 });
  }
  for (const file of ["components/ui/status-texture.tsx", "components/ui/coverage-status-preview.tsx"]) assert.deepEqual(countStyleDrift(file, content), {});
  assert.equal(Object.keys(countStyleDrift("components/other.tsx", content)).length, 7);
  assert.ok(evaluateStyleDriftBudget({ files: [], budget: { families, scopes, files: { "components/finance-rows.tsx": { "text-destructive": 1 } } } }).invalid.length);
});

test("status baseline suppression is exact and shrink preserves the family inventory", () => {
  const exact = { families, scopes, files: { [path]: { "text-destructive": 1, "animate-spin": 1, "<LoaderCircle>": 1 } } };
  const content = 'import { LoaderCircle } from "lucide-react"; export const value = "hover:text-destructive motion-safe:animate-spin";';
  assert.deepEqual(evaluateStyleDriftBudget({ files: fixture(content), budget: exact }), clean);
  assert.deepEqual(shrinkBudget({ files: fixture(content), budget: exact }), exact);
  const extra = `${content} import { LoaderCircle as Again } from "lucide-react"; export const more = "text-destructive animate-spin";`;
  assert.equal(evaluateStyleDriftBudget({ files: fixture(extra), budget: exact }).increases.length, 3);
  assert.deepEqual(shrinkBudget({ files: fixture(extra), budget: exact }), exact);
  assert.deepEqual(shrinkBudget({ files: fixture('export const value = "allowed";'), budget: exact }), { families, scopes, files: {} });
});

test("new families may initialize only when the base does not ratchet them", () => {
  const files = fixture('export const value = "shadow-md text-destructive animate-spin"; import { LoaderCircle } from "lucide-react";');
  const next = { families, scopes, files: { [path]: { "shadow-md": 1, "text-destructive": 1, "animate-spin": 1, "<LoaderCircle>": 1 } } };
  for (const reference of [{ files: fixtureBudget.files }, { families: legacyFamilies, files: fixtureBudget.files }]) {
    assert.deepEqual(evaluateStyleDriftBudget({ files, budget: next, reference }), clean);
  }
  assert.equal(evaluateStyleDriftBudget({ files, budget: next, reference: fixtureBudget }).raises.length, 3);
  const oneNew = { families: [...legacyFamilies, "status-color"], files: fixtureBudget.files };
  const findings = evaluateStyleDriftBudget({ files, budget: next, reference: oneNew });
  assert.equal(findings.raises.length, 1);
  assert.match(findings.raises[0], /text-destructive baseline 1 > 0/);
  const oldRaise = { families, scopes, files: { [path]: { ...next.files[path], "duration-200": 1 } } };
  assert.equal(evaluateStyleDriftBudget({ files, budget: oldRaise, reference: { files: fixtureBudget.files } }).raises.length, 1);
});

test("family inventories are required, valid, and include each baseline entry's family", () => {
  for (const inventory of [undefined, null, [], "shadow", ["shadow", "shadow"], ["unknown"], legacyFamilies]) {
    assert.ok(evaluateStyleDriftBudget({ files: [], budget: { families: inventory, files: {} } }).invalid.length);
  }
  const invalid = { families: legacyFamilies, scopes, files: { [path]: { "text-destructive": 1, "<LoaderCircle>": 1 } } };
  assert.deepEqual(evaluateStyleDriftBudget({ files: [], budget: invalid }).invalid, ["budget.families must list the ratcheted style-drift families exactly once"]);
  const gitFor = (value) => (args) => args[0] === "ls-tree" ? BASELINE_PATH : JSON.stringify(value);
  assert.throws(() => readBaseBudget("main", BASELINE_PATH, gitFor(invalid)), /not listed in budget.families/);
  assert.throws(() => readBaseBudget("main", BASELINE_PATH, gitFor({ files: invalid.files })), /not listed in budget.families/);
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, gitFor({ files: fixtureBudget.files })).families, legacyFamilies);
  const removedFamily = { families: legacyFamilies, scopes, files: {} };
  assert.ok(evaluateStyleDriftBudget({ files: [], budget: removedFamily, reference: { families, scopes, files: {} } }).invalid.length);
});

test("status families are scanned in primitives except exact owners, while legacy families stay primitive-owned", () => {
  const content = 'import { LoaderCircle } from "lucide-react"; export const value = "text-destructive animate-spin shadow-md duration-150";';
  const counts = { "<LoaderCircle>": 1, "text-destructive": 1, "animate-spin": 1 };
  assert.deepEqual(countStyleDrift("components/ui/new-primitive.tsx", content), counts);
  for (const owner of ["components/ui/status-texture.tsx", "components/ui/coverage-status-preview.tsx"]) assert.deepEqual(countStyleDrift(owner, content), {}, owner);
  assert.deepEqual(countStyleDrift("components/ui/other.tsx", 'export const value = "shadow-md duration-150 ease-out rounded-[3px]";'), {});
  const files = [{ path: "components/ui/new-primitive.tsx", content }, { path: "components/ui/status-texture.tsx", content }];
  const findings = evaluateStyleDriftBudget({ files, budget: { families, scopes, files: {} } });
  assert.deepEqual(findings.increases.map((message) => message.split(":")[0]), ["components/ui/new-primitive.tsx", "components/ui/new-primitive.tsx", "components/ui/new-primitive.tsx"]);
});

test("primitive baselines are status-only, need the scope marker, and may be initialized once", () => {
  const file = "components/ui/new-primitive.tsx";
  const files = [{ path: file, content: 'export const value = "text-destructive";' }];
  const withScope = { families, scopes, files: { [file]: { "text-destructive": 1 } } };
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: withScope }), clean);
  for (const bad of [undefined, [], ["components/"], ["components/ui/", "components/"]]) {
    assert.ok(evaluateStyleDriftBudget({ files, budget: { ...withScope, scopes: bad } }).invalid.length, JSON.stringify(bad));
  }
  assert.ok(evaluateStyleDriftBudget({ files: [], budget: { families, files: {} } }).invalid.length);
  assert.deepEqual(evaluateStyleDriftBudget({ files: [], budget: { families, scopes, files: {} } }), clean);
  assert.deepEqual(readBaseBudget("main", BASELINE_PATH, (args) => args[0] === "ls-tree" ? BASELINE_PATH : JSON.stringify({ families, files: {} })).scopes, []);
  assert.ok(evaluateStyleDriftBudget({ files, budget: { families, scopes, files: { [file]: { "shadow-md": 1 } } } }).invalid.length);
  for (const owner of ["components/ui/status-texture.tsx", "components/ui/coverage-status-preview.tsx"]) {
    assert.ok(evaluateStyleDriftBudget({ files: [], budget: { families, scopes, files: { [owner]: { "text-destructive": 1 } } } }).invalid.length, owner);
  }
  const unscoped = { families, files: {} };
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: withScope, reference: unscoped }), clean);
  const scoped = { families, scopes, files: {} };
  assert.deepEqual(evaluateStyleDriftBudget({ files, budget: withScope, reference: scoped }).raises, [
    `${file}: text-destructive baseline 1 > 0; the checked-in baseline may only shrink: merge or rebase the base branch if it lowered this count, or revert the raise`,
  ]);
  assert.deepEqual(shrinkBudget({ files: [], budget: withScope }), { families, scopes, files: {} });
});
