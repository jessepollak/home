import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { evaluateKnipGlobs, knipGlob } from "../knip-glob.mjs";
import { ts } from "../knip-source.mjs";
import { evaluateKnipExemptions, readKnipExemptionInput } from "../knip-exemptions.mjs";

const requireWeb = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const picomatch = createRequire(requireWeb.resolve("knip"))("picomatch");
// Pinned Picomatch outcomes for the dialect Knip matches with (`{ dot: true }`).
// They differ from Node's path.matchesGlob on dotfiles and on `[!...]` classes,
// which is exactly the divergence that must not let an exemption match nothing.
const cases = [
  ["components/ui/a.tsx", "components/ui/a.tsx", true],
  ["components/ui/A.tsx", "components/ui/a.tsx", false],
  ["components/ui/a.tsx.extra", "components/ui/a.tsx", false],
  ["components/ui/a.tsx", "ui/a.tsx", false],
  ["client/a.ts", "client/*.ts", true],
  ["client/.ts", "client/*.ts", true],
  ["components/ui/.candidate.tsx", "components/ui/*.tsx", true],
  ["", "*", false],
  ["client/", "client/*", false],
  ["client/a/b.ts", "client/*.ts", false],
  ["client/a.ts", "client/?.ts", true],
  ["client/ab.ts", "client/?.ts", false],
  ["client/a/b.ts", "client/?.ts", false],
  ["client/a.ts", "client/[ab].ts", true],
  ["client/c.ts", "client/[ab].ts", false],
  ["components/ui/dialog.tsx", "components/ui/[!d]ialog.tsx", true],
  ["components/ui/bialog.tsx", "components/ui/[!d]ialog.tsx", false],
  ["components/ui/bialog.tsx", "components/ui/[^d]ialog.tsx", true],
  ["components/ui/dialog.tsx", "components/ui/[^d]ialog.tsx", false],
  [".x", "[.]x", true],
  ["client/a.ts", "client/{a,b}.ts", true],
  ["client/b.ts", "client/{a,b}.ts", true],
  ["client/c.ts", "client/{a,b}.ts", false],
  ["client/c.ts", "client/{a,{b,c}}.ts", true],
  ["components/ui/dialog.tsx", "components/ui/@(dialog|kbd).tsx", true],
  ["components/ui/kbd.tsx", "components/ui/@(dialog|kbd).tsx", true],
  ["components/ui/progress.tsx", "components/ui/@(dialog|kbd).tsx", false],
  ["components/ui/dialog.tsx", "components/ui/[[:alpha:]]ialog.tsx", true],
  ["components/ui/dialog2.tsx", "components/ui/dialog{1..3}.tsx", true],
  ["components/ui/dialog4.tsx", "components/ui/dialog{1..3}.tsx", false],
  ["components/ui/dialog?.tsx", "components/ui/dialog\\?.tsx", true],
  ["x.ts", "**/x.ts", true],
  ["a/b/x.ts", "**/x.ts", true],
  ["a/x.ts", "a/**/x.ts", true],
  ["a/b/x.ts", "a/**/x.ts", true],
  ["a/b.ts", "**", true],
  ["a/", "**", true],
  ["client/home/x.ts", "client/home/**", true],
  ["client/home/a/b.ts", "client/home/**", true],
  ["client/home", "client/home/**", true],
  [".storybook/main.ts", "*/*.ts", true],
  ["a/.hidden.ts", "a/*", true],
  ["a/b/x.ts", "**/**/**/**/**/**/x.ts", true],
  ["a/b/y.ts", "**/**/**/**/**/**/x.ts", false],
  ["a/b/x.ts", "a/**/**/x.ts", true],
  ["a/b/x.ts", "a/**/**", true],
  ["scripts/a.mjs", "./scripts/*", true],
  ["./scripts/a.mjs", "./scripts/*", false],
  ["components/ui/candidate.tsx", 'components/"ui"/*.tsx', true],
  ["components/ui/b.tsx", 'components/ui/*"a"*.tsx', false],
];

test("knipGlob retains Knip's Picomatch outcomes", () => {
  assert.ok(cases.length > 0, "pinned glob outcomes must not be empty");
  for (const [file, pattern, expected] of cases) {
    assert.equal(knipGlob(file, pattern), expected, `${JSON.stringify(file)} against ${JSON.stringify(pattern)}`);
  }
});

test("adjacent globstars handle a deep non-match without pathological backtracking", { timeout: 2000 }, () => {
  const deepPath = `${"segment/".repeat(40)}y`;
  assert.equal(knipGlob(deepPath, "**/**/**/**/**/**/x"), false);
  assert.equal(knipGlob(`${"segment/".repeat(40)}x`, "**/**/**/**/**/**/x"), true);
});

test("star-heavy shapes report their budget instead of stalling the gate", { timeout: 20000 }, () => {
  const cases = [
    ["a*" + "a*".repeat(10) + "b?.tsx", "a".repeat(39) + "b.tsx"],
    ["?*" + "a*".repeat(10) + "b?.tsx", "a".repeat(39) + "b.tsx"],
    ["a*" + "a*".repeat(10) + "b*.tsx", "a".repeat(39) + "b/c.tsx"],
    ["components/ui/***" + "a*".repeat(10) + "b*.tsx", "components/ui/" + "a".repeat(39) + "b/c.tsx"],
  ];
  for (const [pattern, candidate] of cases) {
    const result = evaluateKnipGlobs([pattern], [candidate]);
    assert.match(result.failures.get(pattern), /exceeded the 5000 ms pattern evaluation budget/, pattern);
    assert.equal(result.matches.size, 0, pattern);
  }
});

test("literalized extglobs and degraded ranges are reported without losing interpreted syntax", () => {
  const literalized = ["+(a|aa)", "*(a|aa)", "+(ab|)", "+(*(ab))", "+(a|*)", "{10..12}", "{a..z..2}"];
  const result = evaluateKnipGlobs(literalized, ["a", "b", "ab", "10"]);
  for (const pattern of literalized) {
    assert.match(result.failures.get(pattern), /^cannot be interpreted: /, pattern);
    assert.throws(() => knipGlob("probe", pattern), /cannot be interpreted: /);
  }
  const interpreted = ["@(a|b)", "!(a)", "+(a)", "*(a)", "+(*(a))", "+(*(a)|*(b))", "{1..3}", "{a..z}"];
  const valid = evaluateKnipGlobs(interpreted, ["a", "b", "1"]);
  assert.deepEqual([...valid.failures], []);
  for (const pattern of interpreted) assert.ok(valid.matches.get(pattern).size, pattern);
});

test("safe repeated-extglob rewrites retain runtime verdicts and child matches", () => {
  const patterns = ["+(*(a))", "+(*(a)|*(b))"];
  const files = ["", "a", "aaa", "abba", "b", "c", "abc", ...patterns];
  const expected = new Map(patterns.map((pattern) => {
    const runtime = picomatch(pattern, { dot: true });
    for (const file of files) assert.equal(knipGlob(file, pattern), runtime(file), `${pattern}: ${JSON.stringify(file)}`);
    return [pattern, new Set(files.filter((file) => runtime(file)))];
  }));
  assert.deepEqual(evaluateKnipGlobs(patterns, files), { matches: expected, failures: new Map(), error: null });
});

test("quoted suffixes cannot hide unsupported brace ranges", () => {
  for (const [pattern, wrongCandidates] of [['{10..12}"x"', ["1", "2", "10x"]], ['{a..z..2}"x"', ["2", "ax"]]]) {
    for (const files of [[], wrongCandidates]) {
      const result = evaluateKnipGlobs([pattern], files);
      assert.match(result.failures.get(pattern), /^cannot be interpreted: brace ranges /, pattern);
      assert.equal(result.matches.size, 0);
      assert.equal(result.error, null);
    }
    for (const file of wrongCandidates) assert.throws(() => knipGlob(file, pattern), /cannot be interpreted: brace ranges /);
    assert.equal(knipGlob(pattern, pattern), true);
    assert.deepEqual(evaluateKnipGlobs([pattern], [pattern, ...wrongCandidates]), {
      matches: new Map([[pattern, new Set([pattern])]]), failures: new Map(), error: null,
    });
  }
});

test("exact literals survive compilation degradation and parser literalization", () => {
  const patterns = ["components/ui/a{b.tsx", "[z-a]", "+(a|aa)", "{10..12}"];
  for (const pattern of patterns) assert.equal(knipGlob(pattern, pattern), true, pattern);
  const result = evaluateKnipGlobs(patterns, patterns);
  assert.deepEqual([...result.failures], []);
  for (const pattern of patterns) assert.ok(result.matches.get(pattern).has(pattern), pattern);
});

const input = readKnipExemptionInput();
const parsed = ts.parseConfigFileTextToJson("knip.json", input.config);
assert.equal(parsed.error, undefined);
const checkedInPatterns = [
  ...parsed.config.entry.map((pattern) => pattern.replace(/!$/, "").replace(/^!/, "")),
  ...parsed.config.ignore.map((pattern) => pattern.replace(/^!/, "")),
  ...input.baseline.map(({ pattern }) => pattern.replace(/!$/, "").replace(/^!/, "")),
];

test("valid Picomatch character classes retain their measured literal and range matches", () => {
  assert.equal(knipGlob("!", "[!]"), true);
  assert.equal(knipGlob("a", "[!]"), false);
  assert.equal(knipGlob("!]", "[!]]"), true);
  assert.equal(knipGlob("x/!/a.tsx", "x/[!]/[ab].tsx"), true);
  assert.equal(knipGlob("x/[]/[ab].tsx", "x/[]/[ab].tsx"), true);
  for (const file of ["a", "z", "-", "b"]) assert.equal(knipGlob(file, "[a-z-a]"), true, file);
});

test("every supported glob shape is matched, never refused", () => {
  const shapes = [
    "[!]", "[!]]", "[!]x", "x/[!]/[ab].tsx", "[]]", "[]a]", "[^]]", "[^]a]", "[a-]", "[-a]", "[--0]", "[a-z]", "[a-z-a]", "[!a-z]", "[^a-z]",
    "[[:alpha:]]", "[a[:digit:]]", "[\\]]", "[{}]", "*.{ts,tsx}", "{1..3}", "@(a|b)", "!(a)", "a**b",
    "**/explorations/**", "client/*.ts", "@(dialog|kbd).tsx", "[[:alpha:]]x", "[[:alpha:]a]", "a\\*b", "{a,b}", "dialog{1..3}.tsx",
    "[a\\-z]", "a]", "a]b", "**/**/**/**/**/**/x.ts", "*a*b*c*", "*a*a*b*", "[\\\\]", "[^-0]",
    "[[:alpha:]*a*a*a*a*a*]", "\\*a\\*a\\*a\\*a\\*a", "\\{a\\}",
    "[]", "[^]", "[a-", "a}b", "}", "x/[]/[ab].tsx", "x/[]a[]",
  ];
  for (const pattern of shapes) assert.doesNotThrow(() => knipGlob("probe.ts", pattern), JSON.stringify(pattern));
  const result = evaluateKnipGlobs(checkedInPatterns, ["probe.ts"], { budgetMs: 5000 });
  assert.deepEqual([...result.failures], [], "checked-in patterns must compile and evaluate inside the budget");
});

const parseFailures = ["[z-a]", "[!z-a]", "[^z-a]", "x/}{.tsx", "x/[z-\\a].tsx", "a{b", "{", "\\", "a".repeat(65537)];

test("a pattern Picomatch's parser rejects is reported instead of matching nothing", () => {
  for (const pattern of parseFailures) {
    assert.throws(() => knipGlob("a.ts", pattern), (error) => {
      assert.ok(error.message.startsWith(`knip.json: pattern ${JSON.stringify(pattern)} cannot be compiled: `), error.message);
      return true;
    });
  }
  const result = evaluateKnipGlobs(parseFailures, ["x.ts"], { budgetMs: 5000 });
  for (const pattern of parseFailures) assert.match(result.failures.get(pattern), /^cannot be compiled: /, JSON.stringify(pattern));
  assert.deepEqual(evaluateKnipExemptions({
    config: { entry: [], ignore: ["[z-a]"] }, baseline: [], files: [], configPaths: ["knip.json"], budgetMs: 5000,
  }).invalid, ['knip.json: pattern "[z-a]" cannot be compiled: Invalid regular expression: /^(?:[z-a]\\/?)$/: Range out of order in character class']);
});

test("syntax Picomatch degrades to a literal is matched, not refused", () => {
  for (const pattern of ["[]", "[^]", "[a-", "a}b", "}", "x/[]/[ab].tsx"]) assert.equal(knipGlob(pattern, pattern), true, pattern);
});

test("bounded evaluation reports pathological matching and retains completed results", { timeout: 5000 }, () => {
  const pathological = "client/explorations/[a]*a*a*a*a*a*a*a*a*a*a*b.ts";
  const candidate = "client/explorations/" + "a".repeat(39) + "c.ts";
  const start = performance.now();
  const result = evaluateKnipGlobs([pathological], [candidate], { budgetMs: 250 });
  assert.match(result.failures.get(pathological), /exceeded the 250 ms pattern evaluation budget/);
  assert.equal(result.matches.size, 0);
  const benign = "client/explorations/*.ts";
  const skipped = "client/**/*.ts";
  const mixed = evaluateKnipGlobs([benign, pathological, skipped], [candidate], { budgetMs: 250 });
  assert.deepEqual(mixed.matches.get(benign), new Set([candidate]));
  assert.match(mixed.failures.get(pathological), /exceeded the 250 ms pattern evaluation budget/);
  assert.equal(mixed.failures.get(skipped), "was not evaluated because the pattern evaluation budget was exhausted");
  assert.ok(performance.now() - start < 3000, "both budgeted evaluations must return well under five seconds");
});

test("bounded evaluation returns empty maps only when there are no patterns", () => {
  for (const [patterns, files] of [[[], []], [[], ["a.ts"]]]) {
    assert.deepEqual(evaluateKnipGlobs(patterns, files, {}), { matches: new Map(), failures: new Map(), error: null });
  }
  const result = evaluateKnipGlobs(["[z-a]"], []);
  assert.match(result.failures.get("[z-a]"), /^cannot be compiled: /);
  assert.equal(result.matches.size, 0);
});

test("bounded evaluation reports child compile errors and continues to the next pattern", () => {
  const tooLong = "a".repeat(65537);
  const result = evaluateKnipGlobs([tooLong, "*.ts"], ["a.ts"]);
  assert.match(result.failures.get(tooLong), /^cannot be compiled: /);
  assert.deepEqual(result.matches.get("*.ts"), new Set(["a.ts"]));
});

test("pathological compilation is bounded even without candidate files", { timeout: 5000 }, () => {
  const pathological = "{".repeat(16000) + "a,b" + "}".repeat(16000);
  const start = performance.now();
  const result = evaluateKnipExemptions({
    config: { entry: [], ignore: [pathological] }, baseline: [], files: [], configPaths: ["knip.json"], budgetMs: 300,
  });
  assert.ok(performance.now() - start < 3000, "budgeted compilation must return well under five seconds");
  assert.equal(result.invalid.length, 1);
  assert.ok(result.invalid[0].startsWith('knip.json: pattern "{'));
  assert.ok(result.invalid[0].endsWith("exceeded the 300 ms pattern evaluation budget"));
  assert.deepEqual(result.unlisted, []);
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.unknownKeys, []);
  assert.deepEqual(result.extraConfigs, []);
});

test("child output buffer exhaustion is not reported as a timeout", { timeout: 30000 }, () => {
  const files = Array.from({ length: 40000 }, (_, i) => "x/" + i + "a".repeat(1024) + ".tsx");
  const result = evaluateKnipGlobs(["x/**"], files, { budgetMs: 60000 });
  assert.match(result.failures.get("x/**"), /^could not be evaluated: /);
  assert.doesNotMatch(result.failures.get("x/**"), /budget/);
  assert.match(result.error, /ENOBUFS/);
});

const runtimeMatches = (patterns, files, budgetMs) => {
  const script = [
    'import path from "node:path";',
    'let data = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => { data += chunk; });',
    'process.stdin.on("end", () => {',
    '  const { patterns, files } = JSON.parse(data);',
    '  process.stdout.write(JSON.stringify(patterns.map((pattern) => files.filter((file) => path.matchesGlob(file, pattern)))));',
    "});",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    input: JSON.stringify({ patterns, files }), timeout: budgetMs, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`runtime matcher comparison failed: ${result.error?.message ?? `exit code ${result.status}`}`);
  return JSON.parse(result.stdout);
};

test("checked-in exemptions agree with the runtime matcher over every web source path", { skip: typeof path.matchesGlob !== "function", timeout: 60000 }, () => {
  const patterns = [...new Set(checkedInPatterns)];
  const files = input.files.map(({ path: file }) => file);
  assert.ok(files.length > 0);
  assert.ok(patterns.length > 0);
  const gate = evaluateKnipGlobs(patterns, files, { budgetMs: 5000 });
  assert.deepEqual([...gate.failures], [], "checked-in patterns must evaluate inside the budget");
  const runtime = runtimeMatches(patterns, files, 30000);
  patterns.forEach((pattern, index) => {
    assert.deepEqual([...(gate.matches.get(pattern) ?? [])].sort(), [...runtime[index]].sort(), `runtime matcher divergence for ${JSON.stringify(pattern)}`);
  });
});
