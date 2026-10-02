import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BASELINE_PATH, evaluateDisableBudget, repositoryFiles } from "../lint-disables.mjs";
import { EXEMPTIONS_BASELINE_PATH, evaluateExemptions, readExemptionInput, shrinkExemptions } from "../lint-exemptions.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const clean = { unlisted: [], stale: [], invalid: [] };
const record = (glob = "client/**", rule = "home/example", reason = "Reviewed fixture exemption") => ({ glob, rule, reason });
const fixture = (files = ["client/**"], value = "off") => ({ overrides: [{ files, rules: { "home/example": value } }] });
const evaluate = (config, baseline = []) => evaluateExemptions({ config, baseline });
const cli = (args = [], cwd = root) => spawnSync("node", ["scripts/gates/lint-exemptions.mjs", ...args], { cwd, encoding: "utf8" });

function createMirror(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "home-lint-exemptions-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "scripts/gates"), { recursive: true });
  mkdirSync(path.join(directory, "apps/web"), { recursive: true });
  copyFileSync(path.join(root, "scripts/gates/lint-exemptions.mjs"), path.join(directory, "scripts/gates/lint-exemptions.mjs"));
  writeFileSync(path.join(directory, "apps/web/package.json"), "{}\n");
  symlinkSync(path.join(root, "apps/web/node_modules"), path.join(directory, "apps/web/node_modules"), "dir");
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  return directory;
}

test("shipped config and reviewed baseline agree and shrink leaves the baseline unchanged", () => {
  const input = readExemptionInput();
  assert.deepEqual(evaluateExemptions(input), clean);
  assert.deepEqual(shrinkExemptions(input), input.baseline);
});

test("seeded override and top-level exemptions require reviewed baseline entries", () => {
  assert.deepEqual(evaluate(fixture()), {
    ...clean, unlisted: ["home/example on client/**: add a reviewed baseline entry or restore the rule"],
  });
  assert.deepEqual(evaluate({ rules: { "home/example": "off" } }), {
    ...clean, unlisted: ["home/example on **: add a reviewed baseline entry or restore the rule"],
  });
});

test("removing a reviewed exemption is stale until shrink restores a clean reduction", () => {
  const config = fixture();
  const baseline = [record()];
  assert.deepEqual(evaluate(config, baseline), clean);
  delete config.overrides[0].rules["home/example"];
  assert.deepEqual(evaluate(config, baseline), {
    ...clean, stale: ["client/**: home/example exemption is stale; run bun run lint-exemptions:shrink"],
  });
  const shrunk = shrinkExemptions({ config, baseline });
  assert.deepEqual(shrunk, []);
  assert.deepEqual(evaluate(config, shrunk), clean);
});

test("removing one glob from a multi-glob override stales only that pair", () => {
  const config = fixture(["client/**", "server/**"]);
  const baseline = [record("client/**"), record("server/**")];
  const override = config.overrides[0];
  const [removed] = override.files.splice(0, 1);
  assert.deepEqual(evaluate(config, baseline), {
    ...clean, stale: [`${removed}: home/example exemption is stale; run bun run lint-exemptions:shrink`],
  });
});

test("only disabled severities count, including array configurations", () => {
  for (const severity of ["off", "allow", 0, ["off", { option: true }], ["allow"], [0]]) {
    assert.equal(evaluate(fixture(undefined, severity)).unlisted.length, 1);
    assert.deepEqual(evaluate(fixture(undefined, severity), [record()]), clean);
  }
  for (const severity of ["warn", "error", "deny", 1, 2, ["warn", {}], [1], ["error"]]) {
    assert.deepEqual(evaluate(fixture(undefined, severity)), clean);
  }
  for (const severity of [true, false, 3, -1, "disable", "0", null, {}, [], [true], [["off"]]]) {
    const result = evaluate(fixture(undefined, severity));
    assert.equal(result.unlisted.length, 0);
    assert.deepEqual(result.invalid, ['overrides[0].rules["home/example"]: unrecognized rule severity']);
  }
});

test("JSONC is parsed and categories, plugins, and excludeFiles do not create exemptions", () => {
  assert.deepEqual(evaluate('{ // config comment\n "rules": { "home/example": ["off", {}], }, }', [record("**")]), clean);
  assert.deepEqual(evaluate({ categories: { correctness: "off" }, plugins: ["react"], overrides: [{ files: ["client/**"], excludeFiles: ["client/fixture.ts"], rules: { "home/example": "off" } }] }, [record()]), clean);
  assert.ok(evaluate('{ "rules": ').invalid.some((message) => message.startsWith("apps/web/.oxlintrc.jsonc: invalid JSONC")));
});

test("malformed config shapes return located invalid findings without throwing", () => {
  const cases = [
    [null, "config must be an object"], [[], "config must be an object"], [0, "config must be an object"],
    [{ rules: [] }, "rules:"], [{ rules: null }, "rules:"], [{ rules: "off" }, "rules:"],
    [{ overrides: {} }, "overrides:"], [{ overrides: null }, "overrides:"],
    [{ overrides: [null] }, "overrides[0]:"], [{ overrides: [[]] }, "overrides[0]:"],
    [{ overrides: [{}] }, "overrides[0].files:"], [{ overrides: [{ files: "client/**" }] }, "overrides[0].files:"],
    [{ overrides: [{ files: [] }] }, "overrides[0].files:"],
    [{ overrides: [{ files: [null] }] }, "overrides[0].files[0]:"],
    [{ overrides: [{ files: [""] }] }, "overrides[0].files[0]:"],
    [{ overrides: [{ files: [" "] }] }, "overrides[0].files[0]:"],
    [{ overrides: [{ files: ["client/**"], rules: true }] }, "overrides[0].rules:"],
  ];
  for (const [config, location] of cases) {
    assert.ok(evaluate(config).invalid.some((message) => message.includes(location)), JSON.stringify(config));
  }
  assert.deepEqual(evaluate({}), clean);
});

test("malformed baseline entries return located findings without throwing", () => {
  for (const baseline of [null, undefined, {}, "bad JSON", 0]) {
    assert.deepEqual(evaluateExemptions({ config: {}, baseline }).invalid, ["baseline: expected an array"]);
  }
  for (const entry of [null, [], 0, {}, { ...record(), glob: " " }, { ...record(), rule: "" }, { ...record(), reason: " " }, { glob: "client/**", rule: "home/example" }]) {
    assert.ok(evaluate({}, [entry]).invalid.some((message) => message.startsWith("baseline[0]")), JSON.stringify(entry));
  }
  assert.ok(evaluate(fixture(), [record(), record()]).invalid.some((message) => message.includes("duplicate")));
  assert.ok(evaluate({}, [record("z/**"), record("a/**")]).invalid.some((message) => message.includes("sorted by rule then glob")));
});

test("extra Oxlint configs fail closed anywhere in Git-listed paths", () => {
  for (const name of [".oxlintrc", ".oxlintrc.json", ".oxlintrc.jsonc", ".oxlintrc.json5", "oxlint.config.json", "oxlint.config.jsonc"]) {
    const file = `other/nested/${name}`;
    const findings = evaluateExemptions({ config: {}, baseline: [], configPaths: [file] });
    assert.deepEqual(findings.invalid, [`${file}: extra Oxlint config is not inventoried; use apps/web/.oxlintrc.jsonc`]);
  }
  assert.deepEqual(evaluateExemptions({ config: {}, baseline: [], configPaths: ["apps/web/.oxlintrc.jsonc", "docs/oxlint.config.jsonc.md"] }), clean);
});

test("findings are sorted and repeated config pairs need only one baseline entry", () => {
  const config = { rules: { "home/z": "off", "home/a": "off" }, overrides: [fixture().overrides[0], fixture().overrides[0]] };
  const result = evaluate(config);
  for (const messages of Object.values(result)) assert.deepEqual(messages, [...messages].sort());
  assert.equal(result.unlisted.length, 3);
  assert.deepEqual(evaluate({ overrides: [fixture().overrides[0], fixture().overrides[0]] }, [record()]), clean);
});

test("shrink drops stale pairs, preserves exact reasons, and never adds unlisted exemptions", () => {
  const reason = "  Reviewed reason\nwith preserved whitespace  ";
  const baseline = [record("client/**", "home/example", reason), record("server/**")];
  const config = fixture(["client/**", "new/**"]);
  const shrunk = shrinkExemptions({ config, baseline });
  assert.deepEqual(shrunk, [record("client/**", "home/example", reason)]);
  assert.deepEqual(baseline, [record("client/**", "home/example", reason), record("server/**")]);
  assert.deepEqual(evaluate(config, shrunk), {
    ...clean, unlisted: ["home/example on new/**: add a reviewed baseline entry or restore the rule"],
  });
  assert.deepEqual(shrinkExemptions({ config: { rules: { "home/example": true } }, baseline }), baseline);
});

test("shrink CLI preserves review reasons, refuses additions, and fails on invalid input", (t) => {
  const directory = createMirror(t);
  const baselineFile = path.join(directory, EXEMPTIONS_BASELINE_PATH);
  const configFile = path.join(directory, "apps/web/.oxlintrc.jsonc");
  const reason = "  Keep exactly this reason\nincluding whitespace  ";
  writeFileSync(baselineFile, JSON.stringify([record("client/**", "home/example", reason), record("server/**")]));
  writeFileSync(configFile, JSON.stringify(fixture(["client/**", "new/**"])));
  const result = cli(["--shrink"], directory);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, "home/example on new/**: add a reviewed baseline entry or restore the rule\n");
  assert.equal(readFileSync(baselineFile, "utf8"), `${JSON.stringify([record("client/**", "home/example", reason)], null, 2)}\n`);
  writeFileSync(configFile, JSON.stringify(fixture()));
  assert.equal(cli(["--shrink"], directory).status, 0);
  for (const malformed of ["{", "{}", JSON.stringify([record(), record()])]) {
    writeFileSync(baselineFile, malformed);
    assert.equal(cli(["--shrink"], directory).status, 1);
    assert.equal(readFileSync(baselineFile, "utf8"), malformed);
  }
  writeFileSync(baselineFile, JSON.stringify([record()]));
  writeFileSync(configFile, JSON.stringify(fixture(undefined, true)));
  assert.equal(cli(["--shrink"], directory).status, 1);
  assert.equal(readFileSync(baselineFile, "utf8"), JSON.stringify([record()]));
});

test("config inventory evaluation leaves directive bytes and budget unchanged", () => {
  const directivePath = path.join(root, BASELINE_PATH);
  const modulePath = path.join(root, "scripts/gates/lint-disables.mjs");
  const bytes = readFileSync(directivePath);
  const moduleBytes = readFileSync(modulePath);
  const budget = JSON.parse(bytes.toString());
  const before = evaluateDisableBudget({ files: repositoryFiles(), budget });
  assert.deepEqual(evaluateExemptions(readExemptionInput()), clean);
  assert.deepEqual(evaluateDisableBudget({ files: repositoryFiles(), budget }), before);
  assert.deepEqual(readFileSync(directivePath), bytes);
  assert.deepEqual(readFileSync(modulePath), moduleBytes);
  assert.deepEqual(JSON.parse(readFileSync(directivePath, "utf8")), budget);
  assert.deepEqual(evaluateDisableBudget({ files: repositoryFiles(), budget }), before);
});

test("shrink CLI reproduces the shipped baseline bytes in a disposable mirror", (t) => {
  const directory = createMirror(t);
  const baselineFile = path.join(directory, EXEMPTIONS_BASELINE_PATH);
  const shippedBytes = readFileSync(path.join(root, EXEMPTIONS_BASELINE_PATH));
  copyFileSync(path.join(root, "apps/web/.oxlintrc.jsonc"), path.join(directory, "apps/web/.oxlintrc.jsonc"));
  copyFileSync(path.join(root, EXEMPTIONS_BASELINE_PATH), baselineFile);
  const result = cli(["--shrink"], directory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(readFileSync(baselineFile), shippedBytes);
});

test("shrink CLI preserves the baseline and leaves no temporary files when writing fails", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("directory permissions do not restrict root");
    return;
  }
  const directory = createMirror(t);
  const baselineFile = path.join(directory, EXEMPTIONS_BASELINE_PATH);
  const shippedBytes = readFileSync(path.join(root, EXEMPTIONS_BASELINE_PATH));
  copyFileSync(path.join(root, "apps/web/.oxlintrc.jsonc"), path.join(directory, "apps/web/.oxlintrc.jsonc"));
  copyFileSync(path.join(root, EXEMPTIONS_BASELINE_PATH), baselineFile);
  const gatesDirectory = path.join(directory, "scripts/gates");
  try {
    chmodSync(gatesDirectory, 0o500);
    const result = cli(["--shrink"], directory);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /^lint-exemptions: could not read or write gate input: EACCES: permission denied, open /u);
    assert.ok(result.stderr.includes(`${baselineFile}.tmp-`), result.stderr);
    assert.deepEqual(readFileSync(baselineFile), shippedBytes);
    assert.deepEqual(readdirSync(gatesDirectory).sort(), ["lint-exemptions-baseline.json", "lint-exemptions.mjs"]);
  } finally {
    chmodSync(gatesDirectory, 0o700);
  }
});

test("CLI exits cleanly on the live tree and rejects unknown arguments", () => {
  const result = cli();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  const invalid = cli(["--grow"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /^usage:/);
});
