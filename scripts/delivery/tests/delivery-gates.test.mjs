import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function requiredCheckNames(deliveryGates) {
  return [...deliveryGates.matchAll(/^- `([^`]+)`(?:\s|$)/gm)].map((match) => match[1]);
}

function workflowJobNames(workflow) {
  return [...workflow.matchAll(/^ {4}name:\s*(.+?)\s*$/gm)].map((match) => match[1]);
}

test("documented required checks match CI job names", async () => {
  const [deliveryGates, workflow] = await Promise.all([
    readFile(new URL("../../../docs/delivery-gates.md", import.meta.url), "utf8"),
    readFile(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ]);
  const requiredChecks = requiredCheckNames(deliveryGates);
  const ciJobs = workflowJobNames(workflow);

  assert.ok(requiredChecks.length > 0, "docs/delivery-gates.md must name its required checks in backticks");
  assert.deepEqual(
    requiredChecks.filter((name) => !ciJobs.includes(name)),
    [],
    `documented required checks must exactly match four-space-indented CI job names; available jobs: ${ciJobs.join(", ")}`,
  );
});
