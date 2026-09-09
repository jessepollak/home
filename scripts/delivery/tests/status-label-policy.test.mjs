import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { removeStatusLabels } from "../cleanup-status-labels.mjs";
import { planStatusLabelChanges } from "../status-label-policy.mjs";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
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

test("GitHub mutation uses only DELETE label calls for the current record", async () => {
  const payload = await fixture("closed-verification-record");
  const plan = planStatusLabelChanges("issues", payload);
  const calls = [];
  const removed = await removeStatusLabels(plan, {
    repository: "jessepollak/home",
    apiUrl: "https://api.github.test",
    token: "fixture-token",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers });
      return { status: 200 };
    },
  });

  assert.deepEqual(removed, ["status:needs-jesse", "status:legacy-value"]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.method === "DELETE"));
  assert.ok(calls.every((call) => call.url.includes("/issues/69/labels/status%3A")));
  assert.ok(calls.every((call) => !call.url.includes("/issues/70")));
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
