import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolveBaseRef, playwrightRungFindings, playwrightRungReport } from "../playwright-rung.mjs";

function patch(path, additions = [], deletions = []) {
  return `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1,${deletions.length} +1,${additions.length} @@
${deletions.map((line) => `-${line}\n`).join("")}${additions.map((line) => `+${line}\n`).join("")}`;
}

const browser = "apps/web/tests/browser/nested/smoke.pw.ts";

for (const [name, diff, body, expected] of [
  ["added top-level test requires a rung", patch(browser, ['test("a", () => {});']), "", "Playwright-rung"],
  ["nested describe requires a rung", patch(browser, ['  test.describe("a", () => {']), "", "Playwright-rung"],
  ["removed test does not require a rung", patch(browser, [], ['test("a", () => {});']), "", ""],
  ["non-browser Playwright does not require a rung", patch("apps/web/tests/unit/smoke.pw.ts", ['test("a", () => {});']), "", ""],
  ["commented browser call does not require a rung", patch(browser, ['// test("a", () => {});']), "", ""],
  ["identifier containing test does not require a rung", patch(browser, ['contest("a");']), "", ""],
  ["existing browser assertion does not require a rung", patch(browser, ["expect(1).toBe(1);"]), "", ""],
  ["rename and restructure in one browser file requires no rung", patch(browser,
    ['test.describe("new group", () => {', 'test("renamed", () => {});'],
    ['test.describe("old group", () => {', 'test("old", () => {});']), "", ""],
  ["genuinely added test alongside rename still requires rung", patch(browser,
    ['test("renamed", () => {});', 'test("new", () => {});'],
    ['test("old", () => {});']), "", "Playwright-rung"],
  ["genuinely added test across browser files requires rung", patch(browser,
    ['test("renamed", () => {});', 'test("new", () => {});'])
    + patch("apps/web/tests/browser/old.pw.ts", [], ['test("old", () => {});']), "", "Playwright-rung"],
  ["moving a test between browser files requires no rung", patch(browser,
    ['test("new", () => {});']) + patch("apps/web/tests/browser/old.pw.ts", [],
    ['test("removed", () => {});']), "", ""],
  ["deleting a browser file and adding more declarations elsewhere requires rung", patch(browser,
    ['test("new", () => {});', 'test("extra", () => {});'])
    + patch("apps/web/tests/browser/old.pw.ts", [], ['test("removed", () => {});'])
      .replace("+++ b/apps/web/tests/browser/old.pw.ts", "+++ /dev/null"), "", "Playwright-rung"],
  ["rename across browser paths offsets its removed declaration", patch(browser,
    ['test("renamed", () => {});'], ['test("old", () => {});'])
    .replace(`--- a/${browser}`, "--- a/apps/web/tests/browser/old.pw.ts"), "", ""],
]) {
  test(name, () => {
    const findings = playwrightRungFindings(diff, body);
    assert.equal(findings.length > 0, Boolean(expected));
    if (expected) assert.ok(findings.some((finding) => finding.includes(expected)));
  });
}

test("the report counts the positive browser delta across files", () => {
  const report = playwrightRungReport(
    patch(browser, ['test("new", () => {});', "expect(1).toBe(1);"], ['test("old", () => {});'])
      + patch("apps/web/tests/browser/second.pw.ts", ['test.describe("new", () => {']),
    "Playwright-rung: journey",
  );
  assert.deepEqual(report, { findings: [], netNewPlaywright: 1 });
});

test("the report cancels equal additions and removals across browser files", () => {
  const report = playwrightRungReport(
    patch(browser, ['test("moved", () => {});'])
      + patch("apps/web/tests/browser/old.pw.ts", [], ['test("original", () => {});']),
    "",
  );
  assert.deepEqual(report, { findings: [], netNewPlaywright: 0 });
});

for (const [name, diff, expected] of [
  ["test-only fix adds no declaration", patch(browser, ["const state = 1;", "expect(state).toBe(1);"]), 0],
  ["non-browser test fix adds no declaration", patch("apps/web/verify/cli.test.ts", Array(41).fill("expect(1).toBe(1);")), 0],
  ["funding fix adds a browser declaration", patch(browser, ['test("sheet", () => {});', ...Array(40).fill("expect(1).toBe(1);")]), 1],
  ["recipient feature adds three declarations", patch("apps/web/tests/browser/send-recipients.pw.ts", Array(3).fill('test("recipient", () => {});')), 3],
  ["moving browser tests adds no net declarations", patch(browser, Array(17).fill('test("moved", () => {});'))
    + patch("apps/web/tests/browser/old.pw.ts", [], Array(19).fill('test("old", () => {});')), 0],
]) {
  test(name, () => {
    const report = playwrightRungReport(diff, "");
    assert.equal(report.netNewPlaywright, expected);
    assert.equal(report.findings.length, Number(expected > 0));
  });
}

for (const rung of ["layout", "scrolling", "focus", "history", "persisted-state", "media-query", "hydration", "dispatch", "journey"]) {
  test(`accepts Playwright rung ${rung}`, () => {
    assert.deepEqual(playwrightRungFindings(patch(browser, ['test("a", () => {});']), `Playwright-rung: ${rung}`), []);
  });
}

for (const body of ["Playwright-rung: FOCUS", "Playwright-Rung: focus", "Playwright-rung: other", "Playwright-rung:", "note Playwright-rung: focus", "Playwright-rung: focus extra"]) {
  test(`rejects invalid rung line ${JSON.stringify(body)}`, () => {
    assert.match(playwrightRungFindings(patch(browser, ['test("a", () => {});']), body)[0], /Playwright-rung/);
  });
}

test("the CLI rejects the removed --check flag", () => {
  const cli = spawnSync(process.execPath, ["scripts/gates/playwright-rung.mjs", "--check=rung"], { encoding: "utf8" });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /Usage:/);
});

test("uses an existing base ref without fetching", () => {
  const calls = [];
  const gitRunner = (args) => { calls.push(args); return ""; };
  assert.equal(resolveBaseRef({ base: "main", gitRunner }), "origin/main");
  assert.deepEqual(calls, [["rev-parse", "--verify", "origin/main"]]);
});

test("fetches and retries when the remote base ref is missing", () => {
  const calls = [];
  let verifyAttempts = 0;
  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "rev-parse" && verifyAttempts++ === 0) throw new Error("missing ref");
    return "";
  };
  assert.equal(resolveBaseRef({ base: "main", gitRunner }), "origin/main");
  assert.deepEqual(calls, [
    ["rev-parse", "--verify", "origin/main"],
    ["fetch", "--no-tags", "--depth=200", "origin", "main"],
    ["rev-parse", "--verify", "origin/main"],
  ]);
});

for (const failure of ["rev-parse", "fetch"]) {
  test(`reports an unresolved base ref after ${failure} fails`, () => {
    const gitRunner = (args) => {
      if (args[0] === "rev-parse" || args[0] === failure) throw new Error("missing ref");
      return "";
    };
    assert.throws(() => resolveBaseRef({ base: "main", gitRunner }), /could not resolve base ref origin\/main/);
  });
}
