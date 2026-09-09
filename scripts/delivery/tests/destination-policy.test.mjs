import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluatePullRequestDestination,
} from "../destination-policy.mjs";
import { validateDestinationEvent } from "../check-pr-destination.mjs";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

test("allows a direct main destination", async () => {
  const payload = await fixture("direct-main");
  assert.deepEqual(validateDestinationEvent(payload, { expectedRepository: "jessepollak/home" }), {
    allowed: true,
    mode: "main",
    baseRef: "main",
    promotionLabels: ["status:ready-for-review"],
    message: "Pull request targets main.",
  });
});

test("rejects an unintended non-main destination", async () => {
  const payload = await fixture("unintended-non-main");
  const result = validateDestinationEvent(payload, { expectedRepository: "jessepollak/home" });
  assert.equal(result.allowed, false);
  assert.equal(result.mode, "invalid");
  assert.match(result.message, /retarget it to main/);
});

test("allows an explicitly labeled stack without claiming main delivery", async () => {
  const payload = await fixture("allowed-stacked");
  const result = validateDestinationEvent(payload, { expectedRepository: "jessepollak/home" });
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "stacked");
  assert.match(result.message, /not delivered to main/);
});

test("rejects delivery promotion labels on a stack", async () => {
  const payload = await fixture("promoted-stacked");
  const result = validateDestinationEvent(payload, { expectedRepository: "jessepollak/home" });
  assert.equal(result.allowed, false);
  assert.deepEqual(result.promotionLabels, ["status:needs-jesse"]);
});

test("requires the stack marker to be removed after retargeting to main", async () => {
  const payload = await fixture("allowed-stacked");
  payload.pull_request.base.ref = "main";
  const result = evaluatePullRequestDestination(payload.pull_request);
  assert.equal(result.allowed, false);
  assert.match(result.message, /Remove delivery:stacked/);
});

test("rejects unsafe branch and repository input", async () => {
  const payload = await fixture("unintended-non-main");
  payload.pull_request.base.ref = "feature/safe\n::error::injected";
  assert.throws(() => validateDestinationEvent(payload), /unsafe base ref/);

  const direct = await fixture("direct-main");
  assert.throws(
    () => validateDestinationEvent(direct, { expectedRepository: "other/repository" }),
    /does not match/,
  );
});
