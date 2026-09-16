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

function fakeRun({
  reviews = [PASS],
  issue = ISSUE,
  authFailure = false,
  workerFailure = false,
  worktreeFailure = false,
  setupFailure = false,
  ciFailure = false,
} = {}) {
  const calls = [];
  let reviewIndex = 0;
  const github = {
    async verifyAuthentication() {
      calls.push("auth");
      if (authFailure) throw new Error("auth failed");
    },
    async getIssue() { calls.push("issue"); return structuredClone(issue); },
    async openPullRequestsReferencing() { calls.push("references"); return []; },
    async setStatus(_number, from, to) { calls.push(`status:${from}->${to}`); },
    async createPullRequest({ branch }) { calls.push(`pr:${branch}`); return "https://github.test/pr/1"; },
    async waitForRequiredChecks() {
      calls.push("ci");
      if (ciFailure) throw new Error("CI is not green");
    },
    async verifyPreviewProof() { calls.push("preview"); },
    async setPullRequestStatus(_url, from, to) { calls.push(`pr-status:${from}->${to}`); },
    async updatePullRequest({ reviewFindings = [] }) { calls.push(`pr-evidence:${reviewFindings.length}`); },
  };
  const local = {
    async createWorktree() {
      calls.push("worktree");
      if (worktreeFailure) throw new Error("branch already exists");
      return "/fake/worktree";
    },
    async setupWorktree() {
      calls.push("setup");
      if (setupFailure) throw new Error("setup failed");
    },
    async removeWorktree(_branch, preserve, owned) {
      calls.push(`cleanup:${preserve}:${owned}`);
      if (!preserve && owned) calls.push("delete-owned-branch");
    },
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
    return await operation({
      commonGitDirectory: directory,
      killSwitchPath: join(directory, "stop"),
      hostLockPath: join(directory, "lock"),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("supervisor waits for current-head CI before promoting a normal PR", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun();
    const evidence = await runFactorySupervisor(546, { ...fake, ...paths });
    assert.equal(evidence.outcome, "passed");
    assert.equal(evidence.prUrl, "https://github.test/pr/1");
    assert.deepEqual(fake.calls, [
      "auth", "issue", "references", "status:status:todo->status:working",
      "worktree", "setup", "preflight", "worker", "validate:0", "pr:agent/546-factory-run",
      "reviewer", "ci", "preview", "pr-evidence:0",
      "status:status:working->status:needs-jesse",
      "pr-status:status:working->status:needs-jesse", "cleanup:true:true",
    ]);
    assert.ok(evidence.stages.every((stage) => Number.isInteger(stage.durationMs)));
  });
});

test("non-green CI fails closed without status promotion", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun({ ciFailure: true });
    await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }), /CI is not green/);
    assert.ok(fake.calls.includes("ci"));
    assert.ok(fake.calls.includes("pr-evidence:0"));
    assert.equal(fake.calls.some((call) => call.includes("working->status:needs-jesse")), false);
  });
});

test("supervisor stops after exactly two remediation loops with concise findings", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun({ reviews: [FAIL, FAIL, FAIL] });
    const evidence = await runFactorySupervisor(546, { ...fake, ...paths });
    assert.equal(evidence.outcome, "needs-jesse");
    assert.deepEqual(evidence.blockingReviewFindings, [{ file: "runner.mjs:1", description: "fix it" }]);
    assert.equal(fake.calls.filter((call) => call === "remediation").length, 2);
    assert.equal(fake.calls.filter((call) => call === "reviewer").length, 3);
    assert.equal(fake.calls.filter((call) => call.startsWith("validate:")).length, 3);
    assert.ok(fake.calls.includes("pr-evidence:1"));
    assert.ok(fake.calls.indexOf("ci") < fake.calls.indexOf("status:status:working->status:needs-jesse"));
  });
});

test("failure before publication restores todo and deletes only its owned branch", async () => {
  await withRunPaths(async (paths) => {
    const first = fakeRun({ workerFailure: true });
    await assert.rejects(runFactorySupervisor(546, { ...first, ...paths }), /worker failed/);
    assert.ok(first.calls.includes("status:status:working->status:todo"));
    assert.ok(first.calls.includes("cleanup:false:true"));
    assert.ok(first.calls.includes("delete-owned-branch"));

    const second = fakeRun();
    const result = await runFactorySupervisor(546, { ...second, ...paths });
    assert.equal(result.outcome, "passed");
  });
});

test("authentication, eligibility, and pre-existing branch failures never delete a branch", async () => {
  await withRunPaths(async (paths) => {
    const conflicting = { ...ISSUE, labels: [...ISSUE.labels, { name: "status:blocked" }] };
    for (const fake of [
      fakeRun({ authFailure: true }),
      fakeRun({ issue: conflicting }),
      fakeRun({ worktreeFailure: true }),
    ]) {
      await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }));
      assert.equal(fake.calls.includes("delete-owned-branch"), false);
      assert.ok(fake.calls.includes("cleanup:false:false"));
    }
  });
});

test("setup failure deletes the branch created by this invocation", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun({ setupFailure: true });
    await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }), /setup failed/);
    assert.ok(fake.calls.includes("cleanup:false:true"));
    assert.ok(fake.calls.includes("delete-owned-branch"));
  });
});

test("kill switch fails before the next stage and still runs cleanup", async () => {
  await withRunPaths(async (paths) => {
    await writeFile(paths.killSwitchPath, "stop\n");
    const fake = fakeRun();
    await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }), /kill switch/);
    assert.deepEqual(fake.calls, ["cleanup:false:false"]);
  });
});

test("malformed reviewer output remains working and publishes bounded failure evidence", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun({ reviews: ["unfinished review"] });
    await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }), /not valid JSON/);
    assert.equal(fake.calls.some((call) => call.includes("working->status:needs-jesse")), false);
    assert.ok(fake.calls.includes("pr-evidence:0"));
    assert.ok(fake.calls.includes("cleanup:true:true"));
  });
});
