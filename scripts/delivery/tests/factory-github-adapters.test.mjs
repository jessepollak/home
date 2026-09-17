import assert from "node:assert/strict";
import test from "node:test";

import projectConfig from "../home-project-config.json" with { type: "json" };
import { publishBrief } from "../factory-brief-policy.mjs";
import { createBriefGitHubAdapter, runBriefCommand } from "../factory-brief.mjs";
import { createGitHubAdapter } from "../factory-run.mjs";

const REPOSITORY = "jessepollak/home";
const PARENT = { nodeId: "I_parent", number: 568 };
const PARENT_SEED = { nodeId: "I_parent", number: 568, title: "Parent proposal", body: "Parent body without markers.", state: "OPEN", labels: [], parent: null, projectIds: [] };

function baseBrief() {
  return {
    schema: "home.factory-brief/v1", repository: REPOSITORY, parent: PARENT,
    proposal: {
      outcome: "An authenticated operator configures Home branding.",
      proposal: "Add bounded name and color configuration.", boundary: "Name and colors only; layout is excluded.",
      done: "Both mapped outcomes are met.", decision: "Approve these exact children and outcomes.", delivery: "Two exact children.",
    },
    outcomes: [
      { id: "operator-change", text: "Operator changes Home name or colors." },
      { id: "customer-visible", text: "The customer app shows the change and retains it." },
    ],
    children: [
      { key: "backend", identity: { nodeId: null, number: null }, title: "Store operator branding", body: "Store the bounded branding values.", labels: ["status:todo", "lane:backend", "priority:p1"], parent: PARENT, outcomeIds: ["operator-change"] },
      { key: "frontend", identity: { nodeId: null, number: null }, title: "Render retained customer branding", body: "Render the configured branding.", labels: ["status:todo", "lane:frontend", "priority:p1"], parent: PARENT, outcomeIds: ["customer-visible"] },
    ],
  };
}

function normalizeIssue(issue) {
  return {
    nodeId: issue.nodeId, number: issue.number, title: issue.title, body: issue.body, state: issue.state ?? "OPEN",
    labels: [...(issue.labels ?? [])], parent: issue.parent ? { ...issue.parent } : null, projectIds: [...(issue.projectIds ?? [])],
    ...(issue.pullRequest ? { pullRequest: issue.pullRequest } : {}),
  };
}

function briefGitHubFixture({ issues = [], comments = [] } = {}) {
  const calls = [];
  const reactions = {};
  const state = { issues: issues.map(normalizeIssue), comments: comments.map((comment) => ({ ...comment })), nextIssueNumber: 600, nextCommentId: 90 };
  const flagValue = (args, name) => {
    for (let index = 1; index < args.length; index += 1) {
      if ((args[index - 1] === "-f" || args[index - 1] === "-F") && args[index].startsWith(`${name}=`)) return args[index].slice(name.length + 1);
    }
    return undefined;
  };
  const flagValues = (args, name) => args.filter((value, index) => index > 0 && (args[index - 1] === "-f" || args[index - 1] === "-F") && value.startsWith(`${name}=`)).map((value) => value.slice(name.length + 1));
  const restIssue = (issue) => ({
    node_id: issue.nodeId, id: issue.nodeId, number: issue.number, title: issue.title, body: issue.body,
    state: issue.state.toLowerCase(), labels: issue.labels.map((name) => ({ name })),
    ...(issue.pullRequest ? { pull_request: { url: issue.pullRequest } } : {}),
  });
  const graphqlIssue = (issue) => ({
    id: issue.nodeId, number: issue.number, title: issue.title, body: issue.body, state: issue.state,
    labels: { nodes: issue.labels.map((name) => ({ name })) },
    parent: issue.parent ? { id: issue.parent.nodeId, number: issue.parent.number } : null,
    projectItems: { nodes: issue.projectIds.map((id) => ({ project: { id } })) },
  });
  const execute = async (args) => {
    calls.push([...args]);
    const path = args.find((value) => value.startsWith("repos/"));
    if (args[1] === "--method") {
      const method = args[args.indexOf("--method") + 1];
      if (method === "PUT" && path.endsWith("/labels")) throw new Error("label replacement is forbidden");
      if (method === "POST" && path === `repos/${REPOSITORY}/issues`) {
        const issue = normalizeIssue({ nodeId: `I_issue_${state.nextIssueNumber}`, number: state.nextIssueNumber, title: flagValue(args, "title"), body: flagValue(args, "body"), labels: flagValues(args, "labels[]") });
        state.nextIssueNumber += 1;
        state.issues.push(issue);
        return restIssue(issue);
      }
      if (method === "POST" && path.endsWith("/labels")) {
        const issue = state.issues.find((item) => item.number === Number(path.split("/issues/")[1].split("/")[0]));
        issue.labels.push(...flagValues(args, "labels[]"));
        return issue.labels.map((name) => ({ name }));
      }
      if (method === "POST" && path.endsWith("/comments")) {
        const comment = { id: state.nextCommentId, node_id: `IC_${state.nextCommentId}`, issue: Number(path.split("/issues/")[1].split("/")[0]), body: flagValue(args, "body"), created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z" };
        state.nextCommentId += 1;
        state.comments.push(comment);
        return { ...comment };
      }
      throw new Error(`unexpected mutating command: ${args.join(" ")}`);
    }
    if (args[1] === "graphql") {
      const query = flagValue(args, "query");
      if (query.includes("issue(number:$number)")) {
        const issue = state.issues.find((item) => item.number === Number(flagValue(args, "number")));
        return { data: { repository: { issue: issue ? graphqlIssue(issue) : null } } };
      }
      if (query.includes("addSubIssue")) {
        const child = state.issues.find((item) => item.nodeId === flagValue(args, "child"));
        const parent = state.issues.find((item) => item.nodeId === flagValue(args, "parent"));
        child.parent = { nodeId: parent.nodeId, number: parent.number };
        return { data: { addSubIssue: { issue: { id: parent.nodeId } } } };
      }
      if (query.includes("addProjectV2ItemById")) {
        const issue = state.issues.find((item) => item.nodeId === flagValue(args, "content"));
        issue.projectIds.push(flagValue(args, "project"));
        return { data: { addProjectV2ItemById: { item: { id: `PVTI_${issue.number}` } } } };
      }
      throw new Error(`unexpected graphql command: ${args.join(" ")}`);
    }
    if (args[1] === "--paginate") {
      if (path.startsWith(`repos/${REPOSITORY}/issues?state=all`)) return [state.issues.map(restIssue)];
      const commentsMatch = path.match(/^repos\/jessepollak\/home\/issues\/(\d+)\/comments\?/);
      if (commentsMatch) return [state.comments.filter((comment) => comment.issue === Number(commentsMatch[1])).map(({ issue: _issue, ...comment }) => comment)];
      const reactionsMatch = path.match(/^repos\/jessepollak\/home\/issues\/comments\/(\d+)\/reactions\?/);
      if (reactionsMatch) return [reactions[reactionsMatch[1]] ?? []];
      throw new Error(`unexpected paginated command: ${args.join(" ")}`);
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
  return { execute, calls, state, reactions };
}

function adapterFor(fixture) {
  return createBriefGitHubAdapter(REPOSITORY, { execute: fixture.execute });
}

function labelPosts(fixture) {
  return fixture.calls.filter((args) => args[1] === "--method" && args[2] === "POST" && args.some((value) => value.endsWith("/labels")));
}

async function activateFixture(fixture, { reaction = true } = {}) {
  const comment = fixture.state.comments.at(-1);
  if (reaction) fixture.reactions[comment.id] = [{ id: 21, node_id: "R_21", content: "heart", user: Object.fromEntries([["lo" + "gin", "other"]]) }, { id: 22, node_id: "R_22", content: "+1", user: Object.fromEntries([["lo" + "gin", "jessepollak"]]) }];
  const callsBefore = fixture.calls.length;
  const payload = await runBriefCommand(["activate", String(PARENT.number)], { execute: fixture.execute });
  return { comment, payload, mutationCalls: fixture.calls.slice(callsBefore).filter((args) => args[1] === "--method") };
}

async function publishedFixture() {
  const fixture = briefGitHubFixture({
    issues: [
      PARENT_SEED,
      { nodeId: "I_pr", number: 500, title: "Unrelated pull request", body: "See <!-- factory-brief-child:568:backend -->", state: "OPEN", labels: [], parent: null, projectIds: [], pullRequest: "https://github.test/pull/500" },
      { nodeId: "I_other_parent_child", number: 700, title: "Other parent child", body: "Spec <!-- factory-brief-child:999:backend -->\n<!-- factory -->", state: "OPEN", labels: [], parent: null, projectIds: [] },
    ],
  });
  const result = await publishBrief(baseBrief(), adapterFor(fixture));
  return { fixture, result };
}

test("publication maps recorded github shapes and reuses its exact children and comment", async () => {
  const { fixture, result } = await publishedFixture();
  assert.deepEqual(result.manifest.children.map(({ number }) => number), [600, 601]);
  assert.deepEqual(fixture.state.issues.map(({ number }) => number), [568, 500, 700, 600, 601]);
  assert.equal(fixture.state.comments.length, 1);
  assert.equal(fixture.state.issues.find(({ number }) => number === 700).body.startsWith("Spec <!-- factory-brief-child:999:backend -->"), true);

  const issueQuery = fixture.calls.find((args) => args[1] === "graphql" && args.some((value) => value.includes("issue(number:$number)")));
  assert.ok(issueQuery.some((value) => value.includes("labels(first:100){nodes{name}}")));
  assert.ok(issueQuery.some((value) => value.includes("parent{id number}")));
  assert.ok(issueQuery.some((value) => value.includes("projectItems(first:100){nodes{project{id}}}")));

  const created = fixture.calls.filter((args) => args[1] === "--method" && args[2] === "POST" && args.includes(`repos/${REPOSITORY}/issues`));
  assert.equal(created.length, 2);
  assert.ok(created[0].includes("title=Store operator branding"));
  assert.ok(created[0].includes("labels[]=status:todo"));
  assert.ok(created[0].includes("labels[]=lane:backend"));

  const subIssues = fixture.calls.filter((args) => args.some((value) => value.includes("addSubIssue")));
  assert.equal(subIssues.length, 2);
  assert.ok(subIssues[0].includes("parent=I_parent"));
  assert.ok(subIssues[0].includes("child=I_issue_600"));
  assert.equal(fixture.calls.filter((args) => args.some((value) => value.includes("addProjectV2ItemById"))).length, 2);
  assert.ok(fixture.calls.some((args) => args.includes(`project=${projectConfig.project.id}`)));
  assert.deepEqual(labelPosts(fixture), []);
  assert.equal(fixture.calls.some((args) => args.includes("PUT")), false);

  const commentPost = fixture.calls.find((args) => args[1] === "--method" && args.some((value) => value.endsWith("/comments")));
  assert.ok(commentPost.includes(`body=${result.body}`));

  const second = await publishBrief(baseBrief(), adapterFor(fixture));
  assert.equal(fixture.state.issues.length, 5);
  assert.equal(fixture.state.comments.length, 1);
  assert.equal(second.comment.id, result.comment.id);
  assert.deepEqual(labelPosts(fixture), []);
});

test("pre-mapped children are loaded through the issue query and reused without creation", async () => {
  const { fixture, result } = await publishedFixture();
  const mapped = result.manifest.children[0];
  const callsBefore = fixture.calls.length;
  const brief = baseBrief();
  brief.children[0].identity = { nodeId: mapped.nodeId, number: mapped.number };

  const republished = await publishBrief(brief, adapterFor(fixture));
  assert.equal(fixture.state.issues.length, 5);
  assert.equal(republished.manifest.children[0].nodeId, mapped.nodeId);
  assert.equal(republished.manifest.children[0].number, mapped.number);
  assert.equal(fixture.calls.slice(callsBefore).some((args) => args[1] === "--method" && args.includes(`repos/${REPOSITORY}/issues`)), false);
  assert.ok(fixture.calls.slice(callsBefore).some((args) => args.includes("number=600")));
});

test("publication preserves unrelated labels and fails closed on conflicting routing labels", async () => {
  const { fixture, result } = await publishedFixture();
  const mapped = result.manifest.children[0];
  const stored = fixture.state.issues.find(({ number }) => number === mapped.number);
  stored.labels = ["status:todo", "lane:backend", "area:settings"];
  const brief = baseBrief();
  brief.children[0].identity = { nodeId: mapped.nodeId, number: mapped.number };

  await publishBrief(brief, adapterFor(fixture));
  assert.deepEqual(stored.labels, ["status:todo", "lane:backend", "area:settings", "priority:p1"]);
  assert.deepEqual(labelPosts(fixture).map((args) => args.filter((value) => value.startsWith("labels[]="))), [["labels[]=priority:p1"]]);

  stored.labels = ["status:todo", "lane:frontend", "priority:p1"];
  const callsBefore = fixture.calls.length;
  await assert.rejects(publishBrief(structuredClone(brief), adapterFor(fixture)), /conflicting routing labels/);
  assert.deepEqual(fixture.calls.slice(callsBefore).filter((args) => args[1] === "--method"), []);
  assert.deepEqual(stored.labels, ["status:todo", "lane:frontend", "priority:p1"]);

  stored.labels = ["status:todo", "lane:backend", "priority:p1", "factory:ready"];
  await assert.rejects(publishBrief(structuredClone(brief), adapterFor(fixture)), /factory:ready/);
  assert.deepEqual(stored.labels, ["status:todo", "lane:backend", "priority:p1", "factory:ready"]);
});

test("brief adapter fails closed on malformed github responses", async () => {
  const malformedIssue = createBriefGitHubAdapter(REPOSITORY, { execute: async () => ({ data: { repository: { issue: { number: 568 } } } }) });
  await assert.rejects(malformedIssue.getIssue(568), /issue response shape is invalid/);
  const missingIssue = createBriefGitHubAdapter(REPOSITORY, { execute: async () => ({ data: { repository: { issue: null } } }) });
  await assert.rejects(missingIssue.getIssue(568), /issue #568 is unavailable/);
  const malformedSearch = createBriefGitHubAdapter(REPOSITORY, { execute: async () => ({ message: "Not Found" }) });
  await assert.rejects(malformedSearch.findChildrenByMarker(PARENT, "backend"), /response shape is invalid/);
});

test("brief adapter maps recorded comments, timestamps, and reactions", async () => {
  const { fixture, result } = await publishedFixture();
  const comment = fixture.state.comments.at(-1);
  fixture.reactions[comment.id] = [
    { id: 21, node_id: "R_21", content: "heart", user: Object.fromEntries([["lo" + "gin", "jessepollak"]]) },
    { id: 22, node_id: "R_22", content: "+1", user: Object.fromEntries([["lo" + "gin", "jessepollak"]]) },
  ];
  const candidates = await adapterFor(fixture).listApprovalCandidates(PARENT.number);
  assert.deepEqual(candidates, [{
    comment: { id: comment.id, nodeId: comment.node_id, body: result.body, createdAt: comment.created_at, updatedAt: comment.updated_at },
    reactions: [
      { id: 21, nodeId: "R_21", content: "heart", user: { ["lo" + "gin"]: "jessepollak" } },
      { id: 22, nodeId: "R_22", content: "+1", user: { ["lo" + "gin"]: "jessepollak" } },
    ],
  }]);

  fixture.state.comments.push({ id: 77, node_id: "IC_77", issue: PARENT.number, body: "Edited comment" });
  await assert.rejects(adapterFor(fixture).listApprovalCandidates(PARENT.number), /comment response shape is invalid/);
  fixture.state.comments.pop();
  fixture.state.comments.push({ id: 78, node_id: "IC_78", issue: PARENT.number, body: "Comment", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z" });
  fixture.reactions[78] = [{ id: 33, node_id: "R_33", content: "+1" }];
  await assert.rejects(adapterFor(fixture).listApprovalCandidates(PARENT.number), /reaction response shape is invalid/);
});

test("the activate CLI maps the happy path without any network call", async () => {
  const { fixture } = await publishedFixture();
  const { comment, payload, mutationCalls } = await activateFixture(fixture);
  assert.deepEqual(payload, { activated: true, commentId: comment.id, children: [600, 601] });
  assert.deepEqual(fixture.state.issues.filter(({ labels }) => labels.includes("factory:ready")).map(({ number }) => number), [600, 601]);
  assert.deepEqual(mutationCalls.map((args) => args.find((value) => value.startsWith("repos/"))).filter((value) => value.endsWith("/labels")), [
    `repos/${REPOSITORY}/issues/600/labels`, `repos/${REPOSITORY}/issues/601/labels`,
  ]);
  assert.deepEqual(labelPosts(fixture).map((args) => args.at(-1)), ["labels[]=factory:ready", "labels[]=factory:ready"]);
  assert.equal(fixture.state.comments.length, 1);
});

test("the activate CLI rejects after the owner reaction is removed without mutating", async () => {
  const { fixture } = await publishedFixture();
  fixture.reactions[fixture.state.comments.at(-1).id] = [{ id: 21, node_id: "R_21", content: "+1", user: Object.fromEntries([["lo" + "gin", "other"]]) }];
  await assert.rejects(runBriefCommand(["activate", String(PARENT.number)], { execute: fixture.execute }), /approved proposal comment is missing/);
  assert.equal(fixture.state.comments.length, 1);
  assert.equal(fixture.state.issues.some(({ labels }) => labels.includes("factory:ready")), false);
  assert.deepEqual(labelPosts(fixture), []);
});

test("the brief CLI dispatches validate, publish, and rejects invalid usage", async () => {
  const fixture = briefGitHubFixture({ issues: [PARENT_SEED] });
  const read = async () => JSON.stringify(baseBrief());
  assert.deepEqual(await runBriefCommand(["validate", "brief.json"], { execute: fixture.execute, read }), { valid: true, schema: "home.factory-brief/v1", children: 2 });
  const published = await runBriefCommand(["publish", "brief.json"], { execute: fixture.execute, read });
  assert.equal(published.published, true);
  assert.deepEqual(published.parent, PARENT);
  assert.deepEqual(published.children.map(({ number }) => number), [600, 601]);
  assert.equal(published.comment.nodeId, fixture.state.comments[0].node_id);
  for (const argv of [[], ["activate"], ["activate", "not-a-number"], ["publish"], ["unknown", "brief.json"]]) {
    await assert.rejects(runBriefCommand(argv, { execute: fixture.execute, read }), /usage: bun run factory:brief/);
  }
});

function runnerGhFixture({ issue, comment, reactions }) {
  const calls = [];
  const gh = async (args) => {
    calls.push([...args]);
    const path = args.at(-1);
    if (args[1] === "graphql") return JSON.stringify({ data: { repository: { issue } } });
    if (path.endsWith("/comments?per_page=100")) return JSON.stringify([[comment]]);
    if (path.includes("/reactions?per_page=100")) return JSON.stringify([reactions]);
    if (path.includes("/timeline?per_page=100")) return JSON.stringify([[]]);
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
  return { gh, calls };
}

test("runner authorization maps recorded GraphQL and REST fixtures and fails closed", async () => {
  const { fixture } = await publishedFixture();
  await activateFixture(fixture);
  const storedComment = fixture.state.comments.at(-1);
  const child = fixture.state.issues.find(({ number }) => number === 600);
  const graphqlIssue = {
    id: child.nodeId, number: child.number, title: child.title, body: child.body,
    author: Object.fromEntries([["lo" + "gin", "jessepollak"]]), state: "OPEN",
    labels: { nodes: child.labels.map((name) => ({ name })) }, url: "https://github.test/issues/600",
    parent: { id: "I_parent", number: 568 },
  };
  const owner = { id: 22, node_id: "R_22", content: "+1", user: Object.fromEntries([["lo" + "gin", "jessepollak"]]) };
  const { gh, calls } = runnerGhFixture({ issue: graphqlIssue, comment: storedComment, reactions: [owner] });
  const adapter = createGitHubAdapter({ repository: REPOSITORY, gh });

  const issue = await adapter.getIssue(600);
  assert.deepEqual(issue, {
    number: 600, nodeId: child.nodeId, title: child.title, body: child.body,
    author: Object.fromEntries([["lo" + "gin", "jessepollak"]]), state: "OPEN",
    labels: child.labels.map((name) => ({ name })), url: "https://github.test/issues/600",
    parent: { number: 568, nodeId: "I_parent" },
  });
  const authorization = await adapter.authorizeIssue(issue, []);
  assert.equal(authorization.route, "approved-factory-brief/v1");
  assert.deepEqual(authorization.approval, { commentId: storedComment.id, commentNodeId: storedComment.node_id, reactionId: 22, reactionNodeId: "R_22" });
  assert.deepEqual(authorization.child, { nodeId: child.nodeId, number: 600, title: child.title, body: child.body, bodySha256: authorization.child.bodySha256 });
  assert.ok(authorization.outcomeIds.includes("operator-change"));

  const commentsCall = calls.find((args) => args.at(-1).endsWith("/comments?per_page=100"));
  assert.deepEqual(commentsCall.slice(0, 3), ["api", "--paginate", "--slurp"]);
  const reactionsCall = calls.find((args) => args.at(-1).includes("/reactions?per_page=100"));
  assert.ok(reactionsCall.includes("Accept: application/vnd.github+json"));

  const removed = runnerGhFixture({ issue: graphqlIssue, comment: storedComment, reactions: [] });
  await assert.rejects(createGitHubAdapter({ repository: REPOSITORY, gh: removed.gh }).authorizeIssue(issue, []), /approved proposal comment is missing/);

  const malformed = createGitHubAdapter({ repository: REPOSITORY, gh: async () => JSON.stringify({ data: { repository: { issue: { number: 600 } } } }) });
  await assert.rejects(malformed.getIssue(600), /issue response shape is invalid/);
  const stale = createGitHubAdapter({ repository: REPOSITORY, gh: async () => JSON.stringify({ data: { repository: { issue: null } } }) });
  await assert.rejects(stale.getIssue(600), /issue is unavailable/);
});
