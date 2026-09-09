#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateDestinationEventIdentity,
} from "./check-pr-destination.mjs";
import {
  evaluatePullRequestDestination,
  pullRequestLabels,
} from "./destination-policy.mjs";

export const DESTINATION_STATUS_CONTEXT = "delivery/pr-destination";
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function parseRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("unsafe repository name");
  }
  return value;
}

function githubHeaders(token, hasBody = false) {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  if (hasBody) headers.set("content-type", "application/json");
  headers.set("authorization", ["Bearer", token].join(" "));
  return headers;
}

function apiOptions(options) {
  const repository = parseRepository(options.repository);
  const apiUrl = new URL(options.apiUrl ?? "https://api.github.com");
  if (apiUrl.protocol !== "https:") throw new Error("GitHub API URL must use https");
  if (typeof options.token !== "string" || options.token.length === 0) throw new Error("GitHub token is required");
  return {
    apiUrl,
    fetchImpl: options.fetchImpl ?? fetch,
    repository,
    token: options.token,
  };
}

function normalizeLivePullRequest(value, expected) {
  if (!value || typeof value !== "object") throw new Error("GitHub pull request response is required");
  if (value.number !== expected.pullRequestNumber) throw new Error("GitHub pull request number mismatch");
  if (value.base?.repo?.full_name !== expected.repository) throw new Error("GitHub pull request repository mismatch");
  if (value.state !== "open" && value.state !== "closed") throw new Error("unsafe pull request state");
  if (typeof value.head?.sha !== "string" || !SHA_PATTERN.test(value.head.sha)) {
    throw new Error("unsafe pull request head SHA");
  }
  pullRequestLabels(value);
  evaluatePullRequestDestination(value);
  return value;
}

async function fetchLivePullRequest(identity, api) {
  const endpoint = new URL(
    `/repos/${api.repository}/pulls/${identity.pullRequestNumber}`,
    api.apiUrl,
  );
  const response = await api.fetchImpl(endpoint, {
    method: "GET",
    headers: githubHeaders(api.token),
  });
  if (response.status !== 200) {
    throw new Error(`GitHub pull request lookup failed with HTTP ${response.status}`);
  }
  return normalizeLivePullRequest(await response.json(), identity);
}

function snapshotFingerprint(pullRequest) {
  return JSON.stringify({
    baseRef: pullRequest.base.ref,
    headSha: pullRequest.head.sha,
    labels: [...pullRequestLabels(pullRequest)].sort(),
    number: pullRequest.number,
    state: pullRequest.state,
  });
}

function statusDescription(result) {
  if (result.allowed && result.mode === "main") {
    return "Direct-to-main destination verified on the current PR head.";
  }
  if (result.allowed && result.mode === "stacked") {
    return "Reviewed stacked destination verified as intermediate work.";
  }
  return result.message.slice(0, 140);
}

async function publishStatus(pullRequest, result, api) {
  const endpoint = new URL(
    `/repos/${api.repository}/statuses/${pullRequest.head.sha}`,
    api.apiUrl,
  );
  const response = await api.fetchImpl(endpoint, {
    method: "POST",
    headers: githubHeaders(api.token, true),
    body: JSON.stringify({
      context: DESTINATION_STATUS_CONTEXT,
      description: statusDescription(result),
      state: result.allowed ? "success" : "failure",
    }),
  });
  if (response.status !== 201) {
    throw new Error(`GitHub commit-status publication failed with HTTP ${response.status}`);
  }
}

export async function publishCurrentHeadDestinationStatus(payload, options) {
  const api = apiOptions(options);
  const identity = validateDestinationEventIdentity(payload, {
    expectedRepository: api.repository,
  });
  if (identity.repository !== api.repository) throw new Error("event repository is required");

  let current = await fetchLivePullRequest(identity, api);
  const maxAttempts = options.maxAttempts ?? 4;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("unsafe reconciliation attempt count");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (current.state !== "open") {
      return { allowed: false, headSha: current.head.sha, published: false, reason: "pull-request-closed" };
    }

    const result = evaluatePullRequestDestination(current);
    const confirmed = await fetchLivePullRequest(identity, api);
    if (snapshotFingerprint(confirmed) !== snapshotFingerprint(current)) {
      current = confirmed;
      continue;
    }

    await publishStatus(current, result, api);
    const afterPublication = await fetchLivePullRequest(identity, api);
    if (afterPublication.state === "closed" || snapshotFingerprint(afterPublication) === snapshotFingerprint(current)) {
      return {
        ...result,
        context: DESTINATION_STATUS_CONTEXT,
        headSha: current.head.sha,
        published: true,
      };
    }
    current = afterPublication;
  }

  throw new Error("pull request changed repeatedly while publishing destination status");
}

async function main() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request_target") {
    throw new Error("destination status only accepts pull_request_target events");
  }
  if (!process.env.GITHUB_EVENT_PATH) throw new Error("event path is required");

  const payload = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const result = await publishCurrentHeadDestinationStatus(payload, {
    repository: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL,
    token: process.env.GITHUB_TOKEN,
  });
  console.log(JSON.stringify(result));
  if (result.published && !result.allowed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "destination status publication failed");
    process.exitCode = 1;
  });
}
