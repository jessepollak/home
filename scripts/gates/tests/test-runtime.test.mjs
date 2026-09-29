import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildRuntimeReport, mergeJunitReports, parseJunit, readBaseAllowlist, validateAllowlist } from "../test-runtime.mjs";

const checkedIn = JSON.parse(readFileSync(fileURLToPath(new URL("../test-runtime-allowlist.json", import.meta.url)), "utf8"));
const empty = { tests: [], files: [] };
const file = "client/example.test.ts";
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const testcase = (name, time, path = file) => `<testcase name="${escape(name)}" file="${escape(path)}" time="${time}" />`;
const countCases = (xml) => xml.match(/<testcase\s/g)?.length ?? 0;
const junit = (cases, path = file) => `<?xml version="1.0"?><testsuites tests="${countCases(cases)}"><testsuite name="${escape(path)}" file="${escape(path)}" time="0">${cases}</testsuite></testsuites>`;
const report = (xml, allowlist = empty, base = allowlist) => buildRuntimeReport(parseJunit(xml), allowlist, base);

for (const [name, xml, pattern] of [
  ["a new slow test", junit(testcase("slow", 5.01)), /Test client\/example.test.ts > slow: 5\.010 s exceeds 5 s/],
  ["a new slow file made of fast tests", junit(Array.from({ length: 7 }, (_, n) => testcase(`fast ${n}`, 4.5)).join("")), /File client\/example.test.ts: 31\.500 s exceeds 30 s/],
]) {
  test(`${name} fails`, () => assert.match(report(xml).findings.join("\n"), pattern));
}

test("baseline-shaped JUnit within every allowlisted ceiling passes", () => {
  const groups = new Map();
  for (const entry of checkedIn.tests) {
    const [describe, name] = entry.test.includes(" > ") ? entry.test.split(/ > (.*)/s).filter(Boolean) : [null, entry.test];
    const testXml = testcase(name, entry.maxSeconds - 2, entry.file);
    groups.set(entry.file, (groups.get(entry.file) ?? "") + (describe ? `<testsuite name="${escape(describe)}">${testXml}</testsuite>` : testXml));
  }
  const suites = [...groups].map(([path, cases]) => `<testsuite file="${escape(path)}" name="${escape(path)}" time="0">${cases}</testsuite>`).join("");
  const xml = `<testsuites tests="${countCases(suites)}">${suites}</testsuites>`;
  const result = report(xml, checkedIn);
  assert.deepEqual(result.findings, []);
  assert.equal(result.tests.length, checkedIn.tests.length);
  assert.equal(result.files.length, groups.size);
});

test("an allowlisted test exceeding its ceiling fails", () => {
  const allowlist = { tests: [{ file, test: "slow", maxSeconds: 9, reason: "measured slow test" }], files: [] };
  assert.match(report(junit(testcase("slow", 9.01)), allowlist).findings.join("\n"), /9\.010 s exceeds 9 s/);
});

test("stale test and file entries fail with removal instructions", () => {
  const allowlist = { tests: [{ file, test: "absent", maxSeconds: 9, reason: "measured slow test" }], files: [{ file: "absent.test.ts", maxSeconds: 40, reason: "measured slow file" }] };
  const findings = report(junit(testcase("present", 1)), allowlist).findings;
  assert.equal(findings.filter((finding) => finding.includes("Stale") && finding.includes("remove it")).length, 2);
});

test("an allowlisted test and file within the defaults are removable notes, not failures", () => {
  const allowlist = { tests: [{ file, test: "fast", maxSeconds: 9, reason: "measured slow test" }], files: [{ file, maxSeconds: 40, reason: "measured slow file" }] };
  const result = report(junit(testcase("fast", 1)), allowlist);
  assert.deepEqual(result.findings, []);
  assert.equal(result.notes.filter((note) => note.includes("Removable")).length, 2);
});

test("added, raised, and removed entries of both kinds produce notes without findings", () => {
  const base = {
    tests: [
      { file, test: "removed", maxSeconds: 9, reason: "previous measurement" },
      { file, test: "slow", maxSeconds: 8, reason: "previous measurement" },
    ],
    files: [{ file: "removed.test.ts", maxSeconds: 40, reason: "previous measurement" }],
  };
  const current = {
    tests: [
      { file, test: "added", maxSeconds: 9, reason: "new measurement" },
      { file, test: "slow", maxSeconds: 10, reason: "new measurement" },
    ],
    files: [{ file, maxSeconds: 45, reason: "new measurement" }],
  };
  const result = report(junit(`${testcase("added", 6)}${testcase("slow", 7)}`), current, base);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.notes, [
    `Added tests allowlist entry: ${file} > added (9 s).`,
    `Raised tests allowlist ceiling: ${file} > slow (8 s → 10 s).`,
    `Removed tests allowlist entry: ${file} > removed (9 s).`,
    `Added files allowlist entry: ${file} (45 s).`,
    "Removed files allowlist entry: removed.test.ts (40 s).",
    `Removable files allowlist entry: ${file} (13.000 s ≤ 30 s).`,
  ]);
});

test("lowering a ceiling produces no base-comparison note", () => {
  const base = { tests: [{ file, test: "slow", maxSeconds: 10, reason: "previous measurement" }], files: [] };
  const current = { tests: [{ file, test: "slow", maxSeconds: 8, reason: "new measurement" }], files: [] };
  const result = report(junit(testcase("slow", 7)), current, base);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.notes, []);
});

test("raising a file ceiling reports both values without a finding", () => {
  const base = { tests: [], files: [{ file, maxSeconds: 40, reason: "previous measurement" }] };
  const current = { tests: [], files: [{ file, maxSeconds: 45, reason: "new measurement" }] };
  const xml = junit(Array.from({ length: 7 }, (_, index) => testcase(`fast ${index}`, 4.5)).join(""));
  const result = report(xml, current, base);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.notes, [`Raised files allowlist ceiling: ${file} (40 s → 45 s).`]);
});

test("empty and malformed JUnit fail, including zero testcases", () => {
  for (const xml of ["", "<testsuites/>", "<testsuites><testsuite>", "<testsuites><testsuite></testsuites>", "<testsuites><testsuite><testcase name='x' time='bad'/></testsuite></testsuites>"]) {
    assert.throws(() => parseJunit(xml));
  }
});

test("root tests count is required and checks all testcase elements, including repeated and skipped cases", () => {
  const cases = `${testcase("same", 1)}${testcase("same", 2)}<testcase name="skipped" file="${file}" time="0"><skipped/></testcase>`;
  const xml = (root) => `<testsuites${root}><testsuite name="${file}" file="${file}">${cases}</testsuite></testsuites>`;
  assert.throws(() => parseJunit(xml("")), /missing its tests count/);
  assert.throws(() => parseJunit(xml(' tests="2"')), /root tests count 2 does not match 3 testcase elements/);
  assert.equal(parseJunit(xml(' tests="3"')).tests.length, 2);
  assert.equal(parseJunit(xml(' tests="3"')).testcaseCount, 3);
});

test("XML entities, nested describes, self-closing and child-bearing cases make correct IDs; duplicates use max", () => {
  const path = "client/a&b.test.ts";
  const xml = junit(`<testsuite name="outer &amp; &#x41;"><testsuite name="inner &lt;x&gt;">`
    + `<testcase name="one &quot;quoted&quot; &apos;test&apos;" time="2" file="${escape(path)}"><failure message="no"/></testcase>`
    + `<testcase name="one &quot;quoted&quot; &apos;test&apos;" time="3" file="${escape(path)}"/>`
    + `</testsuite></testsuite>`, path);
  const timings = parseJunit(xml);
  assert.deepEqual(timings.tests, [{ file: path, test: 'outer & A > inner <x> > one "quoted" \'test\'', seconds: 3 }]);
  assert.deepEqual(timings.files, [{ file: path, seconds: 5 }]);
});
test("reporter-shaped JUnit builds IDs from nested suites, not the reversed classname", () => {
  const path = "client/nested.test.tsx";
  const xml = `<?xml version="1.0"?><testsuites name="bun test" tests="3" assertions="0" failures="0" skipped="0" time="0.5">`
    + `<testsuite name="${escape(path)}" file="${escape(path)}" tests="3" assertions="0" skipped="0" time="0">`
    + `<testsuite name="outer" file="${escape(path)}" line="2" tests="1" skipped="0" time="0">`
    + `<testsuite name="inner" file="${escape(path)}" line="2" tests="1" skipped="0" time="0">`
    + `<testcase name="leaf test" classname="inner &amp;gt; outer" time="0.000014" file="${escape(path)}" line="2" assertions="0" />`
    + `</testsuite></testsuite>`
    + `<testsuite name="solo" file="${escape(path)}" line="3" tests="1" skipped="0" time="0">`
    + `<testcase name="second" classname="solo" time="0.000002" file="${escape(path)}" line="3" assertions="0" />`
    + `</testsuite>`
    + `<testcase name="top level" classname="" time="0" file="${escape(path)}" line="4" assertions="0" />`
    + `</testsuite></testsuites>`;
  assert.deepEqual(parseJunit(xml).tests.map((entry) => entry.test), ["outer > inner > leaf test", "solo > second", "top level"]);
});

test("checked-in allowlist validates cleanly and rejects invalid shapes, ordering, and default ceilings", () => {
  assert.deepEqual(validateAllowlist(checkedIn).findings, []);
  for (const invalid of [
    { ...empty, extra: 1 },
    { tests: [{ file, test: "x", maxSeconds: 5, reason: "measured slow test" }], files: [] },
    { tests: [], files: [{ file, maxSeconds: "99", reason: "measured slow file" }] },
    { tests: [{ file, test: "z", maxSeconds: 9, reason: "measured slow test" }, { file, test: "a", maxSeconds: 9, reason: "measured slow test" }], files: [] },
    { tests: [], files: [{ file, maxSeconds: 60, reason: "measured slow file" }, { file, maxSeconds: 61, reason: "measured slow file" }] },
  ]) assert.notEqual(validateAllowlist(invalid).findings.length, 0);
});

test("missing or blank reasons fail for both test and file entries", () => {
  for (const entry of [
    { file, test: "slow", maxSeconds: 9 },
    { file, test: "slow", maxSeconds: 9, reason: " \t " },
  ]) assert.match(validateAllowlist({ tests: [entry], files: [] }).findings.join("\n"), /Invalid tests allowlist entry/);
  for (const entry of [
    { file, maxSeconds: 40 },
    { file, maxSeconds: 40, reason: " \n " },
  ]) assert.match(validateAllowlist({ tests: [], files: [entry] }).findings.join("\n"), /Invalid files allowlist entry/);
});

test("invalid base allowlist is a note, not a finding", () => {
  const result = report(junit(testcase("fast", 1)), empty, { tests: [{ file, test: "fast", maxSeconds: 9 }], files: [] });
  assert.deepEqual(result.findings, []);
  assert.match(result.notes.join("\n"), /Base allowlist unavailable or invalid/);
});

test("base resolution prefers origin and notes local fallback without using HEAD", () => {
  const calls = [];
  const remoteGit = (args) => {
    calls.push(args);
    if (args[0] === "merge-base") return "remote-base";
    if (args[0] === "ls-tree") return "";
    throw new Error("unexpected command");
  };
  assert.deepEqual(readBaseAllowlist("main", "allowlist.json", remoteGit), { allowlist: empty, notes: [] });
  assert.deepEqual(calls, [["merge-base", "--", "origin/main", "HEAD"], ["ls-tree", "--name-only", "remote-base", "--", "allowlist.json"]]);
  calls.length = 0;
  const localGit = (args) => {
    calls.push(args);
    if (args[0] === "merge-base" && args[2] === "origin/main") throw new Error("remote unavailable");
    if (args[0] === "merge-base") return "local-base";
    if (args[0] === "ls-tree") return "";
    throw new Error("unexpected command");
  };
  assert.deepEqual(readBaseAllowlist("main", "allowlist.json", localGit), {
    allowlist: empty, notes: ["origin/main unavailable; using local main as the base."],
  });
  assert.deepEqual(calls, [["merge-base", "--", "origin/main", "HEAD"], ["merge-base", "--", "main", "HEAD"], ["ls-tree", "--name-only", "local-base", "--", "allowlist.json"]]);
  calls.length = 0;
  assert.throws(() => readBaseAllowlist("main", "allowlist.json", (args) => {
    calls.push(args);
    throw new Error("missing base");
  }), /Could not resolve origin\/main or local main/);
  assert.deepEqual(calls, [["merge-base", "--", "origin/main", "HEAD"], ["merge-base", "--", "main", "HEAD"]]);
});

test("dash-prefixed base refs are rejected before invoking git", () => {
  const calls = [];
  assert.throws(() => readBaseAllowlist("--independent", "allowlist.json", (args) => calls.push(args)), /Invalid base ref/);
  assert.deepEqual(calls, []);
});

test("CLI fails for a missing JUnit and writes findings to summary JSON", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "test-runtime-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const allowlist = join(dir, "allowlist.json");
  const summary = join(dir, "runtime.json");
  writeFileSync(allowlist, JSON.stringify(empty));
  const cli = fileURLToPath(new URL("../test-runtime.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "--junit", join(dir, "missing.xml"), "--allowlist", allowlist, "--summary-json", summary], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /JUnit unavailable or invalid/);
  assert.ok(JSON.parse(readFileSync(summary, "utf8")).findings.length);
});

test("multiple JUnit reports merge test and file timings and retain allowlisted entries from either shard", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "test-runtime-merge-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const second = "server/other.test.ts";
  const allowlist = { tests: [{ file: second, test: "slow", maxSeconds: 9, reason: "measured slow test" }], files: [] };
  const firstXml = junit(testcase("fast", 1));
  const secondXml = junit(testcase("slow", 6, second), second);
  const merged = mergeJunitReports([parseJunit(firstXml), parseJunit(secondXml)]);
  assert.deepEqual(merged.files.map((entry) => entry.file), [file, second]);
  assert.equal(merged.testcaseCount, 2);
  assert.deepEqual(buildRuntimeReport(merged, allowlist, allowlist).findings, []);
  const allowlistFile = join(dir, "allowlist.json");
  const firstFile = join(dir, "client.xml");
  const secondFile = join(dir, "server.xml");
  const summary = join(dir, "runtime.json");
  writeFileSync(allowlistFile, JSON.stringify(allowlist));
  writeFileSync(firstFile, firstXml);
  writeFileSync(secondFile, secondXml);
  const cli = fileURLToPath(new URL("../test-runtime.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "--junit", firstFile, "--junit", secondFile, "--allowlist", allowlistFile, "--summary-json", summary], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(summary, "utf8")).files.map((entry) => entry.file), [file, second]);
});

test("CLI reports an unresolvable base as a note without failing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "test-runtime-no-base-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const allowlist = join(dir, "allowlist.json");
  const junitFile = join(dir, "junit.xml");
  writeFileSync(allowlist, JSON.stringify(empty));
  writeFileSync(junitFile, junit(testcase("fast", 1)));
  const cli = fileURLToPath(new URL("../test-runtime.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "--junit", junitFile, "--allowlist", allowlist], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, BASE_REF: "main" },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Base allowlist unavailable or invalid: Could not resolve origin\/main or local main/);
  assert.match(result.stdout, /No findings\./);
});
