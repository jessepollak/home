import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  browserEvidenceSection,
  createGitHubAdapter,
  factoryIssuePromptInput,
  factoryPullRequestBody,
  factoryResultBody,
  previewSectionFrom,
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
  labels: [{ name: "status:todo" }, { name: "lane:ops" }, { name: "priority:p1" }],
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
const REVIEWED_HEAD = "a".repeat(40);

function completed(stdout = "", extra = {}) {
  return { code: 0, timedOut: false, outputExceeded: false, stdout, ...extra };
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
  pullRequestSnapshots = [],
} = {}) {
  const calls = [];
  const pullRequestUpdates = [];
  const workerFindings = [];
  const workerLanes = [];
  const ciHeads = [];
  let reviewIndex = 0;
  let workerIndex = 0;
  let pullRequestIndex = 0;
  const github = {
    repositoryOwner: "jessepollak",
    async verifyAuthentication() { calls.push("auth"); if (authFailure) throw new Error("auth failed"); },
    async getIssue() { calls.push("issue"); return structuredClone(issue); },
    async openPullRequestsReferencing() {
      calls.push("references");
      return pullRequestSnapshots[Math.min(pullRequestIndex++, pullRequestSnapshots.length - 1)] ?? [];
    },
    async setStatus(_number, from, to) { calls.push(`status:${from}->${to}`); },
    async createPullRequest({ branch }) { calls.push(`pr:${branch}`); return "https://github.test/pr/1"; },
    async waitForRequiredChecks(_url, reviewedHead) {
      calls.push("ci"); ciHeads.push(reviewedHead);
      if (ciFailure) throw new Error("CI is not green");
    },
    async verifyPreviewProof() { calls.push("preview"); },
    async setPullRequestStatus(_url, from, to) { calls.push(`pr-status:${from}->${to}`); },
    async updatePullRequest(update) { pullRequestUpdates.push(structuredClone(update)); calls.push(`pr-evidence:${update.reviewFindings?.length ?? 0}`); },
  };
  const local = {
    async createWorktree() { calls.push("worktree"); if (worktreeFailure) throw new Error("branch already exists"); return "/fake/worktree"; },
    async setupWorktree() { calls.push("setup"); if (setupFailure) throw new Error("setup failed"); },
    async removeWorktree(_branch, preserve, owned) { calls.push(`cleanup:${preserve}:${owned}`); if (!preserve && owned) calls.push("delete-owned-branch"); },
    async preflight() { calls.push("preflight"); },
    async runWorker(_cwd, _issue, findings, remediationNumber) {
      calls.push(findings.length ? "remediation" : "worker");
      workerFindings.push(structuredClone(findings)); workerLanes.push(remediationNumber);
      if (workerFailure) throw new Error("worker failed");
      const result = workerReports[Math.min(workerIndex++, workerReports.length - 1)];
      return typeof result === "string" ? completed(result) : structuredClone(result);
    },
    async validateCommitAndPush(_cwd, _issue, _branch, loop) { calls.push(`validate:${loop}`); },
    async runReviewer() {
      calls.push("reviewer");
      const result = reviews[reviewIndex++];
      return typeof result === "string" ? completed(result, { reviewedHead: REVIEWED_HEAD }) : { ...structuredClone(result), reviewedHead: result.reviewedHead ?? REVIEWED_HEAD };
    },
  };
  return { github, local, calls, pullRequestUpdates, workerFindings, workerLanes, ciHeads };
}

async function withRunPaths(operation) {
  const directory = await mkdtemp(join(tmpdir(), "factory-supervisor-test-"));
  try {
    return await operation({ commonGitDirectory: directory, killSwitchPath: join(directory, "stop"), hostLockPath: join(directory, "lock") });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("model prompts receive only bounded issue fields and no assessment protocol", () => {
  const issue = {
    ...ISSUE,
    url: "https://github.test/issues/546",
    author: { ...ISSUE.author, name: "AUTHOR-NAME-SENTINEL" },
    labels: ISSUE.labels.map((label) => ({ ...label, description: "LABEL-DESCRIPTION-SENTINEL" })),
    comments: [{ body: "COMMENT-BODY-SENTINEL" }],
  };
  assert.deepEqual(Object.keys(factoryIssuePromptInput(issue)), ["number", "title", "body", "author", "state", "labels", "url"]);
  for (const prompt of [workerPrompt(issue), reviewerPrompt(issue, "safe diff")]) {
    assert.match(prompt, /Bounded runner/);
    assert.doesNotMatch(prompt, /AUTHOR-NAME-SENTINEL|LABEL-DESCRIPTION-SENTINEL|COMMENT-BODY-SENTINEL/);
  }
  assert.match(workerPrompt(issue), /no wallet, provider, production, database, funded/);
  assert.match(reviewerPrompt(issue, "safe diff"), /fresh independent read-only reviewer/);
});

test("frontend worker prompt keeps secret-free browser proof", () => {
  const issue = { ...ISSUE, labels: ISSUE.labels.map((label) => label.name === "lane:ops" ? { name: "lane:frontend" } : label) };
  const prompt = workerPrompt(issue);
  assert.match(prompt, /docs\/browser-validation\.md/);
  assert.match(prompt, /secret-free factory fixture mode before and after editing/);
  assert.match(prompt, /serverCleanupResult/);
  assert.match(prompt, /Playwright only for committed regression/);
});

test("factory PR bodies preserve preview proof and state that children cannot run funded checks", () => {
  const proof = "https://preview.example.test\n\n| State + viewport | Evidence |\n| --- | --- |\n| Review — 390×844 | ![Screen](https://github.com/user-attachments/assets/1) |";
  const initial = factoryPullRequestBody({ ...ISSUE, labels: [{ name: "lane:frontend" }] });
  assert.match(initial, /\| State \+ viewport \| Evidence \|/);
  assert.match(initial, /^## Real money\n\nReal money: not tested — factory children cannot run funded checks\.$/m);
  for (const heading of ["Preview", "Preview proof"]) {
    const body = factoryResultBody({
      currentBody: `Closes #546\n\n## ${heading}\n\n${proof}\n\n<!-- factory -->`,
      issue: ISSUE,
      outcome: "passed",
      stages: [{ name: "validation", outcome: "passed", durationMs: 12 }],
    });
    assert.match(body, /- validation: 12ms/);
    assert.match(body, /github\.com\/user-attachments/);
    assert.match(body, /^## Real money\n\nReal money: not tested — factory children cannot run funded checks\.$/m);
    assert.equal(body.match(/^## Real money$/gm)?.length, 1);
    assert.doesNotMatch(body, /Worker required outcomes|reviewer required outcomes|assessment/i);
  }
  assert.equal(previewSectionFrom(`## Preview\n\n${proof}\n\n## Notes`, ISSUE), proof);
});

test("browser evidence rendering is concise and escapes inline markdown", () => {
  const section = browserEvidenceSection({ ...BROWSER_EVIDENCE, exercisedPath: "Clicked [untrusted](https://example.test) `text`." });
  assert.match(section, /Route \/ viewport: \/save — 390x844 CSS px/);
  assert.doesNotMatch(section, /\[untrusted\]\(https:\/\/example\.test\)/);
});

test("supervisor runs ordinary completion, current-head review, CI, preview, and handoff", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun();
    const evidence = await runFactorySupervisor(546, { ...fake, ...paths });
    assert.equal(evidence.outcome, "passed");
    assert.equal(evidence.reviewedHead, REVIEWED_HEAD);
    assert.deepEqual(fake.ciHeads, [REVIEWED_HEAD]);
    assert.deepEqual(fake.calls, [
      "auth", "issue", "references", "status:status:todo->status:working", "worktree", "setup", "preflight",
      "worker", "validate:0", "references", "pr:agent/546-factory-run", "reviewer", "ci", "preview", "pr-evidence:0",
      "status:status:working->status:needs-jesse", "pr-status:status:working->status:needs-jesse", "cleanup:true:true",
    ]);
    const files = await readdir(join(paths.commonGitDirectory, "factory-runs"));
    const durable = JSON.parse(await readFile(join(paths.commonGitDirectory, "factory-runs", files[0]), "utf8"));
    assert.equal(durable.reviewedHead, REVIEWED_HEAD);
    assert.deepEqual(Object.keys(durable).sort(), ["branch", "browserEvidence", "durationMs", "issue", "outcome", "prUrl", "reviewedHead", "stages"]);
  });
});

test("supervisor allows at most two repair loops and escalates the final repair lane", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun({ reviews: [FAIL, FAIL, FAIL] });
    const evidence = await runFactorySupervisor(546, { ...fake, ...paths });
    assert.equal(evidence.outcome, "needs-jesse");
    assert.deepEqual(evidence.blockingReviewFindings, [{ file: "runner.mjs:1", description: "fix it" }]);
    assert.deepEqual(fake.workerLanes, [0, 1, 2]);
    assert.equal(fake.calls.filter((call) => call === "remediation").length, 2);
    assert.deepEqual(fake.workerFindings[1], [{ severity: "blocking", file: "runner.mjs:1", description: "fix it" }]);
  });
});

test("required browser evidence reaches diagnostics and malformed completion stops before validation", async () => {
  await withRunPaths(async (paths) => {
    const issue = { ...ISSUE, labels: ISSUE.labels.map((label) => label.name === "lane:ops" ? { name: "lane:frontend" } : label) };
    const good = fakeRun({ issue, workerReports: [BROWSER_WORKER_REPORT] });
    assert.deepEqual((await runFactorySupervisor(546, { ...good, ...paths })).browserEvidence, BROWSER_EVIDENCE);

    for (const report of [NULL_WORKER_REPORT, "not-json", '{"complete":true}']) {
      const bad = fakeRun({ issue, workerReports: [report] });
      await assert.rejects(runFactorySupervisor(546, { ...bad, ...paths }));
      assert.equal(bad.calls.some((call) => call.startsWith("validate:")), false);
      assert.ok(bad.calls.includes("status:status:working->status:todo"));
    }
  });
});

test("conflicting PR, failed CI, and malformed review fail closed", async () => {
  await withRunPaths(async (paths) => {
    const conflict = fakeRun({ pullRequestSnapshots: [[], [{ number: 9, url: "https://github.test/pr/9" }]] });
    await assert.rejects(runFactorySupervisor(546, { ...conflict, ...paths }), /conflicting open pull request/);
    assert.equal(conflict.calls.some((call) => call.startsWith("pr:agent/")), false);

    const ci = fakeRun({ ciFailure: true });
    await assert.rejects(runFactorySupervisor(546, { ...ci, ...paths }), /CI is not green/);
    assert.equal(ci.calls.some((call) => call.includes("working->status:needs-jesse")), false);

    const review = fakeRun({ reviews: ["unfinished review"] });
    await assert.rejects(runFactorySupervisor(546, { ...review, ...paths }), /not valid JSON/);
    assert.ok(review.calls.includes("pr-evidence:0"));
  });
});

test("pre-publication failure restores todo and deletes only its owned branch", async () => {
  await withRunPaths(async (paths) => {
    const worker = fakeRun({ workerFailure: true });
    await assert.rejects(runFactorySupervisor(546, { ...worker, ...paths }), /worker failed/);
    assert.ok(worker.calls.includes("status:status:working->status:todo"));
    assert.ok(worker.calls.includes("delete-owned-branch"));

    for (const fake of [fakeRun({ authFailure: true }), fakeRun({ worktreeFailure: true })]) {
      await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }));
      assert.equal(fake.calls.includes("delete-owned-branch"), false);
    }
  });
});

test("setup failure restores todo and deletes the branch created by this invocation", async () => {
  await withRunPaths(async (paths) => {
    const fake = fakeRun({ setupFailure: true });
    await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }), /setup failed/);
    assert.ok(fake.calls.includes("status:status:working->status:todo"));
    assert.ok(fake.calls.includes("cleanup:false:true"));
    assert.ok(fake.calls.includes("delete-owned-branch"));
  });
});

test("kill switch stops before the next stage and cleanup still runs", async () => {
  await withRunPaths(async (paths) => {
    await writeFile(paths.killSwitchPath, "stop\n");
    const fake = fakeRun();
    await assert.rejects(runFactorySupervisor(546, { ...fake, ...paths }), /kill switch/);
    assert.deepEqual(fake.calls, ["cleanup:false:false"]);
  });
});

test("GitHub adapter reads only the issue and typed open-PR timeline", async () => {
  const calls = [];
  const adapter = createGitHubAdapter({ gh: async (args) => {
    calls.push(args);
    if (args[1] === "graphql") return JSON.stringify({ data: { repository: { issue: {
      id: "I_546", number: 546, title: ISSUE.title, body: ISSUE.body, author: { login: "jessepollak" },
      state: "OPEN", labels: { nodes: ISSUE.labels }, url: "https://github.test/issues/546",
    } } } });
    if (args[1] === "--paginate") return JSON.stringify([[
      { event: "commented", body: "PR-like text", source: { issue: { number: 8, state: "open", pull_request: {} } } },
      { event: "cross-referenced", source: { issue: { number: 9, state: "open", html_url: "https://github.test/pr/9", pull_request: {} } } },
    ]]);
    throw new Error(`unexpected: ${args.join(" ")}`);
  } });
  assert.deepEqual(await adapter.getIssue(546), { ...ISSUE, nodeId: "I_546", url: "https://github.test/issues/546" });
  assert.deepEqual(await adapter.openPullRequestsReferencing(546), [{ number: 9, url: "https://github.test/pr/9" }]);
  assert.equal(calls.some((args) => args.join(" ").includes("comments")), false);
  assert.equal(calls.some((args) => args.join(" ").includes("reactions")), false);
});

test("GitHub adapter rejects transport failures, stale issues, and malformed issue responses", async () => {
  const transportFailure = createGitHubAdapter({ gh: async () => { throw new Error("transport failed"); } });
  await assert.rejects(transportFailure.getIssue(546), /transport failed/);

  const stale = createGitHubAdapter({ gh: async () => JSON.stringify({ data: { repository: { issue: null } } }) });
  await assert.rejects(stale.getIssue(546), /issue is unavailable/);

  const malformed = createGitHubAdapter({ gh: async () => JSON.stringify({ data: { repository: { issue: { number: 546 } } } }) });
  await assert.rejects(malformed.getIssue(546), /issue response shape is invalid/);
});

test("GitHub adapter requires CI on the exact independently reviewed head", async () => {
  const calls = [];
  let head = REVIEWED_HEAD;
  const adapter = createGitHubAdapter({ gh: async (args) => {
    calls.push(args);
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ headRefOid: head });
    if (args[0] === "pr" && args[1] === "checks") return "";
    throw new Error(`unexpected: ${args.join(" ")}`);
  } });
  await adapter.waitForRequiredChecks("https://github.test/pr/1", REVIEWED_HEAD);
  assert.equal(calls.filter((args) => args[1] === "checks").length, 1);
  head = "b".repeat(40);
  await assert.rejects(adapter.waitForRequiredChecks("https://github.test/pr/1", REVIEWED_HEAD), /reviewed head/);
});
