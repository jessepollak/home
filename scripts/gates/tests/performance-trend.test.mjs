import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectHistory, renderTrend } from "../performance-trend.mjs";

const cli = fileURLToPath(new URL("../performance-trend.mjs", import.meta.url));
const ids = ["mounted-rows", "dom-nodes", "warm-requests", "initial-js", "resource-growth", "history-writes"];
const results = {
  version: 1,
  sha: "1234567890abcdef",
  startedAt: "2026-09-27T11:00:00Z",
  structural: ids.map((id) => ({ id, pass: id !== "history-writes" })),
  timing: [
    { id: "fling-p95", scenario: "feed-300", ratio: 1.24, value: 46 },
    { id: "fling-p95", scenario: "feed-2000", value: 54 },
    { id: "nav-p95", scenario: "nav-300", value: 173 },
    { id: "detail-open", scenario: "feed-300", value: 82 },
  ],
};
const run = (id, date, attempt = 1, conclusion = "success") => ({
  id,
  headSha: String(id).repeat(40).slice(0, 40),
  createdAt: date,
  runAttempt: attempt,
  jobConclusion: conclusion,
  jobStartedAt: "2026-09-26T10:00:00Z",
  jobCompletedAt: "2026-09-26T10:10:00Z",
});

test("marks a gate failed when any scenario row fails", () => {
  const mixed = {
    ...results,
    structural: [
      ...results.structural.filter((row) => row.id !== "dom-nodes"),
      { id: "dom-nodes", pass: true },
      { id: "dom-nodes", pass: false },
    ],
  };
  const report = renderTrend(mixed);
  assert.match(report, /in progress \| pass \| fail \| pass \| pass \| pass \| fail \|/);
});

test("reports no data for a gate when any scenario row is malformed", () => {
  const mixed = {
    ...results,
    structural: [
      ...results.structural.filter((row) => row.id !== "dom-nodes"),
      { id: "dom-nodes", pass: true },
      { id: "dom-nodes", pass: null },
    ],
  };
  const report = renderTrend(mixed);
  assert.match(report, /in progress \| pass \| no data \| pass \| pass \| pass \| fail \|/);
});

test("renders current and sorted main rows, gates, timing, median runtime, and rerun/failure share", () => {
  const report = renderTrend(results, [
    { run: run(1, "2026-09-24T00:00:00Z"), results },
    { run: run(2, "2026-09-26T00:00:00Z", 2), results: null },
    { run: run(3, "2026-09-25T00:00:00Z", 1, "failure"), results },
  ]);
  assert.match(report, /Runs: 4 \(current \+ 3 main\); completed performance jobs: 3/);
  assert.match(report, /Median completed job runtime: 10\.00 min\. Flake indicator \(rerun or failed job\): 66\.7% \(2\/3\)/);
  assert.match(report, /`12345678` \| 2026-09-27 \| no data \| in progress \| pass \| pass \| pass \| pass \| pass \| fail \| 1\.24× \| 54\.00 ms \| 173\.00 ms \| 82\.00 ms/);
  assert.ok(report.indexOf("`22222222`") < report.indexOf("`33333333`"));
  assert.ok(report.indexOf("`33333333`") < report.indexOf("`11111111`"));
  assert.match(report, /`22222222` \| 2026-09-26 \| 10\.00 min \| success \/ 2 \| no data/);
});

test("bounds history to the newest 20, excluding older runs from the indicator", () => {
  const history = Array.from({ length: 25 }, (_, index) => ({
    run: run(index + 1, new Date(Date.UTC(2026, 8, index + 1)).toISOString(), 1, index === 0 ? "failure" : "success"),
    results,
  }));
  const report = renderTrend(results, history);
  assert.match(report, /Runs: 21 \(current \+ 20 main\)/);
  assert.match(report, /Flake indicator \(rerun or failed job\): 0\.0% \(0\/20\)/);
  assert.equal(report.split("\n").filter((line) => line.startsWith("| `")).length, 21);
});

test("missing and malformed inputs render no-data rows without failing the CLI", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "performance-trend-"));
  try {
    mkdirSync(path.join(directory, "one"));
    writeFileSync(path.join(directory, "one", "run.json"), JSON.stringify(run(4, "2026-09-26T00:00:00Z")));
    writeFileSync(path.join(directory, "one", "results.json"), "{invalid");
    mkdirSync(path.join(directory, "two"));
    writeFileSync(path.join(directory, "two", "run.json"), "not json");
    writeFileSync(path.join(directory, "current.json"), "{invalid");
    assert.equal(collectHistory(directory).length, 2);
    const result = spawnSync(process.execPath, [cli, "--current", path.join(directory, "current.json"), "--history", directory], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Runs: 3 \(current \+ 2 main\); completed performance jobs: 1/);
    assert.match(result.stdout, /Flake indicator \(rerun or failed job\): 0\.0% \(0\/1\)/);
    assert.equal(result.stdout.split("\n").filter((line) => line.startsWith("| no data")).length, 2);
    assert.match(result.stdout, /`44444444` \| 2026-09-26 \| 10\.00 min \| success \/ 1 \| no data/);
    assert.equal(spawnSync(process.execPath, [cli, "--current", "missing", "--history", "missing"], { encoding: "utf8" }).status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
