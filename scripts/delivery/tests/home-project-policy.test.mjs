import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deriveDeliveryStatus,
  deriveHierarchy,
  mergeCandidateIssues,
  planFieldChanges,
} from "../home-project-policy.mjs";

const config = JSON.parse(await readFile(new URL("../home-project-config.json", import.meta.url), "utf8"));

for (const [label, expected] of Object.entries({
  "status:todo": "Todo",
  "status:working": "Working",
  "status:ready-for-review": "Independent review",
  "status:needs-jesse": "Needs Jesse",
  "status:blocked": "Blocked",
})) {
  test(`maps open ${label}`, () => {
    assert.equal(deriveDeliveryStatus({ state: "OPEN", labels: [{ name: label }] }), expected);
  });
}

test("malformed open status labels need triage", () => {
  for (const labels of [[], ["status:unknown"], ["status:todo", "status:working"], ["status:todo", "status:unknown"]]) {
    assert.equal(deriveDeliveryStatus({ state: "OPEN", labels }), "Needs triage");
  }
});

test("closed reason wins over labels", () => {
  assert.equal(deriveDeliveryStatus({ state: "CLOSED", stateReason: "COMPLETED", labels: ["status:blocked"] }), "Done");
  assert.equal(deriveDeliveryStatus({ state: "CLOSED", stateReason: "NOT_PLANNED", labels: ["status:todo"] }), "Not planned");
  assert.equal(deriveDeliveryStatus({ state: "CLOSED", stateReason: "duplicate" }), "Not planned");
  assert.equal(deriveDeliveryStatus({ state: "CLOSED", stateReason: null }), "Needs triage");
  assert.equal(deriveDeliveryStatus({ state: "CLOSED", stateReason: "REOPENED" }), "Needs triage");
});

test("root maps to itself and descendants use the nearest indexed ancestor", () => {
  const money = config.roots.find((root) => root.number === 565);
  const invest = config.roots.find((root) => root.number === 567);
  assert.deepEqual(deriveHierarchy(money, [], config), { level: "Workstream", workstream: "Money in/out" });
  const child = { id: "child", number: 1 };
  assert.deepEqual(deriveHierarchy(child, [{ id: "program", number: 15 }, invest, money], config), {
    level: "Delivery",
    workstream: "Invest",
  });
  assert.deepEqual(deriveHierarchy(child, [{ id: "program", number: 15 }], config), {
    level: "Delivery",
    workstream: null,
  });
});

test("cycles and excessive ancestry fail closed", () => {
  const issue = { id: "child", number: 1 };
  assert.throws(() => deriveHierarchy(issue, [{ id: "child" }], config), /cycle/);
  assert.throws(() => deriveHierarchy(issue, Array.from({ length: 101 }, (_, index) => ({ id: `p${index}` })), config), /depth/);
});

test("field planning is idempotent and clears only stale unclassified Workstream", () => {
  const desired = { deliveryStatus: "Working", workstream: null, level: "Delivery" };
  const current = {
    deliveryStatus: config.fields.deliveryStatus.options.Working,
    workstream: config.fields.workstream.options.Invest,
    level: config.fields.level.options.Delivery,
  };
  assert.deepEqual(planFieldChanges(current, desired, config), [{
    action: "clear",
    key: "workstream",
    fieldId: config.fields.workstream.id,
  }]);
  assert.deepEqual(planFieldChanges({ ...current, workstream: null }, desired, config), []);
});

test("candidate union de-duplicates and forces roots while skipping non-Issues", () => {
  const issues = mergeCandidateIssues([
    [{ __typename: "Issue", id: "a", number: 2 }, { __typename: "PullRequest", id: "pr", number: 1 }],
    [{ __typename: "Issue", id: "a", number: 2 }, { __typename: "Issue", id: "b", number: 1 }],
  ], config.roots);
  assert.equal(issues.length, 10);
  assert.deepEqual(issues.slice(0, 2).map((issue) => issue.id), ["b", "a"]);
  assert.equal(issues.some((issue) => issue.id === "pr"), false);
});
