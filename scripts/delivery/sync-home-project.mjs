#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  addProjectItem,
  applyFieldChanges,
  createProjectGitHub,
  currentDerivedValues,
  listMilestoneClosedIssues,
  listOpenIssues,
  listProjectItems,
  readAndValidateSchema,
  readCurrentIssue,
  readParent,
} from "./home-project-github.mjs";
import {
  desiredFields,
  indexRoots,
  mergeCandidateIssues,
  planFieldChanges,
} from "./home-project-policy.mjs";

const CONFIG_PATH = new URL("./home-project-config.json", import.meta.url);

export async function loadHomeProjectConfig(path = CONFIG_PATH) {
  const config = JSON.parse(await readFile(path, "utf8"));
  if (config.repository?.nameWithOwner !== "jessepollak/home") throw new Error("unsafe Home Project repository");
  indexRoots(config);
  return config;
}

function assertIssueShape(issue, context) {
  if (!issue || typeof issue.id !== "string" || !Number.isSafeInteger(issue.number) || issue.number < 1 ||
      typeof issue.repository?.id !== "string" || typeof issue.repository?.nameWithOwner !== "string" ||
      !Object.hasOwn(issue, "parent")) {
    throw new Error(`malformed ${context} Issue`);
  }
  if (issue.parent !== null && (typeof issue.parent?.id !== "string" ||
      !Number.isSafeInteger(issue.parent?.number) || issue.parent.number < 1 ||
      typeof issue.parent?.repository?.id !== "string" || typeof issue.parent?.repository?.nameWithOwner !== "string")) {
    throw new Error(`malformed ${context} native parent`);
  }
}

async function resolveAncestors(api, issue, config) {
  assertIssueShape(issue, `#${issue?.number ?? "unknown"}`);
  const rootIds = new Set(config.roots.map((root) => root.id));
  if (rootIds.has(issue.id)) return [];
  const ancestors = [];
  const seen = new Set([issue.id]);
  let parent = issue.parent;
  while (parent) {
    if (parent.repository.id !== config.repository.id || parent.repository.nameWithOwner !== config.repository.nameWithOwner) break;
    if (seen.has(parent.id)) throw new Error(`Issue #${issue.number} has a native parent cycle`);
    if (ancestors.length >= 100) throw new Error(`Issue #${issue.number} ancestor depth exceeds 100`);
    seen.add(parent.id);
    const current = await readParent(api, parent.id);
    assertIssueShape(current, `parent of #${issue.number}`);
    if (current.repository.id !== config.repository.id || current.repository.nameWithOwner !== config.repository.nameWithOwner) {
      throw new Error(`Issue #${issue.number} parent changed repositories during reconciliation`);
    }
    ancestors.push(current);
    if (rootIds.has(current.id)) break;
    parent = current.parent;
  }
  return ancestors;
}

function emptySummary(dryRun) {
  return {
    dryRun,
    candidates: 0,
    ignoredPullRequests: 0,
    ignoredDrafts: 0,
    ignoredOther: 0,
    added: 0,
    updated: 0,
    cleared: 0,
    wouldAdd: 0,
    wouldUpdate: 0,
    wouldClear: 0,
    unchanged: 0,
    issues: [],
  };
}

export async function reconcileHomeProject(options) {
  const config = options.config;
  const api = options.api;
  const dryRun = options.dryRun === true;
  const summary = emptySummary(dryRun);

  await readAndValidateSchema(api, config);
  const [open, closedMvp, projectItems] = await Promise.all([
    listOpenIssues(api, config),
    listMilestoneClosedIssues(api, config),
    listProjectItems(api, config),
  ]);
  const existingIssues = [];
  for (const item of projectItems) {
    if (item.content?.__typename === "PullRequest") summary.ignoredPullRequests += 1;
    else if (item.content?.__typename === "DraftIssue") summary.ignoredDrafts += 1;
    else if (item.content?.__typename === "Issue" && item.content.repository?.id === config.repository.id) existingIssues.push(item.content);
    else summary.ignoredOther += 1;
  }

  const candidates = mergeCandidateIssues([open, closedMvp, existingIssues], config.roots);
  summary.candidates = candidates.length;
  for (const candidate of candidates) {
    let issue = await readCurrentIssue(api, candidate.id, config);
    assertIssueShape(issue, `current #${candidate.number}`);
    if (issue.repository.id !== config.repository.id || issue.repository.nameWithOwner !== config.repository.nameWithOwner) {
      summary.ignoredOther += 1;
      continue;
    }
    let ancestors = await resolveAncestors(api, issue, config);
    let desired = desiredFields(issue, ancestors, config);
    let projectItem = issue.projectItem;
    const needsAdd = !projectItem;

    if (needsAdd) {
      if (dryRun) {
        summary.wouldAdd += 1;
      } else {
        await addProjectItem(api, config, issue.id);
        issue = await readCurrentIssue(api, issue.id, config);
        assertIssueShape(issue, `current #${candidate.number} after add`);
        if (issue.repository.id !== config.repository.id || issue.repository.nameWithOwner !== config.repository.nameWithOwner) {
          throw new Error(`Issue #${candidate.number} changed repositories after Project addition`);
        }
        ancestors = await resolveAncestors(api, issue, config);
        desired = desiredFields(issue, ancestors, config);
        projectItem = issue.projectItem;
        if (!projectItem) throw new Error(`Issue #${issue.number} Project item was not visible after addition`);
        summary.added += 1;
      }
    }

    const current = currentDerivedValues(projectItem, config);
    const changes = planFieldChanges(current, desired, config);
    const issueResult = { number: issue.number, add: needsAdd, changes };
    if (dryRun) {
      summary.wouldUpdate += changes.filter((change) => change.action === "update").length;
      summary.wouldClear += changes.filter((change) => change.action === "clear").length;
    } else if (changes.length) {
      await applyFieldChanges(api, config, projectItem.id, changes);
      summary.updated += changes.filter((change) => change.action === "update").length;
      summary.cleared += changes.filter((change) => change.action === "clear").length;
    }
    if (!changes.length && projectItem) summary.unchanged += 1;
    if (issueResult.add || changes.length) summary.issues.push(issueResult);
  }
  return summary;
}

function parseArguments(argv) {
  if (argv.length === 0) return { dryRun: false };
  if (argv.length === 1 && argv[0] === "--dry-run") return { dryRun: true };
  throw new Error("usage: node scripts/delivery/sync-home-project.mjs [--dry-run]");
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const config = await loadHomeProjectConfig();
  const api = createProjectGitHub({ token: process.env.HOME_PROJECT_TOKEN });
  const summary = await reconcileHomeProject({ ...args, api, config });
  console.log(JSON.stringify(summary, null, 2));
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invoked === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Home Project reconciliation failed");
    process.exitCode = 1;
  });
}
