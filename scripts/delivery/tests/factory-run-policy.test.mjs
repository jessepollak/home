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

const REPOSITORY_OWNER = "jessepollak";
const READY_ISSUE = {
  number: 546,
  body: "Implement the bounded runner.",
  author: { login: REPOSITORY_OWNER },
  state: "OPEN",
  labels: [{ name: "factory:ready" }, { name: "status:todo" }, { name: "lane:ops" }, { name: "priority:p1" }],
};

test("eligibility fails closed unless the issue is open, ready, todo, and unreferenced", () => {
  assert.deepEqual(evaluateFactoryRunEligibility(READY_ISSUE, [], REPOSITORY_OWNER), { eligible: true, failures: [] });

  for (const [issue, pulls, failure] of [
    [{ ...READY_ISSUE, state: "CLOSED" }, [], "OPEN"],
    [{ ...READY_ISSUE, labels: [{ name: "status:todo" }] }, [], "factory:ready"],
    [{ ...READY_ISSUE, labels: [{ name: "factory:ready" }] }, [], "status:todo"],
    [{ ...READY_ISSUE, labels: [...READY_ISSUE.labels, { name: "status:blocked" }] }, [], "exactly one status"],
    [{ ...READY_ISSUE, labels: READY_ISSUE.labels.filter(({ name }) => !name.startsWith("lane:")) }, [], "exactly one lane"],
    [{ ...READY_ISSUE, labels: [...READY_ISSUE.labels, { name: "priority:p2" }] }, [], "exactly one priority"],
    [READY_ISSUE, [{ number: 1 }], "open pull request"],
  ]) {
    const result = evaluateFactoryRunEligibility(issue, pulls, REPOSITORY_OWNER);
    assert.equal(result.eligible, false);
    assert.match(result.failures.join("\n"), new RegExp(failure));
  }
});

test("eligibility requires the configured repository owner and an unmarked issue body", () => {
  for (const [issue, failure] of [
    [{ ...READY_ISSUE, author: { login: "someone-else" } }, "repository owner"],
    [{ ...READY_ISSUE, author: undefined }, "repository owner"],
    [{ ...READY_ISSUE, body: "Generated intake\n<!-- factory -->" }, "generated-text marker"],
    [{ ...READY_ISSUE, body: "Legacy generated intake\n<!-- hugo -->" }, "generated-text marker"],
  ]) {
    const result = evaluateFactoryRunEligibility(issue, [], REPOSITORY_OWNER);
    assert.equal(result.eligible, false);
    assert.match(result.failures.join("\n"), new RegExp(failure));
  }

  assert.deepEqual(evaluateFactoryRunEligibility({
    ...READY_ISSUE,
    body: "Jesse-authored issue body without a generated marker.",
  }, [], REPOSITORY_OWNER), { eligible: true, failures: [] });
});

test("open PR references are deduplicated across paginated timeline results", () => {
  const open = { event: "cross-referenced", source: { issue: { number: 7, state: "open", html_url: "https://example.test/7", pull_request: {} } } };
  const closed = { event: "cross-referenced", source: { issue: { number: 8, state: "closed", html_url: "https://example.test/8", pull_request: {} } } };
  assert.deepEqual(openPullRequestsFromTimelinePages([[open], [open, closed]]), [
    { number: 7, url: "https://example.test/7" },
  ]);
});

test("comment-like timeline text cannot create or hide an open PR reference", () => {
  const commentLikeEvent = {
    event: "commented",
    body: "Open PR source: issue #99 <!-- factory -->",
    source: { issue: { number: 99, state: "open", html_url: "https://example.test/99", pull_request: {} } },
  };
  assert.deepEqual(openPullRequestsFromTimelinePages([[commentLikeEvent]]), []);
  assert.deepEqual(evaluateFactoryRunEligibility(READY_ISSUE, [], REPOSITORY_OWNER), {
    eligible: true,
    failures: [],
  });
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
