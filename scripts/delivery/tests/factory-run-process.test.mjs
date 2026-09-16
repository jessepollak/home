import assert from "node:assert/strict";
import test from "node:test";

import { childModelEnvironment, piInvocation, runBoundedProcess } from "../factory-run-process.mjs";
import { runDryExercise } from "../factory-run.mjs";

test("child model environments omit GitHub credentials without logging values", () => {
  const environment = childModelEnvironment({
    PATH: process.env.PATH,
    GH_TOKEN: "secret-gh-value",
    GITHUB_TOKEN: "secret-github-value",
    GH_ENTERPRISE_TOKEN: "enterprise-secret",
    GITHUB_REPO_API_KEY: "custom-secret",
    GIT_ASKPASS: "/secret/helper",
    MODEL_SETTING: "safe",
  }, "worker");

  assert.equal(environment.GH_TOKEN, undefined);
  assert.equal(environment.GITHUB_TOKEN, undefined);
  assert.equal(environment.GH_ENTERPRISE_TOKEN, undefined);
  assert.equal(environment.GITHUB_REPO_API_KEY, undefined);
  assert.equal(environment.GIT_ASKPASS, undefined);
  assert.equal(environment.MODEL_SETTING, "safe");
  assert.equal(environment.FACTORY_CHILD_ROLE, "worker");
  assert.equal(environment.GIT_CONFIG_VALUE_0, "disabled://factory-child");
  assert.doesNotMatch(JSON.stringify(environment), /secret-gh-value|secret-github-value|enterprise-secret|custom-secret|secret\/helper/);
});

test("Pi invocations are ephemeral and reviewer tools are read-only", () => {
  const worker = piInvocation("worker", "work");
  const reviewer = piInvocation("reviewer", "review");
  assert.ok(worker.args.includes("--no-session"));
  assert.ok(reviewer.args.includes("--no-session"));
  assert.equal(reviewer.args[reviewer.args.indexOf("--tools") + 1], "read,grep,find,ls");
  assert.notEqual(worker.args[worker.args.indexOf("--tools") + 1], reviewer.args[reviewer.args.indexOf("--tools") + 1]);
});

test("dry-run uses distinct bounded child processes for worker and reviewer", async () => {
  const result = await runDryExercise(546, { environment: { PATH: process.env.PATH, GH_TOKEN: "not-forwarded" } });
  assert.equal(result.outcome, "dry-run-passed");
  assert.deepEqual(result.children.map((child) => child.role), ["worker", "reviewer"]);
  assert.equal(new Set(result.children.map((child) => child.pid)).size, 2);
});

test("bounded processes time out and do not count as completion", async () => {
  const result = await runBoundedProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    cwd: process.cwd(),
    environment: { PATH: process.env.PATH },
    role: "reviewer",
    timeoutMs: 20,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
});
