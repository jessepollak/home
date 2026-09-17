import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  childModelEnvironment,
  factoryChildModelAgent,
  parseModelSelector,
  piInvocation,
  resolveChildModelSelection,
  runBoundedProcess,
} from "../factory-run-process.mjs";
import { runDryExercise } from "../factory-run.mjs";

const INSTALLED_SETTINGS = {
  defaultProvider: "cbhq-openai",
  defaultModel: "gpt-5.6-sol",
  subagents: {
    agentOverrides: {
      "routine-worker": { model: "cbhq-deepseek/deepseek-v4.1-flash" },
      worker: { model: "cbhq-openai/gpt-5.6-sol" },
      reviewer: { model: "cbhq-deepseek/deepseek-v4.1-flash" },
    },
  },
};

test("factory lanes escalate from the routine worker to the Sol worker on the second repair", () => {
  assert.equal(factoryChildModelAgent("worker", 0), "routine-worker");
  assert.equal(factoryChildModelAgent("worker", 1), "routine-worker");
  assert.equal(factoryChildModelAgent("worker", 2), "worker");
  assert.equal(factoryChildModelAgent("worker", 7), "worker");
  assert.equal(factoryChildModelAgent("reviewer"), "reviewer");
  assert.equal(factoryChildModelAgent("reviewer", 2), "reviewer");
  assert.throws(() => factoryChildModelAgent("planner", 0), /role is unsupported/);
  assert.throws(() => factoryChildModelAgent("worker", -1), /remediation number/);
  assert.throws(() => factoryChildModelAgent("worker", 1.5), /remediation number/);
});

test("every factory lane resolves its installed agent model override", () => {
  for (const [role, remediationNumber, lane, expected] of [
    ["worker", 0, "routine-worker", { provider: "cbhq-deepseek", model: "deepseek-v4.1-flash" }],
    ["worker", 1, "routine-worker", { provider: "cbhq-deepseek", model: "deepseek-v4.1-flash" }],
    ["worker", 2, "worker", { provider: "cbhq-openai", model: "gpt-5.6-sol" }],
    ["reviewer", 0, "reviewer", { provider: "cbhq-deepseek", model: "deepseek-v4.1-flash" }],
  ]) {
    const modelAgent = factoryChildModelAgent(role, remediationNumber);
    assert.equal(modelAgent, lane);
    assert.deepEqual(resolveChildModelSelection({ PATH: process.env.PATH }, INSTALLED_SETTINGS, modelAgent), expected);
  }
  assert.deepEqual(
    resolveChildModelSelection({}, { defaultProvider: "fallback-provider", defaultModel: "fallback-model" }, "routine-worker"),
    { provider: "fallback-provider", model: "fallback-model" },
  );
});

test("explicit PI_PROVIDER and PI_MODEL overrides keep winning over lane routing", () => {
  assert.deepEqual(
    resolveChildModelSelection({ PI_PROVIDER: "explicit-provider", PI_MODEL: "explicit-model" }, INSTALLED_SETTINGS, "routine-worker"),
    { provider: "explicit-provider", model: "explicit-model" },
  );
  for (const modelAgent of ["routine-worker", "worker", "reviewer"]) {
    assert.deepEqual(resolveChildModelSelection({ PI_MODEL: "explicit-model" }, INSTALLED_SETTINGS, modelAgent), {
      provider: "cbhq-openai",
      model: "explicit-model",
    });
    assert.deepEqual(resolveChildModelSelection({ PI_PROVIDER: "explicit-provider" }, INSTALLED_SETTINGS, modelAgent), {
      provider: "explicit-provider",
      model: "gpt-5.6-sol",
    });
  }
});

test("malformed installed model selectors fail closed", () => {
  assert.deepEqual(parseModelSelector(" cbhq-deepseek/deepseek-v4.1-flash "), {
    provider: "cbhq-deepseek",
    model: "deepseek-v4.1-flash",
  });
  assert.equal(parseModelSelector(undefined), undefined);
  assert.equal(parseModelSelector(null), undefined);
  for (const malformed of ["deepseek-v4.1-flash", "cbhq-deepseek/", "/deepseek-v4.1-flash", "cbhq/a/b", "cbhq-deepseek /deepseek", 7, {}, ""]) {
    assert.throws(() => parseModelSelector(malformed), /provider\/model/);
  }
  const malformedSettings = { subagents: { agentOverrides: { reviewer: { model: "deepseek-v4.1-flash" } } } };
  assert.throws(() => resolveChildModelSelection({}, malformedSettings, "reviewer"), /provider\/model/);
});

test("isolated child settings use only the lane model and its provider credentials", async () => {
  const sourceHome = await mkdtemp(join(tmpdir(), "factory-process-lane-"));
  try {
    const agentDirectory = join(sourceHome, ".pi", "agent");
    await mkdir(agentDirectory, { recursive: true });
    await writeFile(join(agentDirectory, "settings.json"), JSON.stringify(INSTALLED_SETTINGS));
    await writeFile(join(agentDirectory, "models.json"), JSON.stringify({
      providers: {
        "cbhq-deepseek": { apiKey: "deepseek-credential", models: [{ id: "deepseek-v4.1-flash" }] },
        "cbhq-openai": { apiKey: "openai-credential", models: [{ id: "gpt-5.6-sol" }] },
      },
    }));
    await writeFile(join(agentDirectory, "auth.json"), JSON.stringify({
      "cbhq-deepseek": { token: "deepseek-auth" },
      "cbhq-openai": { token: "openai-auth" },
    }));
    const script = `
      const fs = require("node:fs");
      const path = require("node:path");
      const dir = path.join(process.env.HOME, ".pi", "agent");
      const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      process.stdout.write(JSON.stringify({
        settings: read("settings.json"),
        providers: Object.keys(read("models.json").providers),
        auth: Object.keys(read("auth.json")),
      }));
    `;
    const observations = {};
    for (const [role, remediationNumber] of [["worker", 0], ["worker", 2], ["reviewer", 0]]) {
      const result = await runBoundedProcess({
        command: process.execPath,
        args: ["-e", script],
        cwd: process.cwd(),
        environment: { PATH: process.env.PATH, HOME: sourceHome },
        role,
        modelAgent: factoryChildModelAgent(role, remediationNumber),
        timeoutMs: 5_000,
      });
      assert.equal(result.code, 0);
      observations[`${role}:${remediationNumber}`] = JSON.parse(result.stdout);
    }
    const initialLane = { defaultProvider: "cbhq-deepseek", defaultModel: "deepseek-v4.1-flash", quietStartup: true };
    assert.deepEqual(observations["worker:0"].settings, initialLane);
    assert.deepEqual(observations["worker:0"].providers, ["cbhq-deepseek"]);
    assert.deepEqual(observations["worker:0"].auth, ["cbhq-deepseek"]);
    assert.deepEqual(observations["worker:2"].settings, {
      defaultProvider: "cbhq-openai", defaultModel: "gpt-5.6-sol", quietStartup: true,
    });
    assert.deepEqual(observations["worker:2"].providers, ["cbhq-openai"]);
    assert.deepEqual(observations["worker:2"].auth, ["cbhq-openai"]);
    assert.deepEqual(observations["reviewer:0"].settings, initialLane);
    assert.deepEqual(observations["reviewer:0"].providers, ["cbhq-deepseek"]);
  } finally {
    await rm(sourceHome, { recursive: true, force: true });
  }
});

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
