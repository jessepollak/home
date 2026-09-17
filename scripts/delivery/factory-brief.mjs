#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import projectConfig from "./home-project-config.json" with { type: "json" };
import { activateBrief, publishBrief, validateBriefBundle } from "./factory-brief-policy.mjs";

const execFile = promisify(execFileCallback);

async function gh(args) {
  try {
    const { stdout } = await execFile("gh", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout) : undefined;
  } catch (error) {
    throw new Error("gh command failed", { cause: error });
  }
}

function issueShape(issue) {
  return {
    nodeId: issue.node_id ?? issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: String(issue.state).toUpperCase(),
    labels: (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name),
    parent: issue.parent ? { nodeId: issue.parent.node_id ?? issue.parent.id, number: issue.parent.number } : null,
  };
}

function commentShape(comment) {
  return { id: comment.id, nodeId: comment.node_id, body: comment.body, createdAt: comment.created_at, updatedAt: comment.updated_at };
}

export function createBriefGitHubAdapter(repository) {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error("repository must use owner/repo format");
  const getIssue = async (number) => {
    const result = await gh(["api", "graphql",
      "-f", "query=query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){id number title body state labels(first:100){nodes{name}} parent{id number} projectItems(first:100){nodes{project{id}}}}}}",
      "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `number=${number}`,
    ]);
    const issue = result.data?.repository?.issue;
    if (!issue) throw new Error(`issue #${number} is unavailable`);
    return { ...issueShape(issue), projectIds: issue.projectItems.nodes.map(({ project }) => project.id) };
  };
  const listComments = async (number) => (await gh(["api", "--paginate", "--slurp", `repos/${repository}/issues/${number}/comments?per_page=100`]) ?? []).flat();
  return {
    getIssue,
    async findChildrenByMarker(_parent, key) {
      const pages = await gh(["api", "--paginate", "--slurp", `repos/${repository}/issues?state=all&per_page=100`]);
      return (pages ?? []).flat().filter((issue) => !issue.pull_request).map(issueShape)
        .filter((issue) => issue.body?.includes(`<!-- factory-brief-child:${key} -->`));
    },
    async createIssue({ title, body, labels }) {
      return issueShape(await gh(["api", "--method", "POST", `repos/${repository}/issues`,
        "-f", `title=${title}`, "-f", `body=${body}`, ...labels.flatMap((label) => ["-f", `labels[]=${label}`])]));
    },
    async attachNativeParent(issue, parent) {
      const current = await getIssue(issue.number);
      if (current.parent) {
        if (current.parent.nodeId !== parent.nodeId || current.parent.number !== parent.number) throw new Error(`child #${issue.number} already has a different native parent`);
        return;
      }
      await gh(["api", "graphql", "-f", "query=mutation($parent:ID!,$child:ID!){addSubIssue(input:{issueId:$parent,subIssueId:$child}){issue{id}}}",
        "-f", `parent=${parent.nodeId}`, "-f", `child=${issue.nodeId}`]);
      const attached = await getIssue(issue.number);
      if (attached.parent?.nodeId !== parent.nodeId || attached.parent?.number !== parent.number) throw new Error(`child #${issue.number} native parent was not attached`);
    },
    async ensureProjectMembership(issue) {
      const current = await getIssue(issue.number);
      if (!current.projectIds.includes(projectConfig.project.id)) {
        await gh(["api", "graphql", "-f", "query=mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}",
          "-f", `project=${projectConfig.project.id}`, "-f", `content=${issue.nodeId}`]);
      }
      if (!(await getIssue(issue.number)).projectIds.includes(projectConfig.project.id)) throw new Error(`child #${issue.number} is not in the Home Project`);
    },
    async ensureLabels(issue, labels) {
      const current = await getIssue(issue.number);
      if (current.labels.includes("factory:ready")) throw new Error("publish must not mutate a factory:ready child");
      if ([...current.labels].sort().join("\0") !== [...labels].sort().join("\0")) {
        await gh(["api", "--method", "PUT", `repos/${repository}/issues/${issue.number}/labels`, ...labels.flatMap((label) => ["-f", `labels[]=${label}`])]);
      }
      if ([...(await getIssue(issue.number)).labels].sort().join("\0") !== [...labels].sort().join("\0")) throw new Error(`child #${issue.number} labels do not match the exact brief`);
    },
    async findParentCommentsByBody(number, body) {
      return (await listComments(number)).filter((comment) => comment.body === body).map(commentShape);
    },
    async createParentComment(number, body) {
      return commentShape(await gh(["api", "--method", "POST", `repos/${repository}/issues/${number}/comments`, "-f", `body=${body}`]));
    },
    async listApprovalCandidates(number) {
      const comments = await listComments(number);
      return Promise.all(comments.map(async (comment) => {
        const pages = await gh(["api", "--paginate", "--slurp", "-H", "Accept: application/vnd.github+json", `repos/${repository}/issues/comments/${comment.id}/reactions?per_page=100`]);
        return { comment: commentShape(comment), reactions: (pages ?? []).flat().map((reaction) => ({ id: reaction.id, nodeId: reaction.node_id, content: reaction.content, user: reaction.user })) };
      }));
    },
    async addReadyLabel(number) {
      await gh(["api", "--method", "POST", `repos/${repository}/issues/${number}/labels`, "-f", "labels[]=factory:ready"]);
    },
  };
}

async function main() {
  const [operation, value] = process.argv.slice(2);
  if (operation === "activate") {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("usage: bun run factory:brief activate <parent-number>");
    const repository = "jessepollak/home";
    const adapter = createBriefGitHubAdapter(repository);
    const parentIssue = await adapter.getIssue(number);
    const result = await activateBrief({ repository, repositoryOwner: repository.split("/")[0], parent: { nodeId: parentIssue.nodeId, number }, candidates: await adapter.listApprovalCandidates(number) }, adapter);
    console.log(JSON.stringify({ activated: true, ...result }));
    return;
  }
  if (!value || !["validate", "publish"].includes(operation)) throw new Error("usage: bun run factory:brief <validate|publish> <brief.json> | activate <parent-number>");
  const brief = validateBriefBundle(JSON.parse(await readFile(value, "utf8")));
  if (operation === "validate") {
    console.log(JSON.stringify({ valid: true, schema: brief.schema, children: brief.children.length }));
    return;
  }
  const result = await publishBrief(brief, createBriefGitHubAdapter(brief.repository));
  console.log(JSON.stringify({ published: true, parent: brief.parent, children: result.manifest.children, comment: result.comment }));
}

let direct = false;
try { direct = await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1]); } catch {}
if (direct) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
