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
const PENDING_DESCRIPTION = "PR destination verification is pending refresh.";

function parseRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("unsafe repository name");
  }
  return value;
}

function parseHeadSha(value, source) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw new Error(`unsafe ${source} head SHA`);
  }
  return value;
}

function parseMaxAttempts(value) {
  const maxAttempts = value ?? 4;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("unsafe reconciliation attempt count");
  }
  return maxAttempts;
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
  parseHeadSha(value.head?.sha, "pull request");
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

async function publishCommitStatus(headSha, state, description, api) {
  const endpoint = new URL(
    `/repos/${api.repository}/statuses/${headSha}`,
    api.apiUrl,
  );
  const response = await api.fetchImpl(endpoint, {
    method: "POST",
    headers: githubHeaders(api.token, true),
    body: JSON.stringify({
      context: DESTINATION_STATUS_CONTEXT,
      description,
      state,
    }),
  });
  if (response.status !== 201) {
    throw new Error(`GitHub commit-status publication failed with HTTP ${response.status}`);
  }
}

async function publishPending(headSha, api) {
  await publishCommitStatus(headSha, "pending", PENDING_DESCRIPTION, api);
}

async function publishFinalStatus(pullRequest, result, api) {
  await publishCommitStatus(
    pullRequest.head.sha,
    result.allowed ? "success" : "failure",
    statusDescription(result),
    api,
  );
}

export async function publishCurrentHeadDestinationStatus(payload, options) {
  const api = apiOptions(options);
  const identity = validateDestinationEventIdentity(payload, {
    expectedRepository: api.repository,
  });
  if (identity.repository !== api.repository) throw new Error("event repository is required");
  const eventHeadSha = parseHeadSha(payload.pull_request?.head?.sha, "event pull request");
  const maxAttempts = parseMaxAttempts(options.maxAttempts);

  let successfulHeadSha;
  try {
    await publishPending(eventHeadSha, api);

    let current = await fetchLivePullRequest(identity, api);
    if (current.head.sha !== eventHeadSha) await publishPending(current.head.sha, api);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (current.state !== "open") {
        return { allowed: false, headSha: current.head.sha, published: false, reason: "pull-request-closed" };
      }

      const result = evaluatePullRequestDestination(current);
      const confirmed = await fetchLivePullRequest(identity, api);
      if (confirmed.head.sha !== current.head.sha) await publishPending(confirmed.head.sha, api);
      if (snapshotFingerprint(confirmed) !== snapshotFingerprint(current)) {
        current = confirmed;
        continue;
      }

      await publishFinalStatus(current, result, api);
      successfulHeadSha = result.allowed ? current.head.sha : undefined;

      const afterPublication = await fetchLivePullRequest(identity, api);
      if (afterPublication.state === "closed") {
        return {
          ...result,
          context: DESTINATION_STATUS_CONTEXT,
          headSha: current.head.sha,
          published: true,
        };
      }
      if (afterPublication.head.sha !== current.head.sha) {
        await publishPending(afterPublication.head.sha, api);
      }
      if (snapshotFingerprint(afterPublication) === snapshotFingerprint(current)) {
        return {
          ...result,
          context: DESTINATION_STATUS_CONTEXT,
          headSha: current.head.sha,
          published: true,
        };
      }

      if (successfulHeadSha) {
        await publishPending(successfulHeadSha, api);
        successfulHeadSha = undefined;
      }
      current = afterPublication;
    }

    if (current.state === "open") {
      await publishFinalStatus(current, {
        allowed: false,
        message: "PR changed during destination verification; retry required.",
      }, api);
    }
    throw new Error("pull request changed repeatedly while publishing destination status");
  } catch (error) {
    if (successfulHeadSha) {
      try {
        await publishPending(successfulHeadSha, api);
      } catch {
        // The original error remains authoritative; this retry is deliberately bounded.
      }
    }
    throw error;
  }
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
