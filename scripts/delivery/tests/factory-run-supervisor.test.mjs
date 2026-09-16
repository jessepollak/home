import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runFactorySupervisor } from "../factory-run.mjs";

const ISSUE = {
  number: 546,
  title: "Bounded runner",
  body: "Implement the bounded runner.",
  state: "OPEN",
  labels: [
    { name: "factory:ready" },
    { name: "status:todo" },
    { name: "lane:ops" },
    { name: "priority:p1" },
  ],
};
const PASS = '{"complete":true,"verdict":"pass","findings":[]}';
const FAIL = '{"complete":true,"verdict":"fail","findings":[{"severity":"blocking","file":"runner.mjs:1","description":"fix it"}]}';

function completed(stdout = "") {
  return { code: 0, timedOut: false, outputExceeded: false, stdout };
}

function fakeRun({ reviews = [PASS], workerFailure = false } = {}) {
  const calls = [];
  let reviewIndex = 0;
  const github = {
    async verifyAuthentication() { calls.push("auth"); },
    async getIssue() { calls.push("issue"); return structuredClone(ISSUE); },
    async openPullRequestsReferencing() { calls.push("references"); return []; },
    async setStatus(_number, from, to) { calls.push(`status:${from}->${to}`); },
    async createPullRequest({ branch }) { calls.push(`pr:${branch}`); return "https://github.test/pr/1"; },
    async setPullRequestStatus(_url, from, to) { calls.push(`pr-status:${from}->${to}`); },
    async updatePullRequest() { calls.push("pr-evidence"); },
  };
  const local = {
    async createWorktree() { calls.push("worktree"); return "/fake/worktree"; },
    async removeWorktree(_branch, preserve) { calls.push(`cleanup:${preserve}`); },
    async preflight() { calls.push("preflight"); },
    async runWorker(_cwd, _issue, findings) {
      calls.push(findings.length ? "remediation" : "worker");
      if (workerFailure) throw new Error("worker failed");
      return completed();
    },
    async validateCommitAndPush(_cwd, _issue, _branch, loop) { calls.push(`validate:${loop}`); },
    async runReviewer() { calls.push("reviewer"); return completed(reviews[reviewIndex++]); },
  };
  return { github, local, calls };
}

async function withRunPaths(operation) {
  const directory = await mkdtemp(join(tmpdir(), "factory-supervisor-test-"));
  try {
    return await operation({ commonGitDirectory: directory, killSwitchPath: join(directory, "stop") });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("supervisor follows the bounded state sequence and publishes a normal PR", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun();
    const evidence = await runFactorySupervisor(546, { ...fake, ...paths });
    assert.equal(evidence.outcome, "passed");
    assert.equal(evidence.prUrl, "https://github.test/pr/1");
    assert.deepEqual(fake.calls, [
      "auth", "issue", "references", "status:status:todo->status:working",
      "worktree", "preflight", "worker", "validate:0", "pr:agent/546-factory-run",
      "reviewer", "status:status:working->status:needs-jesse",
      "pr-status:status:working->status:needs-jesse", "pr-evidence", "cleanup:true",
    ]);
    assert.ok(evidence.stages.every((stage) => Number.isInteger(stage.durationMs)));
  });
});

test("supervisor stops after exactly two remediation loops", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun({ reviews: [FAIL, FAIL, FAIL] });
    const evidence = await runFactorySupervisor(546, { ...fake, ...paths });
    assert.equal(evidence.outcome, "needs-jesse");
    assert.equal(fake.calls.filter((call) => call === "remediation").length, 2);
    assert.equal(fake.calls.filter((call) => call === "reviewer").length, 3);
    assert.equal(fake.calls.filter((call) => call.startsWith("validate:")).length, 3);
  });
});

test("failure before publication restores todo and releases worktree and host lock", async () => {
  await withRunPaths(async (paths) => {
    const first = fakeRun({ workerFailure: true });
    await assert.rejects(runFactorySupervisor(546, { ...first, ...paths }), /worker failed/);
    assert.ok(first.calls.includes("status:status:working->status:todo"));
    assert.ok(first.calls.includes("cleanup:false"));

    const second = fakeRun();
    const result = await runFactorySupervisor(546, { ...second, ...paths });
    assert.equal(result.outcome, "passed");
  });
});

test("kill switch fails before the next stage and still runs cleanup", async () => {
  await withRunPaths(async (paths) => {
    await writeFile(paths.killSwitchPath, "stop\n");
    const fake = fakeRun();
    await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }), /kill switch/);
    assert.deepEqual(fake.calls, ["cleanup:false"]);
  });
});

test("malformed reviewer output is a failure and never a pass", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun({ reviews: ["unfinished review"] });
    await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }), /not valid JSON/);
    assert.ok(fake.calls.includes("status:status:working->status:needs-jesse"));
    assert.ok(fake.calls.includes("pr-status:status:working->status:needs-jesse"));
    assert.ok(fake.calls.includes("cleanup:true"));
  });
});
