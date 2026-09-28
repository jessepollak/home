import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_SECONDS = 5;
export const FILE_SECONDS = 30;
export const ALLOWLIST_PATH = "scripts/gates/test-runtime-allowlist.json";
const emptyAllowlist = () => ({ tests: [], files: [] });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function decodeXml(value) {
  const decoded = value.replace(/&([^;]+);/g, (_, entity) => {
    const named = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">" };
    if (Object.hasOwn(named, entity)) return named[entity];
    const numeric = entity.match(/^#([xX][0-9a-fA-F]+|[0-9]+)$/);
    if (!numeric) throw new Error(`Invalid XML entity &${entity};`);
    const code = /^[xX]/.test(numeric[1]) ? parseInt(numeric[1].slice(1), 16) : parseInt(numeric[1], 10);
    if (!Number.isInteger(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error(`Invalid XML entity &${entity};`);
    return String.fromCodePoint(code);
  });
  if (value.replace(/&(?:amp|apos|quot|lt|gt|#(?:[xX][0-9a-fA-F]+|[0-9]+));/g, "").includes("&")) {
    throw new Error("Invalid XML entity");
  }
  return decoded;
}

function attributes(source) {
  const result = {};
  const attribute = /\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    attribute.lastIndex = index;
    const match = attribute.exec(source);
    if (!match || Object.hasOwn(result, match[1])) throw new Error("Malformed or duplicate XML attribute");
    result[match[1]] = decodeXml(match[2] ?? match[3]);
    index = attribute.lastIndex;
  }
  return result;
}

function seconds(value) {
  if (typeof value !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error("Missing or invalid testcase time");
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Invalid testcase time");
  return number;
}

export function parseJunit(xml) {
  if (typeof xml !== "string") throw new Error("Missing JUnit XML");
  const stack = [];
  const tests = new Map();
  const files = new Map();
  let position = 0;
  let rootClosed = false;
  let declaredTests;
  let testcaseCount = 0;
  while (position < xml.length) {
    const next = xml.indexOf("<", position);
    if (next < 0) {
      if (stack.length === 0 && xml.slice(position).trim()) throw new Error("Text outside JUnit XML root");
      break;
    }
    if (stack.length === 0 && xml.slice(position, next).trim()) throw new Error("Text outside JUnit XML root");
    if (xml.startsWith("<!--", next)) {
      const end = xml.indexOf("-->", next + 4);
      if (end < 0) throw new Error("Unclosed XML comment");
      position = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", next)) {
      const end = xml.indexOf("]]>", next + 9);
      if (end < 0 || stack.length === 0) throw new Error("Invalid XML CDATA");
      position = end + 3;
      continue;
    }
    let end = next + 1;
    let quote = "";
    for (; end < xml.length; end++) {
      const char = xml[end];
      if (char === quote) quote = "";
      else if (!quote && (char === '"' || char === "'")) quote = char;
      else if (!quote && char === ">") break;
    }
    if (end === xml.length) throw new Error("Unclosed XML tag");
    const tag = xml.slice(next + 1, end);
    position = end + 1;
    if (tag.startsWith("?")) {
      if (!tag.endsWith("?")) throw new Error("Malformed XML declaration");
      continue;
    }
    const closing = tag.startsWith("/");
    const match = (closing ? tag.slice(1) : tag).match(/^([\w:-]+)([\s\S]*)$/);
    if (!match) throw new Error("Malformed JUnit XML tag");
    const name = match[1];
    if (closing) {
      if (match[2].trim() || stack.at(-1)?.name !== name) throw new Error(`Mismatched closing tag ${name}`);
      stack.pop();
      if (stack.length === 0) rootClosed = true;
      continue;
    }
    if (rootClosed || (stack.length === 0 && name !== "testsuites")) throw new Error("Expected one testsuites root");
    const selfClosing = /\/\s*$/.test(match[2]);
    const attrs = attributes(selfClosing ? match[2].replace(/\/\s*$/, "") : match[2]);
    const parent = stack.at(-1);
    if (name === "testsuites" && !parent) declaredTests = attrs.tests;
    if ((name === "testsuite" && !["testsuites", "testsuite"].includes(parent?.name))
      || (name === "testcase" && parent?.name !== "testsuite")) throw new Error(`Unexpected ${name} element`);
    if (name === "testcase") {
      const suites = stack.filter((item) => item.name === "testsuite");
      const file = attrs.file || suites[0]?.attrs.file;
      if (!file || !attrs.name) throw new Error("Testcase missing file or name");
      const test = [...suites.slice(1).map((item) => item.attrs.name), attrs.name].join(" > ");
      if (suites.slice(1).some((item) => !item.attrs.name)) throw new Error("Describe suite missing name");
      const time = seconds(attrs.time);
      testcaseCount++;
      const id = JSON.stringify([file, test]);
      tests.set(id, { file, test, seconds: Math.max(time, tests.get(id)?.seconds ?? 0) });
      files.set(file, (files.get(file) ?? 0) + time);
    }
    if (!selfClosing) stack.push({ name, attrs });
    else if (name === "testsuites" && stack.length === 0) rootClosed = true;
  }
  if (!rootClosed || stack.length || tests.size === 0) throw new Error("JUnit XML is malformed or has zero testcases");
  if (declaredTests === undefined) throw new Error("JUnit root is missing its tests count");
  if (!/^\d+$/.test(declaredTests) || Number(declaredTests) !== testcaseCount) {
    throw new Error(`JUnit root tests count ${declaredTests} does not match ${testcaseCount} testcase elements`);
  }
  return {
    tests: [...tests.values()].sort((a, b) => order(a.file, b.file) || order(a.test, b.test)),
    files: [...files].map(([file, time]) => ({ file, seconds: time })).sort((a, b) => order(a.file, b.file)),
  };
}

export function validateAllowlist(value) {
  const findings = [];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "files,tests"
    || !Array.isArray(value.tests) || !Array.isArray(value.files)) {
    return { allowlist: emptyAllowlist(), findings: ["Allowlist must have exactly the arrays tests and files."] };
  }
  const allowlist = emptyAllowlist();
  for (const kind of ["tests", "files"]) {
    const fields = kind === "tests" ? "file,maxSeconds,reason,test" : "file,maxSeconds,reason";
    const defaultSeconds = kind === "tests" ? TEST_SECONDS : FILE_SECONDS;
    let previous;
    for (const entry of value[kind]) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || Object.keys(entry).sort().join(",") !== fields
        || typeof entry.file !== "string" || !entry.file.trim()
        || (kind === "tests" && (typeof entry.test !== "string" || !entry.test.trim()))
        || typeof entry.reason !== "string" || !entry.reason.trim()
        || typeof entry.maxSeconds !== "number" || !Number.isFinite(entry.maxSeconds)) {
        findings.push(`Invalid ${kind} allowlist entry: expected ${fields}.`);
        continue;
      }
      if (previous && (order(entry.file, previous.file) || (kind === "tests" ? order(entry.test, previous.test) : 0)) <= 0)
        findings.push(`${kind} allowlist entries must be sorted and unique: ${entry.file}${entry.test ? ` > ${entry.test}` : ""}.`);
      previous = entry;
      if (entry.maxSeconds <= defaultSeconds) findings.push(`${kind} allowlist maxSeconds must exceed ${defaultSeconds}: ${entry.file}${entry.test ? ` > ${entry.test}` : ""}.`);
      allowlist[kind].push(entry);
    }
  }
  return { allowlist, findings };
}

export function buildRuntimeReport(timings, current, base) {
  const checked = validateAllowlist(current);
  const old = base === undefined ? null : validateAllowlist(base);
  const findings = [...checked.findings];
  const notes = old?.findings.length ? [`Base allowlist unavailable or invalid: ${old.findings.join(" ")}`] : [];
  const previousAllowlist = old && !old.findings.length ? old.allowlist : null;
  const measuredTests = timings?.tests ?? [];
  const measuredFiles = timings?.files ?? [];
  if (!measuredTests.length) findings.push("JUnit XML has zero testcases.");
  for (const kind of ["tests", "files"]) {
    const measurements = kind === "tests" ? measuredTests : measuredFiles;
    const defaultSeconds = kind === "tests" ? TEST_SECONDS : FILE_SECONDS;
    const key = (item) => JSON.stringify(kind === "tests" ? [item.file, item.test] : [item.file]);
    const label = (item) => kind === "tests" ? `${item.file} > ${item.test}` : item.file;
    const oldEntries = previousAllowlist && new Map(previousAllowlist[kind].map((item) => [key(item), item]));
    const allowed = new Map(checked.allowlist[kind].map((item) => [key(item), item]));
    const seen = new Set(measurements.map(key));
    for (const entry of checked.allowlist[kind]) {
      if (!seen.has(key(entry))) findings.push(`Stale ${kind} allowlist entry: ${label(entry)}; remove it.`);
      if (oldEntries) {
        const previous = oldEntries.get(key(entry));
        if (!previous) notes.push(`Added ${kind} allowlist entry: ${label(entry)} (${entry.maxSeconds} s).`);
        else if (entry.maxSeconds > previous.maxSeconds) notes.push(`Raised ${kind} allowlist ceiling: ${label(entry)} (${previous.maxSeconds} s → ${entry.maxSeconds} s).`);
      }
    }
    if (oldEntries) {
      for (const entry of previousAllowlist[kind]) {
        if (!allowed.has(key(entry))) notes.push(`Removed ${kind} allowlist entry: ${label(entry)} (${entry.maxSeconds} s).`);
      }
    }
    for (const item of measurements) {
      const entry = allowed.get(key(item));
      const limit = entry?.maxSeconds ?? defaultSeconds;
      if (item.seconds > limit) findings.push(`${kind === "tests" ? "Test" : "File"} ${label(item)}: ${item.seconds.toFixed(3)} s exceeds ${limit} s.`);
      else if (entry && item.seconds <= defaultSeconds) notes.push(`Removable ${kind} allowlist entry: ${label(item)} (${item.seconds.toFixed(3)} s ≤ ${defaultSeconds} s).`);
    }
  }
  return { tests: measuredTests, files: measuredFiles, findings, notes };
}

export function renderRuntimeReport(report) {
  const lines = ["## Unit-test runtime", "", report.findings.length ? "### Findings" : "No findings."];
  if (report.findings.length) lines.push(...report.findings.map((finding) => `- ${finding}`));
  lines.push("", "### Notes");
  lines.push(...(report.notes.length ? report.notes.map((note) => `- ${note}`) : ["None."]));
  for (const [title, entries] of [["tests", report.tests], ["files", report.files]]) {
    lines.push("", `### 10 slowest ${title}`);
    const slowest = [...entries].sort((a, b) => b.seconds - a.seconds || order(a.file, b.file) || order(a.test ?? "", b.test ?? "")).slice(0, 10);
    lines.push(...(slowest.length ? slowest.map((item) => `- ${item.seconds.toFixed(3)} s — ${item.file}${item.test ? ` > ${item.test}` : ""}`) : ["No data."]));
  }
  return lines.join("\n");
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

export function readBaseAllowlist(baseRef = "main", allowlistPath = ALLOWLIST_PATH, gitRunner = git) {
  const notes = [];
  if (baseRef.startsWith("-")) throw new Error(`Invalid base ref: ${baseRef}`);
  let base;
  try {
    base = gitRunner(["merge-base", "--", `origin/${baseRef}`, "HEAD"]);
  } catch {
    try {
      base = gitRunner(["merge-base", "--", baseRef, "HEAD"]);
      notes.push(`origin/${baseRef} unavailable; using local ${baseRef} as the base.`);
    } catch {
      throw new Error(`Could not resolve origin/${baseRef} or local ${baseRef} as a base`);
    }
  }
  if (!gitRunner(["ls-tree", "--name-only", base, "--", allowlistPath])) return { allowlist: emptyAllowlist(), notes };
  return { allowlist: JSON.parse(gitRunner(["show", `${base}:${allowlistPath}`])), notes };
}

export function run(argv = process.argv.slice(2), env = process.env) {
  const options = { "--junit": "apps/web/unit-test-results/junit.xml", "--allowlist": ALLOWLIST_PATH, "--summary-json": null };
  const findings = [];
  const notes = [];
  for (let index = 0; index < argv.length; index += 2) {
    if (!Object.hasOwn(options, argv[index]) || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      console.error("Usage: node scripts/gates/test-runtime.mjs [--junit <path>] [--allowlist <path>] [--summary-json <path>]");
      return 1;
    }
    options[argv[index]] = argv[index + 1];
  }
  let timings;
  try { timings = parseJunit(readFileSync(options["--junit"], "utf8")); }
  catch (error) { findings.push(`JUnit unavailable or invalid: ${error.message}`); }
  let current;
  try { current = JSON.parse(readFileSync(options["--allowlist"], "utf8")); }
  catch (error) { findings.push(`Allowlist unavailable or invalid: ${error.message}`); }
  let base;
  try {
    const result = readBaseAllowlist(env.BASE_REF || "main");
    base = result.allowlist;
    notes.push(...result.notes);
  } catch (error) { notes.push(`Base allowlist unavailable or invalid: ${error.message}`); }
  const report = buildRuntimeReport(timings, current, base);
  report.findings.unshift(...findings);
  report.notes.unshift(...notes);
  console.log(renderRuntimeReport(report));
  if (options["--summary-json"]) {
    try {
      mkdirSync(dirname(options["--summary-json"]), { recursive: true });
      writeFileSync(options["--summary-json"], `${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
      console.error(`Could not write summary JSON: ${error.message}`);
      return 1;
    }
  }
  return report.findings.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = run();
