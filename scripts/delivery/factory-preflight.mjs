#!/usr/bin/env node

import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EXPECTED_REPOSITORY = "jessepollak/home";
const FACTORY_BRANCH = /^agent\/[A-Za-z0-9._/-]+$/;
const ENV_FILE_PATHS = [".env.local", "apps/web/.env.local"];
const ALLOWED_GITHUB_CREDENTIALS = new Set(["GH_TOKEN", "GITHUB_TOKEN"]);
const PROHIBITED_ENV_NAMES = new Set([
  "DATABASE_URL",
  "ACTION_PG_TEST_URL",
  "BALANCES_PG_TEST_URL",
  "FUNDING_PG_TEST_URL",
  "PGPASSWORD",
  "POSTGRES_PASSWORD",
  "VERCEL_TOKEN",
  "VERCEL_ACCESS_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
]);
const PROHIBITED_ENV_PATTERNS = [
  /^(?:NEXT_PUBLIC_)?CDP_/,
  /^(?:[A-Z0-9]+_)*(?:ONRAMP|OFFRAMP)_/,
  /^CODEX_/,
  /^IDRX_/,
  /^RIPIO_/,
  /^PEER_/,
  /^FUNDING_/,
  /^BASE_(?:RPC|ACCOUNT_STATUS_RPC)_URL$/,
  /^HOME_WEBHOOK_ORIGIN$/,
  /^VERCEL_.*(?:TOKEN|SECRET|KEY|CREDENTIAL|PROJECT|ORG)/,
  /^(?:NEON|POSTGRES|PG).*?(?:URL|TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL)$/,
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_KEY|CREDENTIALS?)(?:_|$)/,
];

function normalizeRepository(remote) {
  const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? null;
}

export function prohibitedEnvironmentNames(environment) {
  return Object.keys(environment)
    .filter((name) => !ALLOWED_GITHUB_CREDENTIALS.has(name))
    .filter(
      (name) =>
        PROHIBITED_ENV_NAMES.has(name) ||
        PROHIBITED_ENV_PATTERNS.some((pattern) => pattern.test(name)),
    )
    .sort();
}

export function evaluateFactoryPreflight({ remote, branch, envFilePaths = [], environment = {} }) {
  const failures = [];
  const repository = typeof remote === "string" ? normalizeRepository(remote) : null;

  if (repository !== EXPECTED_REPOSITORY) failures.push("origin is not the pinned repository");
  if (typeof branch !== "string" || !FACTORY_BRANCH.test(branch) || branch.includes("..")) {
    failures.push("branch must match agent/*");
  }
  if (envFilePaths.length > 0) failures.push(`local environment file present: ${envFilePaths.join(", ")}`);

  const prohibitedNames = prohibitedEnvironmentNames(environment);
  if (prohibitedNames.length > 0) {
    failures.push(`prohibited environment variables present: ${prohibitedNames.join(", ")}`);
  }

  return { allowed: failures.length === 0, failures };
}

async function existingEnvFiles() {
  const results = await Promise.all(
    ENV_FILE_PATHS.map(async (path) => {
      try {
        await access(path, constants.F_OK);
        return path;
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    }),
  );
  return results.filter(Boolean);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export async function runFactoryPreflight() {
  let remote;
  let branch;
  try {
    remote = git("remote", "get-url", "origin");
    branch = git("branch", "--show-current");
  } catch {
    console.error("Factory preflight failed: repository metadata is unavailable.");
    return 1;
  }

  const result = evaluateFactoryPreflight({
    remote,
    branch,
    envFilePaths: await existingEnvFiles(),
    environment: process.env,
  });

  if (!result.allowed) {
    for (const failure of result.failures) console.error(`Factory preflight failed: ${failure}.`);
    return 1;
  }

  console.log("Factory preflight passed.");
  return 0;
}

let isDirectExecution = false;
try {
  const [modulePath, invocationPath] = await Promise.all([
    realpath(fileURLToPath(import.meta.url)),
    realpath(process.argv[1]),
  ]);
  isDirectExecution = modulePath === invocationPath;
} catch {
  console.error("Factory preflight failed: invocation path is unavailable.");
  process.exitCode = 1;
}

if (isDirectExecution) {
  process.exitCode = await runFactoryPreflight();
}
