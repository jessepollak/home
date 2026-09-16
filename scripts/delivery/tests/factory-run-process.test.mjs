import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { childModelEnvironment, piInvocation, runBoundedProcess } from "../factory-run-process.mjs";
import { runDryExercise } from "../factory-run.mjs";

test("child model environments isolate config and disable GitHub credentials", () => {
  const environment = childModelEnvironment({
    PATH: process.env.PATH,
    HOME: "/source/home",
    XDG_CONFIG_HOME: "/source/config",
    GH_CONFIG_DIR: "/source/gh",
    GH_TOKEN: "secret-gh-value",
    GITHUB_TOKEN: "secret-github-value",
    GH_ENTERPRISE_TOKEN: "enterprise-secret",
    GITHUB_REPO_API_KEY: "custom-secret",
    GIT_ASKPASS: "/secret/helper",
    SSH_AUTH_SOCK: "/secret/agent",
    MODEL_SETTING: "safe",
  }, "worker", "/isolated/home");

  assert.equal(environment.GH_TOKEN, undefined);
  assert.equal(environment.GITHUB_TOKEN, undefined);
  assert.equal(environment.GH_ENTERPRISE_TOKEN, undefined);
  assert.equal(environment.GITHUB_REPO_API_KEY, undefined);
  assert.equal(environment.GIT_ASKPASS, undefined);
  assert.equal(environment.SSH_AUTH_SOCK, undefined);
  assert.equal(environment.HOME, "/isolated/home");
  assert.equal(environment.XDG_CONFIG_HOME, "/isolated/home/.config");
  assert.equal(environment.GH_CONFIG_DIR, "/isolated/home/.config/gh");
  assert.equal(environment.MODEL_SETTING, "safe");
  assert.equal(environment.FACTORY_CHILD_ROLE, "worker");
  assert.equal(environment.GIT_CONFIG_VALUE_0, "disabled://factory-child");
  assert.equal(environment.GIT_CONFIG_KEY_1, "credential.helper");
  assert.equal(environment.GIT_CONFIG_VALUE_1, "");
  assert.doesNotMatch(JSON.stringify(environment), /secret-gh-value|secret-github-value|enterprise-secret|custom-secret|secret\/helper|secret\/agent|source\/home|source\/config|source\/gh/);
});

test("bounded child receives only selected model config and its temporary home is removed", async () => {
  const sourceHome = await mkdtemp(join(tmpdir(), "factory-process-source-"));
  try {
    const agentDirectory = join(sourceHome, ".pi", "agent");
    await mkdir(agentDirectory, { recursive: true });
    await mkdir(join(sourceHome, ".config", "gh"), { recursive: true });
    await writeFile(join(agentDirectory, "settings.json"), JSON.stringify({
      defaultProvider: "selected-provider",
      defaultModel: "selected-model",
      packages: ["not-copied"],
    }));
    await writeFile(join(agentDirectory, "models.json"), JSON.stringify({
      providers: {
        "selected-provider": { apiKey: "needed-model-credential", models: [{ id: "selected-model" }] },
        "unrelated-provider": { apiKey: "unrelated-credential" },
      },
    }));
    await writeFile(join(agentDirectory, "auth.json"), JSON.stringify({
      "selected-provider": { token: "needed-auth" },
      "unrelated-provider": { token: "unrelated-auth" },
    }));
    await writeFile(join(agentDirectory, "llm-gateway-token"), "needed-gateway-token");
    await writeFile(join(sourceHome, ".config", "gh", "hosts.yml"), "github.com:\n  oauth_token: stored-github-secret\n");

    const script = `
      const fs = require("node:fs");
      const path = require("node:path");
      const dir = path.join(process.env.HOME, ".pi", "agent");
      const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      process.stdout.write(JSON.stringify({
        home: process.env.HOME,
        settings: read("settings.json"),
        providers: Object.keys(read("models.json").providers),
        auth: Object.keys(read("auth.json")),
        gatewayConfigured: fs.existsSync(path.join(dir, "llm-gateway-token")),
        ghAuthExists: fs.existsSync(path.join(process.env.GH_CONFIG_DIR, "hosts.yml")),
      }));
    `;
    const result = await runBoundedProcess({
      command: process.execPath,
      args: ["-e", script],
      cwd: process.cwd(),
      environment: { PATH: process.env.PATH, HOME: sourceHome },
      role: "worker",
      timeoutMs: 5_000,
    });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.providers, ["selected-provider"]);
    assert.deepEqual(output.auth, ["selected-provider"]);
    assert.deepEqual(output.settings, {
      defaultProvider: "selected-provider",
      defaultModel: "selected-model",
      quietStartup: true,
    });
    assert.equal(output.gatewayConfigured, true);
    assert.equal(output.ghAuthExists, false);
    await assert.rejects(access(output.home), { code: "ENOENT" });
  } finally {
    await rm(sourceHome, { recursive: true, force: true });
  }
});

test("gh cannot read stored authentication from the parent home", async () => {
  const sourceHome = await mkdtemp(join(tmpdir(), "factory-process-gh-source-"));
  try {
    await mkdir(join(sourceHome, ".config", "gh"), { recursive: true });
    await writeFile(join(sourceHome, ".config", "gh", "hosts.yml"), "github.com:\n  oauth_token: stored-github-secret\n");
    const result = await runBoundedProcess({
      command: "gh",
      args: ["auth", "token", "--hostname", "github.com"],
      cwd: process.cwd(),
      environment: { PATH: process.env.PATH, HOME: sourceHome },
      role: "reviewer",
      timeoutMs: 5_000,
    });
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /stored-github-secret/);
  } finally {
    await rm(sourceHome, { recursive: true, force: true });
  }
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

test("bounded processes terminate descendant process groups on timeout", async () => {
  const script = `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: ["ignore", process.stdout, process.stderr],
    });
  `;
  const startedAt = Date.now();
  const result = await runBoundedProcess({
    command: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    environment: { PATH: process.env.PATH },
    role: "reviewer",
    timeoutMs: 50,
  });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - startedAt < 2_000);
});
