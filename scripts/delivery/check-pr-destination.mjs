#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluatePullRequestDestination } from "./destination-policy.mjs";

const ALLOWED_ACTIONS = new Set([
  "opened",
  "reopened",
  "synchronize",
  "edited",
  "labeled",
  "unlabeled",
  "converted_to_draft",
  "ready_for_review",
]);

export function validateDestinationEventIdentity(payload, options = {}) {
  if (!payload || typeof payload !== "object") throw new Error("event payload is required");
  if (!ALLOWED_ACTIONS.has(payload.action)) throw new Error("unsupported pull request action");
  if (!payload.pull_request) throw new Error("pull request payload is required");

  const expectedRepository = options.expectedRepository;
  const repository = payload.repository?.full_name;
  if (expectedRepository && repository !== expectedRepository) {
    throw new Error("event repository does not match GITHUB_REPOSITORY");
  }
  if (!Number.isSafeInteger(payload.pull_request.number) || payload.pull_request.number < 1) {
    throw new Error("unsafe pull request number");
  }

  return { repository, pullRequestNumber: payload.pull_request.number };
}

export function validateDestinationEvent(payload, options = {}) {
  validateDestinationEventIdentity(payload, options);
  return evaluatePullRequestDestination(payload.pull_request);
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME ?? "pull_request_target";
  if (eventName !== "pull_request_target") throw new Error("destination check only accepts pull_request_target events");

  const eventPath = process.argv[2] ?? process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("event path is required");
  const payload = JSON.parse(await readFile(eventPath, "utf8"));
  const result = validateDestinationEvent(payload, {
    expectedRepository: process.env.GITHUB_REPOSITORY,
  });

  console.log(result.message);
  if (!result.allowed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "destination check failed");
    process.exitCode = 1;
  });
}
