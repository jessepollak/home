import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateFactoryPreflight,
  prohibitedEnvironmentNames,
} from "../factory-preflight.mjs";

const PREFLIGHT_PATH = fileURLToPath(new URL("../factory-preflight.mjs", import.meta.url));

const SAFE_INPUT = {
  remote: "https://github.com/jessepollak/home.git",
  branch: "agent/factory-candidate",
  envFilePaths: [],
  environment: { GITHUB_TOKEN: "allowed-repo-scoped-credential" },
};

test("allows only the pinned repository, agent branch, and GitHub credential", () => {
  assert.deepEqual(evaluateFactoryPreflight(SAFE_INPUT), { allowed: true, failures: [] });
  assert.equal(
    evaluateFactoryPreflight({ ...SAFE_INPUT, remote: "git@github.com:jessepollak/home.git" }).allowed,
    true,
  );
});

test("fails closed for the wrong repository or branch", () => {
  for (const input of [
    { ...SAFE_INPUT, remote: "https://github.com/other/home.git" },
    { ...SAFE_INPUT, branch: "main" },
    { ...SAFE_INPUT, branch: "agent/../main" },
    { ...SAFE_INPUT, branch: "" },
  ]) {
    assert.equal(evaluateFactoryPreflight(input).allowed, false);
  }
});

test("runs checks when invoked through a symlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory-preflight-"));
  const symlinkPath = join(directory, "factory-preflight.mjs");

  try {
    await symlink(PREFLIGHT_PATH, symlinkPath);
    const result = spawnSync(process.execPath, [symlinkPath], {
      cwd: directory,
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Factory preflight failed: repository metadata is unavailable\./);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects local environment files by existence without needing contents", () => {
  const result = evaluateFactoryPreflight({
    ...SAFE_INPUT,
    envFilePaths: ["apps/web/.env.local"],
  });
  assert.equal(result.allowed, false);
  assert.match(result.failures.join("\n"), /local environment file present/);
});

test("rejects provider, database, production, and Vercel authority variables", () => {
  const prohibited = [
    "CDP_API_KEY_PRIVATE_KEY",
    "NEXT_PUBLIC_CDP_PROJECT_ID",
    "PROVIDER_ONRAMP_MODE",
    "CODEX_API_KEY",
    "BASE_RPC_URL",
    "FUNDING_QUOTE_SECRET",
    "RIPIO_CLIENT_SECRET_AR",
    "DATABASE_URL",
    "NEON_API_TOKEN",
    "PGPASSWORD",
    "VERCEL_TOKEN",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
    "VERCEL_PROJECT_ID",
    "AWS_ACCESS_KEY_ID",
    "PRODUCTION_API_KEY",
  ];

  assert.deepEqual(
    prohibitedEnvironmentNames(Object.fromEntries(prohibited.map((name) => [name, "sensitive-value"]))),
    [...prohibited].sort(),
  );
  assert.equal(
    evaluateFactoryPreflight({
      ...SAFE_INPUT,
      environment: Object.fromEntries(prohibited.map((name) => [name, "sensitive-value"])),
    }).allowed,
    false,
  );
});

test("reports prohibited names without exposing values", () => {
  const sensitiveValue = "must-not-appear-in-output";
  const result = evaluateFactoryPreflight({
    ...SAFE_INPUT,
    environment: { VERCEL_TOKEN: sensitiveValue },
  });

  const output = result.failures.join("\n");
  assert.match(output, /VERCEL_TOKEN/);
  assert.doesNotMatch(output, new RegExp(sensitiveValue));
});
