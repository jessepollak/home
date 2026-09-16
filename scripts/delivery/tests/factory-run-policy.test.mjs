import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateFactoryRunEligibility,
  factoryRunPolicyConstants,
  hasPreviewProof,
  openPullRequestsFromTimelinePages,
  parseReviewerVerdict,
  planAfterReview,
  previewProofRequired,
} from "../factory-run-policy.mjs";

const READY_ISSUE = {
  number: 546,
  state: "OPEN",
  labels: [{ name: "factory:ready" }, { name: "status:todo" }, { name: "lane:ops" }, { name: "priority:p1" }],
};

test("eligibility fails closed unless the issue is open, ready, todo, and unreferenced", () => {
  assert.deepEqual(evaluateFactoryRunEligibility(READY_ISSUE, []), { eligible: true, failures: [] });

  for (const [issue, pulls, failure] of [
    [{ ...READY_ISSUE, state: "CLOSED" }, [], "OPEN"],
    [{ ...READY_ISSUE, labels: [{ name: "status:todo" }] }, [], "factory:ready"],
    [{ ...READY_ISSUE, labels: [{ name: "factory:ready" }] }, [], "status:todo"],
    [{ ...READY_ISSUE, labels: [...READY_ISSUE.labels, { name: "status:blocked" }] }, [], "exactly one status"],
    [{ ...READY_ISSUE, labels: READY_ISSUE.labels.filter(({ name }) => !name.startsWith("lane:")) }, [], "exactly one lane"],
    [{ ...READY_ISSUE, labels: [...READY_ISSUE.labels, { name: "priority:p2" }] }, [], "exactly one priority"],
    [READY_ISSUE, [{ number: 1 }], "open pull request"],
  ]) {
    const result = evaluateFactoryRunEligibility(issue, pulls);
    assert.equal(result.eligible, false);
    assert.match(result.failures.join("\n"), new RegExp(failure));
  }
});

test("open PR references are deduplicated across paginated timeline results", () => {
  const open = { source: { issue: { number: 7, state: "open", html_url: "https://example.test/7", pull_request: {} } } };
  const closed = { source: { issue: { number: 8, state: "closed", html_url: "https://example.test/8", pull_request: {} } } };
  assert.deepEqual(openPullRequestsFromTimelinePages([[open], [open, closed]]), [
    { number: 7, url: "https://example.test/7" },
  ]);
});

test("reviewer verdict parsing accepts only complete, internally consistent JSON", () => {
  assert.deepEqual(parseReviewerVerdict('{"complete":true,"verdict":"pass","findings":[]}'), {
    complete: true,
    verdict: "pass",
    findings: [],
  });

  for (const output of [
    "not json",
    '{"complete":false,"verdict":"pass","findings":[]}',
    '{"complete":true,"verdict":"maybe","findings":[]}',
    '{"complete":true,"verdict":"fail","findings":[]}',
    '{"complete":true,"verdict":"pass","findings":[{"severity":"blocking","file":"a:1","description":"bug"}]}',
    '{"complete":true,"verdict":"fail","findings":[{"severity":"blocking","file":"","description":"bug"}]}',
  ]) {
    assert.throws(() => parseReviewerVerdict(output));
  }
});

test("preview policy derives applicability and requires both URL and media", () => {
  assert.equal(previewProofRequired(READY_ISSUE), false);
  assert.equal(previewProofRequired({ ...READY_ISSUE, labels: [{ name: "lane:frontend" }] }), true);
  assert.equal(hasPreviewProof("https://example.vercel.app"), false);
  assert.equal(hasPreviewProof("![current head](https://github.com/user-attachments/assets/1)"), false);
  assert.equal(hasPreviewProof("https://example.vercel.app\n![current head](https://github.com/user-attachments/assets/1)"), true);
});

test("the state policy mechanically caps remediation at two loops", () => {
  const fail = parseReviewerVerdict('{"complete":true,"verdict":"fail","findings":[{"severity":"blocking","file":"a:1","description":"bug"}]}');
  assert.deepEqual(planAfterReview(fail, 0), { action: "remediate", completedFixLoops: 1 });
  assert.deepEqual(planAfterReview(fail, 1), { action: "remediate", completedFixLoops: 2 });
  assert.deepEqual(planAfterReview(fail, 2), { action: "stop-for-jesse", completedFixLoops: 2 });
  assert.equal(factoryRunPolicyConstants.maxFixLoops, 2);

  const pass = parseReviewerVerdict('{"complete":true,"verdict":"pass","findings":[]}');
  assert.deepEqual(planAfterReview(pass, 2), { action: "complete", completedFixLoops: 2 });
});
