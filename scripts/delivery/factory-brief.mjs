#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import projectConfig from "./home-project-config.json" with { type: "json" };
import { activateBrief, childMarker, conflictingRoutingLabels, labelNames, publishBrief, validateBriefBundle } from "./factory-brief-policy.mjs";

const execFile = promisify(execFileCallback);

export function createGhExecutor(execute) {
  return async (args) => {
    try {
      const { stdout } = await execute("gh", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      return stdout.trim() ? JSON.parse(stdout) : undefined;
    } catch (error) {
      throw new Error("gh command failed", { cause: error });
    }
  };
}

const gh = createGhExecutor(execFile);

function paginatedItems(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("github response shape is invalid");
  const items = value.every(Array.isArray) ? value.flat() : value;
  if (!items.every((item) => item && typeof item === "object" && !Array.isArray(item))) throw new Error("github response shape is invalid");
  return items;
}

function issueLabels(value) {
  const labels = Array.isArray(value) ? value : value?.nodes;
  if (!Array.isArray(labels)) throw new Error("issue labels response shape is invalid");
  return labels.map((label) => typeof label === "string" ? label : label?.name).filter((label) => typeof label === "string" && label !== "");
}

export function issueShape(issue) {
  const nodeId = issue?.node_id ?? issue?.id;
  if (!issue || typeof issue !== "object" || typeof nodeId !== "string" || nodeId === "" || !Number.isSafeInteger(issue.number) || issue.number < 1) {
    throw new Error("issue response shape is invalid");
  }
  return {
    nodeId,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: String(issue.state).toUpperCase(),
    labels: issueLabels(issue.labels),
    parent: issue.parent ? { nodeId: issue.parent.node_id ?? issue.parent.id, number: issue.parent.number } : null,
  };
}

export function commentShape(comment) {
  if (!comment || typeof comment !== "object" || !Number.isSafeInteger(comment.id) || typeof comment.node_id !== "string" || comment.node_id === "" ||
      typeof comment.body !== "string" || typeof comment.created_at !== "string" || typeof comment.updated_at !== "string") {
    throw new Error("comment response shape is invalid");
  }
  return { id: comment.id, nodeId: comment.node_id, body: comment.body, createdAt: comment.created_at, updatedAt: comment.updated_at };
}

export function reactionShape(reaction) {
  if (!reaction || typeof reaction !== "object" || !Number.isSafeInteger(reaction.id) || typeof reaction.node_id !== "string" || reaction.node_id === "" ||
      typeof reaction.content !== "string" || typeof reaction.user?.login !== "string" || reaction.user.login === "") {
    throw new Error("reaction response shape is invalid");
  }
  return { id: reaction.id, nodeId: reaction.node_id, content: reaction.content, user: { login: reaction.user.login } };
}

export function createBriefGitHubAdapter(repository, { execute = gh } = {}) {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error("repository must use owner/repo format");
  const getIssue = async (number) => {
    const result = await execute(["api", "graphql",
      "-f", "query=query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){id number title body state labels(first:100){nodes{name}} parent{id number} projectItems(first:100){nodes{project{id}}}}}}",
      "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `number=${number}`,
    ]);
    const issue = result?.data?.repository?.issue;
    if (!issue) throw new Error(`issue #${number} is unavailable`);
    const shaped = issueShape(issue);
    const projectItems = issue.projectItems?.nodes;
    if (!Array.isArray(projectItems)) throw new Error("issue project response shape is invalid");
    return { ...shaped, projectIds: projectItems.map(({ project }) => project.id) };
  };
  const listComments = async (number) => paginatedItems(await execute(["api", "--paginate", "--slurp", `repos/${repository}/issues/${number}/comments?per_page=100`]));
  return {
    getIssue,
    async findChildrenByMarker(parent, key) {
      const pages = await execute(["api", "--paginate", "--slurp", `repos/${repository}/issues?state=all&per_page=100`]);
      const marker = childMarker(parent, key);
      return paginatedItems(pages).filter((issue) => !issue.pull_request).map(issueShape)
        .filter((issue) => issue.body?.includes(marker));
    },
    async createIssue({ title, body, labels }) {
      return issueShape(await execute(["api", "--method", "POST", `repos/${repository}/issues`,
        "-f", `title=${title}`, "-f", `body=${body}`, ...labels.flatMap((label) => ["-f", `labels[]=${label}`])]));
    },
    async attachNativeParent(issue, parent) {
      const current = await getIssue(issue.number);
      if (current.parent) {
        if (current.parent.nodeId !== parent.nodeId || current.parent.number !== parent.number) throw new Error(`child #${issue.number} already has a different native parent`);
        return;
      }
      await execute(["api", "graphql", "-f", "query=mutation($parent:ID!,$child:ID!){addSubIssue(input:{issueId:$parent,subIssueId:$child}){issue{id}}}",
        "-f", `parent=${parent.nodeId}`, "-f", `child=${issue.nodeId}`]);
      const attached = await getIssue(issue.number);
      if (attached.parent?.nodeId !== parent.nodeId || attached.parent?.number !== parent.number) throw new Error(`child #${issue.number} native parent was not attached`);
    },
    async ensureProjectMembership(issue) {
      const current = await getIssue(issue.number);
      if (!current.projectIds.includes(projectConfig.project.id)) {
        await execute(["api", "graphql", "-f", "query=mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}",
          "-f", `project=${projectConfig.project.id}`, "-f", `content=${issue.nodeId}`]);
      }
      if (!(await getIssue(issue.number)).projectIds.includes(projectConfig.project.id)) throw new Error(`child #${issue.number} is not in the Home Project`);
    },
    async ensureLabels(issue, labels) {
      const current = await getIssue(issue.number);
      if (current.labels.includes("factory:ready")) throw new Error("publish must not mutate a factory:ready child");
      const conflicts = conflictingRoutingLabels(current.labels, labels);
      if (conflicts.length > 0) throw new Error(`child #${issue.number} has conflicting routing labels`);
      const missing = labels.filter((label) => !current.labels.includes(label));
      if (missing.length > 0) {
        await execute(["api", "--method", "POST", `repos/${repository}/issues/${issue.number}/labels`, ...missing.flatMap((label) => ["-f", `labels[]=${label}`])]);
      }
      const after = await getIssue(issue.number);
      if (after.labels.includes("factory:ready") || conflictingRoutingLabels(after.labels, labels).length > 0 || labels.some((label) => !after.labels.includes(label))) {
        throw new Error(`child #${issue.number} labels do not match the exact brief`);
      }
    },
    async findParentCommentsByBody(number, body) {
      return (await listComments(number)).filter((comment) => comment.body === body).map(commentShape);
    },
    async createParentComment(number, body) {
      return commentShape(await execute(["api", "--method", "POST", `repos/${repository}/issues/${number}/comments`, "-f", `body=${body}`]));
    },
    async listApprovalCandidates(number) {
      const comments = await listComments(number);
      return Promise.all(comments.map(async (comment) => {
        const reactions = paginatedItems(await execute(["api", "--paginate", "--slurp", "-H", "Accept: application/vnd.github+json", `repos/${repository}/issues/comments/${comment.id}/reactions?per_page=100`]));
        return { comment: commentShape(comment), reactions: reactions.map(reactionShape) };
      }));
    },
    async addReadyLabel(number) {
      await execute(["api", "--method", "POST", `repos/${repository}/issues/${number}/labels`, "-f", "labels[]=factory:ready"]);
    },
  };
}

export async function runBriefCommand(argv, { execute = gh, read = readFile } = {}) {
  const [operation, value] = argv;
  if (operation === "activate") {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("usage: bun run factory:brief activate <parent-number>");
    const repository = "jessepollak/home";
    const adapter = createBriefGitHubAdapter(repository, { execute });
    const parentIssue = await adapter.getIssue(number);
    const result = await activateBrief({ repository, repositoryOwner: repository.split("/")[0], parent: { nodeId: parentIssue.nodeId, number }, candidates: await adapter.listApprovalCandidates(number) }, adapter);
    return { activated: true, ...result };
  }
  if (!value || !["validate", "publish"].includes(operation)) throw new Error("usage: bun run factory:brief <validate|publish> <brief.json> | activate <parent-number>");
  const brief = validateBriefBundle(JSON.parse(await read(value, "utf8")));
  if (operation === "validate") {
    return { valid: true, schema: brief.schema, children: brief.children.length };
  }
  const result = await publishBrief(brief, createBriefGitHubAdapter(brief.repository, { execute }));
  return { published: true, parent: brief.parent, children: result.manifest.children, comment: result.comment };
}

async function main() {
  console.log(JSON.stringify(await runBriefCommand(process.argv.slice(2))));
}

let direct = false;
try { direct = await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1]); } catch {}
if (direct) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
