#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  planCurrentStatusLabelChanges,
  validateMetadataEvent,
} from "./status-label-policy.mjs";

function parseRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("unsafe repository name");
  }
  return value;
}

function githubApiOptions(options) {
  const repository = parseRepository(options.repository);
  const apiUrl = new URL(options.apiUrl ?? "https://api.github.com");
  if (apiUrl.protocol !== "https:") throw new Error("GitHub API URL must use https");
  if (typeof options.token !== "string" || options.token.length === 0) throw new Error("GitHub token is required");
  return {
    repository,
    apiUrl,
    token: options.token,
    fetchImpl: options.fetchImpl ?? fetch,
  };
}

function githubHeaders(token) {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  headers.set("authorization", ["Bearer", token].join(" "));
  return headers;
}

async function fetchCurrentRecord(event, options) {
  const endpointName = event.recordKind === "pull-request" ? "pulls" : "issues";
  const endpoint = new URL(
    `/repos/${options.repository}/${endpointName}/${event.issueNumber}`,
    options.apiUrl,
  );
  const response = await options.fetchImpl(endpoint, {
    method: "GET",
    headers: githubHeaders(options.token),
  });
  if (response.status !== 200) {
    throw new Error(`GitHub current-record lookup failed with HTTP ${response.status}`);
  }
  const record = await response.json();
  if (record?.number !== event.issueNumber) throw new Error("GitHub current record number mismatch");
  return record;
}

export async function removeStatusLabels(plan, options) {
  if (!plan || !Array.isArray(plan.labelsToRemove)) throw new Error("cleanup plan is required");
  if (plan.labelsToRemove.length === 0) return [];

  const api = githubApiOptions(options);
  const removed = [];

  for (const label of plan.labelsToRemove) {
    if (!label.startsWith("status:")) throw new Error("refusing to remove a non-status label");
    const endpoint = new URL(
      `/repos/${api.repository}/issues/${plan.issueNumber}/labels/${encodeURIComponent(label)}`,
      api.apiUrl,
    );
    const response = await api.fetchImpl(endpoint, {
      method: "DELETE",
      headers: githubHeaders(api.token),
    });
    if (response.status !== 200 && response.status !== 404) {
      throw new Error(`GitHub label cleanup failed with HTTP ${response.status}`);
    }
    removed.push(label);
  }

  return removed;
}

export async function cleanupStatusLabelsForEvent(eventName, payload, options) {
  const event = validateMetadataEvent(eventName, payload);
  const api = githubApiOptions(options);
  const currentRecord = await fetchCurrentRecord(event, api);
  const plan = planCurrentStatusLabelChanges(eventName, event.action, currentRecord);
  if (plan.issueNumber !== event.issueNumber) throw new Error("cleanup plan record mismatch");
  const removed = await removeStatusLabels(plan, api);
  return { ...plan, removed };
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventName || !eventPath) throw new Error("GitHub event context is required");

  const payload = JSON.parse(await readFile(eventPath, "utf8"));
  const expectedRepository = parseRepository(process.env.GITHUB_REPOSITORY);
  if (payload.repository?.full_name !== expectedRepository) {
    throw new Error("event repository does not match GITHUB_REPOSITORY");
  }

  const result = await cleanupStatusLabelsForEvent(eventName, payload, {
    repository: expectedRepository,
    apiUrl: process.env.GITHUB_API_URL,
    token: process.env.GITHUB_TOKEN,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "status label cleanup failed");
    process.exitCode = 1;
  });
}
