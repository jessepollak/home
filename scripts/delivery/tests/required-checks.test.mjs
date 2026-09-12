import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoFile = (relativePath) =>
  readFileSync(fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url)), "utf8");

const workflow = repoFile(".github/workflows/ci.yml");
const gates = repoFile("docs/delivery-gates.md");

// No YAML parser is available under `node --test`, so job display names are read
// by indentation. Job keys sit at two spaces and their `name:` at four; every
// step `name:` is a list item at six or more, so an exact four-space prefix
// cannot match one.
function workflowJobNames(source) {
  const names = [];
  for (const line of source.split("\n")) {
    const match = /^ {4}name: (.+)$/.exec(line);
    if (match) names.push(match[1].trim());
  }
  return names;
}

// Reads the backticked bullet list that follows `anchor`, stopping at the first
// line that is not a bullet.
function documentedChecks(source, anchor) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.includes(anchor));
  assert.notEqual(start, -1, `delivery-gates.md no longer contains: ${anchor}`);
  const names = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s*- `([^`]+)`\s*$/.exec(line);
    if (!match) {
      if (line.trim() === "") continue;
      break;
    }
    names.push(match[1]);
  }
  return names;
}

// The commit status published by pr-destination.yml. Not an Actions job, so it
// is required by branch protection but never appears in ci.yml.
const DESTINATION_STATUS = "delivery/pr-destination";

test("every CI job is documented as a check, and every documented check is a real job", () => {
  const jobs = workflowJobNames(workflow);
  assert.ok(jobs.length > 0, "found no job names in ci.yml; the indentation rule needs updating");

  const documented = documentedChecks(gates, "Pull requests run these untrusted-code checks");

  assert.deepEqual(
    [...documented].sort(),
    [...jobs].sort(),
    "docs/delivery-gates.md and .github/workflows/ci.yml disagree about the check names. " +
      "A required check whose name matches no job never reports, so branch protection " +
      "either blocks every merge or silently protects nothing.",
  );
});

test("the branch-protection list is the CI jobs plus the destination commit status", () => {
  const expected = [...workflowJobNames(workflow), DESTINATION_STATUS].sort();
  const required = documentedChecks(gates, "Require these exact checks");

  assert.deepEqual(
    [...required].sort(),
    expected,
    `the rollout list in docs/delivery-gates.md must name every ci.yml job plus ${DESTINATION_STATUS}`,
  );
});
