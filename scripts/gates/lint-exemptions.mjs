import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ts = createRequire(new URL("../../apps/web/package.json", import.meta.url))("typescript");
const root = fileURLToPath(new URL("../..", import.meta.url));
const configPath = "apps/web/.oxlintrc.jsonc";
export const EXEMPTIONS_BASELINE_PATH = "scripts/gates/lint-exemptions-baseline.json";
const configNames = /^(?:\.oxlintrc(?:\.json|\.jsonc|\.json5)?|oxlint\.config\.(?:json|jsonc))$/u;
const severities = new Set(["off", "allow", "warn", "error", "deny", 0, 1, 2]);
const disabled = new Set(["off", "allow", 0]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonblank = (value) => typeof value === "string" && Boolean(value.trim());
const keyFor = ({ glob, rule }) => JSON.stringify([rule, glob]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compareEntries = (a, b) => compare(a.rule, b.rule) || compare(a.glob, b.glob);

function collectExemptions(config, invalid) {
  const parsed = typeof config === "string" ? ts.parseConfigFileTextToJson(configPath, config) : { config };
  if (parsed.error) invalid.push(`${configPath}: invalid JSONC: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, " ")}`);
  const settings = parsed.config;
  const exemptions = new Map();
  if (!isObject(settings)) {
    invalid.push(`${configPath}: config must be an object`);
    return exemptions;
  }
  function collectRules(rules, location, globs) {
    if (!isObject(rules)) {
      invalid.push(`${location}: rules must be an object`);
      return;
    }
    for (const [rule, value] of Object.entries(rules)) {
      const severity = Array.isArray(value) ? value[0] : value;
      if (!severities.has(severity)) {
        invalid.push(`${location}[${JSON.stringify(rule)}]: unrecognized rule severity`);
      } else if (disabled.has(severity)) {
        for (const glob of globs) {
          const entry = { glob, rule };
          exemptions.set(keyFor(entry), entry);
        }
      }
    }
  }
  if (Object.hasOwn(settings, "rules")) collectRules(settings.rules, "rules", ["**"]);
  if (Object.hasOwn(settings, "overrides")) {
    if (!Array.isArray(settings.overrides)) {
      invalid.push("overrides: expected an array");
    } else {
      settings.overrides.forEach((override, index) => {
        const location = `overrides[${index}]`;
        if (!isObject(override)) {
          invalid.push(`${location}: override must be an object`);
          return;
        }
        const globs = [];
        if (!Array.isArray(override.files) || !override.files.length) {
          invalid.push(`${location}.files: expected a non-empty array of globs`);
        } else {
          override.files.forEach((glob, globIndex) => {
            if (!nonblank(glob)) invalid.push(`${location}.files[${globIndex}]: glob must be a non-empty string`);
            else globs.push(glob);
          });
        }
        if (Object.hasOwn(override, "rules")) collectRules(override.rules, `${location}.rules`, globs);
      });
    }
  }
  return exemptions;
}

function baselineEntries(baseline, invalid) {
  if (!Array.isArray(baseline)) {
    invalid.push("baseline: expected an array");
    return [];
  }
  const entries = [];
  const seen = new Set();
  baseline.forEach((entry, index) => {
    const location = `baseline[${index}]`;
    if (!isObject(entry)) {
      invalid.push(`${location}: entry must be an object`);
      return;
    }
    let valid = true;
    for (const field of ["glob", "rule", "reason"]) {
      if (!nonblank(entry[field])) {
        invalid.push(`${location}.${field}: expected a non-empty string`);
        valid = false;
      }
    }
    if (!valid) return;
    const key = keyFor(entry);
    if (seen.has(key)) invalid.push(`${location}: duplicate exemption for ${entry.rule} on ${entry.glob}`);
    seen.add(key);
    if (entries.length && compareEntries(entries.at(-1), entry) > 0) invalid.push(`${location}: baseline must be sorted by rule then glob`);
    entries.push(entry);
  });
  return entries;
}

export function evaluateExemptions({ config, baseline, configPaths = [] }) {
  const invalid = [];
  const exemptions = collectExemptions(config, invalid);
  const entries = baselineEntries(baseline, invalid);
  const listed = new Set(entries.map(keyFor));
  for (const file of configPaths) {
    if (configNames.test(path.posix.basename(file)) && file !== configPath) invalid.push(`${file}: extra Oxlint config is not inventoried; use ${configPath}`);
  }
  return {
    unlisted: [...exemptions].filter(([key]) => !listed.has(key)).map(([, { glob, rule }]) => `${rule} on ${glob}: add a reviewed baseline entry or restore the rule`).sort(),
    stale: entries.filter((entry) => !exemptions.has(keyFor(entry))).map(({ glob, rule }) => `${glob}: ${rule} exemption is stale; run bun run lint-exemptions:shrink`).sort(),
    invalid: invalid.sort(),
  };
}

export function shrinkExemptions({ config, baseline }) {
  const invalid = [];
  const exemptions = collectExemptions(config, invalid);
  const entries = baselineEntries(baseline, invalid);
  if (invalid.length) return baseline;
  return entries.filter((entry) => exemptions.has(keyFor(entry)))
    .map(({ glob, rule, reason }) => ({ glob, rule, reason })).sort(compareEntries);
}

export function readExemptionInput() {
  const baselineText = readFileSync(path.join(root, EXEMPTIONS_BASELINE_PATH), "utf8");
  let baseline;
  try {
    baseline = JSON.parse(baselineText);
  } catch {
    baseline = baselineText;
  }
  return {
    config: readFileSync(path.join(root, configPath), "utf8"),
    baseline,
    configPaths: execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root })
      .toString().split("\0").filter(Boolean),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const shrink = process.argv.length === 3 && process.argv[2] === "--shrink";
  if (process.argv.length > (shrink ? 3 : 2)) {
    console.error("usage: node scripts/gates/lint-exemptions.mjs [--shrink]");
    process.exitCode = 1;
  } else {
    try {
      const input = readExemptionInput();
      let findings = evaluateExemptions(input);
      if (shrink && !findings.invalid.length) {
        input.baseline = shrinkExemptions(input);
        const baselineFile = path.join(root, EXEMPTIONS_BASELINE_PATH);
        const temporaryFile = `${baselineFile}.tmp-${process.pid}-${randomUUID()}`;
        try {
          writeFileSync(temporaryFile, `${JSON.stringify(input.baseline, null, 2)}\n`, { flag: "wx" });
          renameSync(temporaryFile, baselineFile);
        } catch (error) {
          try {
            unlinkSync(temporaryFile);
          } catch {}
          throw error;
        }
        findings = evaluateExemptions(input);
      }
      const messages = [...findings.unlisted, ...findings.stale, ...findings.invalid];
      for (const message of messages) console.error(message);
      if (messages.length) process.exitCode = 1;
    } catch (error) {
      console.error(`lint-exemptions: could not read or write gate input: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
