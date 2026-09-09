import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cleanupStatusLabelsForEvent,
  removeStatusLabels,
} from "../cleanup-status-labels.mjs";
import { planStatusLabelChanges } from "../status-label-policy.mjs";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

function jsonResponse(value, status = 200) {
  return { status, async json() { return structuredClone(value); } };
}

test("closed issue cleanup strips every status label and preserves owner/lane", async () => {
  const payload = await fixture("closed-verification-record");
  assert.deepEqual(planStatusLabelChanges("issues", payload), {
    issueNumber: 69,
    labelsToRemove: ["status:needs-jesse", "status:legacy-value"],
    reason: "closed-record-cleanup",
  });
});

test("merged PR cleanup only plans status-label removals for that PR", async () => {
  const payload = await fixture("merged-pr");
  const plan = planStatusLabelChanges("pull_request_target", payload);
  assert.deepEqual(plan, {
    issueNumber: 112,
    labelsToRemove: ["status:needs-jesse"],
    reason: "merged-record-cleanup",
  });
  assert.equal(Object.hasOwn(plan, "state"), false);
  assert.equal(JSON.stringify(plan).includes("69"), false);
  assert.equal(JSON.stringify(plan).includes("70"), false);
});

test("a closed draft still removes every status label rather than only promotion labels", async () => {
  const payload = await fixture("merged-pr");
  payload.pull_request.draft = true;
  payload.pull_request.labels.push({ name: "status:working" });

  assert.deepEqual(planStatusLabelChanges("pull_request_target", payload), {
    issueNumber: 112,
    labelsToRemove: ["status:needs-jesse", "status:working"],
    reason: "merged-record-cleanup",
  });
});

test("stack guard removes promotion labels but does not add or replace labels", async () => {
  const payload = await fixture("promoted-stacked");
  const plan = planStatusLabelChanges("pull_request_target", payload);
  assert.deepEqual(plan, {
    issueNumber: 114,
    labelsToRemove: ["status:needs-jesse"],
    reason: "non-main-promotion-guard",
  });
});

test("direct-main PR labels are left unchanged while the PR is open", async () => {
  const payload = await fixture("direct-main");
  assert.deepEqual(planStatusLabelChanges("pull_request_target", payload), {
    issueNumber: 112,
    labelsToRemove: [],
    reason: "direct-main",
  });
});

test("converted-to-draft removes only promotion labels from a live direct-main draft", async () => {
  const payload = await fixture("direct-main");
  payload.action = "converted_to_draft";
  payload.pull_request.draft = true;
  payload.pull_request.labels.push(
    { name: "status:working" },
    { name: "status:needs-jesse" },
  );

  assert.deepEqual(planStatusLabelChanges("pull_request_target", payload), {
    issueNumber: 112,
    labelsToRemove: ["status:ready-for-review", "status:needs-jesse"],
    reason: "draft-promotion-guard",
  });
});

test("a current draft removes promotion labels even when another metadata event triggered cleanup", async () => {
  const payload = await fixture("direct-main");
  payload.action = "edited";
  payload.pull_request.draft = true;

  assert.deepEqual(planStatusLabelChanges("pull_request_target", payload), {
    issueNumber: 112,
    labelsToRemove: ["status:ready-for-review"],
    reason: "draft-promotion-guard",
  });
});

test("cleanup GETs the current record before issuing only same-record DELETE calls", async () => {
  const payload = await fixture("closed-verification-record");
  const calls = [];
  const result = await cleanupStatusLabelsForEvent("issues", payload, {
    repository: "jessepollak/home",
    apiUrl: "https://api.github.test",
    token: "fixture-token",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers });
      if (init.method === "GET") return jsonResponse(payload.issue);
      return { status: 200 };
    },
  });

  assert.deepEqual(result.removed, ["status:needs-jesse", "status:legacy-value"]);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "DELETE", "DELETE"]);
  assert.match(calls[0].url, /\/repos\/jessepollak\/home\/issues\/69$/);
  assert.ok(calls.slice(1).every((call) => call.url.includes("/issues/69/labels/status%3A")));
  assert.ok(calls.every((call) => !call.url.includes("/issues/70")));
});

test("a stale close event skips deletion after the issue is reopened", async () => {
  const payload = await fixture("closed-verification-record");
  const currentIssue = structuredClone(payload.issue);
  currentIssue.state = "open";
  const calls = [];

  const result = await cleanupStatusLabelsForEvent("issues", payload, {
    repository: "jessepollak/home",
    apiUrl: "https://api.github.test",
    token: "fixture-token",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return jsonResponse(currentIssue);
    },
  });

  assert.deepEqual(result, {
    issueNumber: 69,
    labelsToRemove: [],
    reason: "current-record-open",
    removed: [],
  });
  assert.deepEqual(calls.map((call) => call.method), ["GET"]);
});

test("a stale PR close event skips deletion after the pull request is reopened", async () => {
  const payload = await fixture("merged-pr");
  const currentPullRequest = structuredClone(payload.pull_request);
  currentPullRequest.state = "open";
  currentPullRequest.merged = false;
  const calls = [];

  const result = await cleanupStatusLabelsForEvent("pull_request_target", payload, {
    repository: "jessepollak/home",
    apiUrl: "https://api.github.test",
    token: "fixture-token",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return jsonResponse(currentPullRequest);
    },
  });

  assert.deepEqual(result, {
    issueNumber: 112,
    labelsToRemove: [],
    reason: "current-record-open",
    removed: [],
  });
  assert.deepEqual(calls.map((call) => call.method), ["GET"]);
  assert.match(calls[0].url, /\/repos\/jessepollak\/home\/pulls\/112$/);
});

test("a stale converted-to-draft event skips promotion deletion after the PR is live-undrafted", async () => {
  const payload = await fixture("direct-main");
  payload.action = "converted_to_draft";
  payload.pull_request.draft = true;
  const currentPullRequest = structuredClone(payload.pull_request);
  currentPullRequest.draft = false;
  const calls = [];

  const result = await cleanupStatusLabelsForEvent("pull_request_target", payload, {
    repository: "jessepollak/home",
    apiUrl: "https://api.github.test",
    token: "fixture-token",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return jsonResponse(currentPullRequest);
    },
  });

  assert.deepEqual(result, {
    issueNumber: 112,
    labelsToRemove: [],
    reason: "direct-main",
    removed: [],
  });
  assert.deepEqual(calls.map((call) => call.method), ["GET"]);
});

test("a stale stacked event skips promotion deletion after retarget to main", async () => {
  const payload = await fixture("promoted-stacked");
  const currentPullRequest = structuredClone(payload.pull_request);
  currentPullRequest.base.ref = "main";
  currentPullRequest.labels = currentPullRequest.labels.filter((label) => label.name !== "delivery:stacked");
  const calls = [];

  const result = await cleanupStatusLabelsForEvent("pull_request_target", payload, {
    repository: "jessepollak/home",
    apiUrl: "https://api.github.test",
    token: "fixture-token",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return jsonResponse(currentPullRequest);
    },
  });

  assert.deepEqual(result, {
    issueNumber: 114,
    labelsToRemove: [],
    reason: "direct-main",
    removed: [],
  });
  assert.deepEqual(calls.map((call) => call.method), ["GET"]);
  assert.match(calls[0].url, /\/repos\/jessepollak\/home\/pulls\/114$/);
});

test("cleanup refuses non-status mutations and unsafe repositories", async () => {
  await assert.rejects(
    removeStatusLabels(
      { issueNumber: 1, labelsToRemove: ["owner:hugo"] },
      { repository: "jessepollak/home", token: "fixture-token" },
    ),
    /non-status/,
  );
  await assert.rejects(
    removeStatusLabels(
      { issueNumber: 1, labelsToRemove: ["status:working"] },
      { repository: "unsafe/repo/extra", token: "fixture-token" },
    ),
    /unsafe repository/,
  );
});
