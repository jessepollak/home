import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateFactoryRunEligibility,
  factoryRunPolicyConstants,
  hasPreviewProof,
  openPullRequestsFromTimelinePages,
  parseReviewerVerdict,
  parseWorkerReport,
  planAfterReview,
  previewProofRequired,
} from "../factory-run-policy.mjs";

const REPOSITORY_OWNER = "jessepollak";
const TODO_ISSUE = {
  number: 546,
  body: "Implement the bounded runner.",
  author: { login: REPOSITORY_OWNER },
  state: "OPEN",
  labels: [{ name: "status:todo" }, { name: "lane:ops" }, { name: "priority:p1" }],
};

test("operator-invoked eligibility requires an open owner-authored todo with one lane and priority", () => {
  assert.deepEqual(evaluateFactoryRunEligibility(TODO_ISSUE, [], REPOSITORY_OWNER), { eligible: true, failures: [] });

  for (const [issue, pulls, failure] of [
    [{ ...TODO_ISSUE, state: "CLOSED" }, [], "OPEN"],
    [{ ...TODO_ISSUE, author: { login: "factory" } }, [], "repository owner"],
    [{ ...TODO_ISSUE, labels: [{ name: "lane:ops" }, { name: "priority:p1" }] }, [], "status:todo"],
    [{ ...TODO_ISSUE, labels: [...TODO_ISSUE.labels, { name: "status:blocked" }] }, [], "exactly one status"],
    [{ ...TODO_ISSUE, labels: TODO_ISSUE.labels.filter(({ name }) => !name.startsWith("lane:")) }, [], "exactly one lane"],
    [{ ...TODO_ISSUE, labels: [...TODO_ISSUE.labels, { name: "priority:p2" }] }, [], "exactly one priority"],
    [TODO_ISSUE, [{ number: 1 }], "open pull request"],
  ]) {
    const result = evaluateFactoryRunEligibility(issue, pulls, REPOSITORY_OWNER);
    assert.equal(result.eligible, false);
    assert.match(result.failures.join("\n"), new RegExp(failure));
  }
  assert.deepEqual(factoryRunPolicyConstants.requiredLabels, ["status:todo"]);
});

test("unrelated labels and attribution text do not create another authorization route", () => {
  assert.deepEqual(evaluateFactoryRunEligibility({
    ...TODO_ISSUE,
    body: "Attributed issue body.\n<!-- factory -->",
    labels: [...TODO_ISSUE.labels, { name: "area:delivery" }],
  }, [], REPOSITORY_OWNER), { eligible: true, failures: [] });
});

test("open PR references are typed, paginated, and deduplicated", () => {
  const open = { event: "cross-referenced", source: { issue: { number: 7, state: "open", html_url: "https://example.test/7", pull_request: {} } } };
  const closed = { event: "cross-referenced", source: { issue: { number: 8, state: "closed", html_url: "https://example.test/8", pull_request: {} } } };
  const comment = { event: "commented", body: "PR #99", source: { issue: { number: 99, state: "open", pull_request: {} } } };
  assert.deepEqual(openPullRequestsFromTimelinePages([[open], [open, closed, comment]]), [
    { number: 7, url: "https://example.test/7" },
  ]);
  assert.throws(() => openPullRequestsFromTimelinePages({ nodes: [] }), /timeline is unavailable/);
});

const BROWSER_EVIDENCE = {
  mode: "factory fixture",
  route: "/invest",
  viewport: { width: 390, height: 844 },
  exercisedPath: "Opened Invest, selected an asset, and reached review.",
  recoveryAndBackResult: "Recovered from an invalid amount; Back restored asset selection.",
  consoleResult: "No unexpected console messages.",
  pageErrorResult: "No uncaught page errors.",
  serverCleanupResult: "Terminated and waited for the exact owned fixture-server PID.",
};

test("worker completion parsing accepts only the ordinary exact report", () => {
  assert.deepEqual(parseWorkerReport(JSON.stringify({ complete: true, browserEvidence: BROWSER_EVIDENCE }), true), {
    complete: true,
    browserEvidence: BROWSER_EVIDENCE,
  });
  assert.deepEqual(parseWorkerReport('{"complete":true,"browserEvidence":null}', false), {
    complete: true,
    browserEvidence: null,
  });

  for (const [report, required] of [
    ["not json", true],
    [JSON.stringify({ complete: false, browserEvidence: BROWSER_EVIDENCE }), true],
    [JSON.stringify({ complete: true, browserEvidence: null }), true],
    [JSON.stringify({ complete: true, browserEvidence: BROWSER_EVIDENCE, obsoleteField: [] }), true],
    [JSON.stringify({ complete: true, browserEvidence: { ...BROWSER_EVIDENCE, route: "/invest?token=secret" } }), true],
    [JSON.stringify({ complete: true, browserEvidence: { ...BROWSER_EVIDENCE, viewport: { width: 100, height: 844 } } }), true],
    [JSON.stringify({ complete: true, browserEvidence: { ...BROWSER_EVIDENCE, consoleResult: "x".repeat(201) } }), true],
    [JSON.stringify({ complete: true }), false],
  ]) assert.throws(() => parseWorkerReport(report, required));
});

test("reviewer verdict parsing accepts only complete internally consistent findings", () => {
  assert.deepEqual(parseReviewerVerdict('{"complete":true,"verdict":"pass","findings":[]}'), {
    complete: true,
    verdict: "pass",
    findings: [],
  });
  for (const output of [
    "not json",
    '{"complete":false,"verdict":"pass","findings":[]}',
    '{"complete":true,"verdict":"fail","findings":[]}',
    '{"complete":true,"verdict":"pass","findings":[{"severity":"blocking","file":"a:1","description":"bug"}]}',
    '{"complete":true,"verdict":"pass","findings":[],"obsoleteField":[]}',
    '{"complete":true,"verdict":"fail","findings":[{"severity":"blocking","file":"","description":"bug"}]}',
  ]) assert.throws(() => parseReviewerVerdict(output));
});

test("preview proof requires a Vercel URL and retained media", () => {
  assert.equal(previewProofRequired(TODO_ISSUE), false);
  assert.equal(previewProofRequired({ ...TODO_ISSUE, labels: [{ name: "lane:frontend" }] }), true);
  assert.equal(hasPreviewProof("https://example.vercel.app"), false);
  assert.equal(hasPreviewProof("https://example.vercel.app\n| State + viewport | Evidence |\n| --- | --- |\n| Review — 390x844 | ![review](https://github.com/user-attachments/assets/1) |"), true);
});

test("review planning caps remediation at two loops", () => {
  const fail = parseReviewerVerdict('{"complete":true,"verdict":"fail","findings":[{"severity":"blocking","file":"a:1","description":"bug"}]}');
  assert.deepEqual(planAfterReview(fail, 0), { action: "remediate", completedFixLoops: 1 });
  assert.deepEqual(planAfterReview(fail, 1), { action: "remediate", completedFixLoops: 2 });
  assert.deepEqual(planAfterReview(fail, 2), { action: "stop-for-jesse", completedFixLoops: 2 });
  assert.equal(factoryRunPolicyConstants.maxFixLoops, 2);
  assert.deepEqual(planAfterReview(parseReviewerVerdict('{"complete":true,"verdict":"pass","findings":[]}'), 2), { action: "complete", completedFixLoops: 2 });
});
