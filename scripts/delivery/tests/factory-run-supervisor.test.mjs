import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  browserEvidenceSection,
  createGitHubAdapter,
  factoryIssuePromptInput,
  reviewerPrompt,
  runFactorySupervisor,
  workerPrompt,
} from "../factory-run.mjs";

const ISSUE = {
  number: 546,
  title: "Bounded runner",
  body: "Implement the bounded runner.",
  author: { login: "jessepollak" },
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
const NULL_WORKER_REPORT = '{"complete":true,"browserEvidence":null}';
const BROWSER_EVIDENCE = {
  mode: "factory fixture",
  route: "/save",
  viewport: { width: 390, height: 844 },
  exercisedPath: "Opened Save, selected USDC, and reached review.",
  recoveryAndBackResult: "Invalid amount recovered; Back returned to asset selection.",
  consoleResult: "No unexpected console messages.",
  pageErrorResult: "No uncaught page errors.",
  serverCleanupResult: "Terminated and waited for owned fixture-server PID.",
};
const BROWSER_WORKER_REPORT = JSON.stringify({ complete: true, browserEvidence: BROWSER_EVIDENCE });

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
  workerReports = [NULL_WORKER_REPORT],
} = {}) {
  const calls = [];
  const pullRequestUpdates = [];
  let reviewIndex = 0;
  let workerIndex = 0;
  const github = {
    repositoryOwner: "jessepollak",
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
    async updatePullRequest(update) {
      pullRequestUpdates.push(structuredClone(update));
      calls.push(`pr-evidence:${update.reviewFindings?.length ?? 0}`);
    },
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
      return completed(workerReports[Math.min(workerIndex++, workerReports.length - 1)]);
    },
    async validateCommitAndPush(_cwd, _issue, _branch, loop) { calls.push(`validate:${loop}`); },
    async runReviewer() { calls.push("reviewer"); return completed(reviews[reviewIndex++]); },
  };
  return { github, local, calls, pullRequestUpdates };
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

test("repository owner is derived from the configured owner/repo", () => {
  assert.equal(createGitHubAdapter({ repository: "configured-owner/home", environment: {} }).repositoryOwner, "configured-owner");
  assert.throws(() => createGitHubAdapter({ repository: "unscoped-repository", environment: {} }), /owner\/repo/);
});

test("model prompts receive only the bounded issue fields and no timeline or comment text", () => {
  const issue = {
    ...ISSUE,
    title: "Bounded runner",
    url: "https://github.test/issues/546",
    author: { ...ISSUE.author, name: "AUTHOR-NAME-SENTINEL" },
    labels: ISSUE.labels.map((label) => ({ ...label, description: "LABEL-DESCRIPTION-SENTINEL" })),
    comments: [{ body: "COMMENT-BODY-SENTINEL" }],
    timeline: [{ body: "TIMELINE-BODY-SENTINEL" }],
    arbitrary: "ARBITRARY-FIELD-SENTINEL",
  };
  const input = factoryIssuePromptInput(issue);
  assert.deepEqual(Object.keys(input), ["number", "title", "body", "author", "state", "labels", "url"]);
  assert.deepEqual(input.author, { login: "jessepollak" });
  assert.deepEqual(input.labels, ISSUE.labels);

  for (const prompt of [workerPrompt(issue), reviewerPrompt(issue, "safe diff")]) {
    assert.match(prompt, /Bounded runner/);
    assert.doesNotMatch(prompt, /AUTHOR-NAME-SENTINEL|LABEL-DESCRIPTION-SENTINEL|COMMENT-BODY-SENTINEL|TIMELINE-BODY-SENTINEL|ARBITRARY-FIELD-SENTINEL/);
  }
});

test("worker prompt requires the browser-validation contract for user-visible work", () => {
  const prompt = workerPrompt(ISSUE);

  assert.match(prompt, /docs\/browser-validation\.md/);
  assert.match(prompt, /repository-pinned agent-browser/);
  assert.match(prompt, /secret-free factory fixture mode before and after editing/);
  assert.match(prompt, /Return exactly one final JSON object and no markdown or commentary/);
  assert.match(prompt, /serverCleanupResult/);
  assert.match(prompt, /Playwright only for committed regression/);
});

test("browser evidence rendering is concise and escapes inline markdown", () => {
  const section = browserEvidenceSection({
    ...BROWSER_EVIDENCE,
    exercisedPath: "Clicked [untrusted](https://example.test) `text`.",
  });
  assert.match(section, /Mode: factory fixture/);
  assert.match(section, /Route \/ viewport: \/save — 390x844 CSS px/);
  assert.match(section, /Fixture server cleanup: Terminated and waited/);
  assert.doesNotMatch(section, /\[untrusted\]\(https:\/\/example\.test\)/);
  assert.match(browserEvidenceSection(null), /Not required/);
});

test("supervisor waits for current-head CI before promoting a normal PR", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun();
    const evidence = await runFactorySupervisor(546, { ...fake, ...paths });
    assert.equal(evidence.outcome, "passed");
    assert.equal(evidence.prUrl, "https://github.test/pr/1");
    assert.equal(evidence.browserEvidence, null);
    assert.equal(fake.pullRequestUpdates.at(-1).browserEvidence, null);
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

test("required valid browser evidence reaches run evidence and the PR update", async () => {
  await withRunPaths(async (paths) => {
    const issue = { ...ISSUE, labels: ISSUE.labels.map((label) => label.name === "lane:ops" ? { name: "lane:frontend" } : label) };
    const fake = fakeRun({ issue, workerReports: [BROWSER_WORKER_REPORT] });
    const evidence = await runFactorySupervisor(546, { ...fake, ...paths });

    assert.deepEqual(evidence.browserEvidence, BROWSER_EVIDENCE);
    assert.deepEqual(fake.pullRequestUpdates.at(-1).browserEvidence, BROWSER_EVIDENCE);
    assert.ok(fake.calls.indexOf("worker") < fake.calls.indexOf("validate:0"));
  });
});

test("missing or malformed required browser evidence fails before validation and publication", async () => {
  await withRunPaths(async (paths) => {
    const issue = { ...ISSUE, labels: ISSUE.labels.map((label) => label.name === "lane:ops" ? { name: "lane:design" } : label) };
    for (const report of [NULL_WORKER_REPORT, "not-json", '{"complete":true}']) {
      const fake = fakeRun({ issue, workerReports: [report] });
      await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }), /worker (?:browser evidence is required|output is not valid JSON|report fields are invalid)/);
      assert.equal(fake.calls.some((call) => call.startsWith("validate:")), false);
      assert.equal(fake.calls.some((call) => call.startsWith("pr:")), false);
      assert.ok(fake.calls.includes("status:status:working->status:todo"));
    }
  });
});

test("remediation replaces retained browser evidence before revalidation and handoff", async () => {
  await withRunPaths(async (paths) => {
    const issue = { ...ISSUE, labels: ISSUE.labels.map((label) => label.name === "lane:ops" ? { name: "lane:frontend" } : label) };
    const refreshed = {
      ...BROWSER_EVIDENCE,
      exercisedPath: "Retested Save after remediation and reached the corrected review.",
    };
    const fake = fakeRun({
      issue,
      reviews: [FAIL, PASS],
      workerReports: [BROWSER_WORKER_REPORT, JSON.stringify({ complete: true, browserEvidence: refreshed })],
    });
    const evidence = await runFactorySupervisor(546, { ...fake, ...paths });

    assert.deepEqual(evidence.browserEvidence, refreshed);
    assert.deepEqual(fake.pullRequestUpdates.at(-1).browserEvidence, refreshed);
    assert.ok(fake.calls.indexOf("remediation") < fake.calls.indexOf("validate:1"));
  });
});

test("malformed remediation evidence fails before remediation validation and retains prior valid evidence", async () => {
  await withRunPaths(async (paths) => {
    const issue = { ...ISSUE, labels: ISSUE.labels.map((label) => label.name === "lane:ops" ? { name: "lane:frontend" } : label) };
    const fake = fakeRun({ issue, reviews: [FAIL], workerReports: [BROWSER_WORKER_REPORT, "bad report"] });
    await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }), /worker output is not valid JSON/);

    assert.equal(fake.calls.includes("validate:1"), false);
    assert.deepEqual(fake.pullRequestUpdates.at(-1).browserEvidence, BROWSER_EVIDENCE);
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
