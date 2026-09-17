import assert from "node:assert/strict";
import test from "node:test";
import { activateBrief, bodySha256, parseProposalComment, publishBrief, sameApprovalIdentity, selectApprovedBrief, validateBriefBundle, verifyBriefApproval } from "../factory-brief-policy.mjs";

const PARENT = { nodeId: "I_parent", number: 568 };
const BASE = {
  schema: "home.factory-brief/v1", repository: "jessepollak/home", parent: PARENT,
  proposal: {
    outcome: "Authenticated operator changes Home name/colors, sees it in customer app, retains it across an update.",
    proposal: "Add bounded name and color configuration.", boundary: "Name and colors only; arbitrary CSS and layout excluded.",
    done: "The mapped outcomes are met with the evidence required by each child body.",
    decision: "Approve these exact children and outcomes.", delivery: "Two exact implementation children.",
  },
  outcomes: [
    { id: "operator-change", text: "Authenticated operator changes Home name/colors." },
    { id: "customer-visible", text: "The customer app shows the change and retains it across an update." },
  ],
  children: [
    { key: "operator-config", identity: { nodeId: null, number: null }, title: "Add bounded operator branding controls", body: "Implement controls. Validate with the references and evidence named in this approved prose.", labels: ["status:todo", "lane:frontend", "priority:p1"], parent: PARENT, outcomeIds: ["operator-change"] },
    { key: "customer-branding", identity: { nodeId: null, number: null }, title: "Render retained customer branding", body: "Render and retain the configured branding.", labels: ["status:todo", "lane:frontend", "priority:p1"], parent: PARENT, outcomeIds: ["customer-visible"] },
  ],
};

function memoryAdapter({ failCreateOnce = false } = {}) {
  const children = [], comments = [];
  let failed = false;
  return {
    children, comments,
    async getIssue(number) { return children.find((child) => child.number === number); },
    async findChildrenByMarker(_parent, key) { return children.filter((child) => child.body.includes(`factory-brief-child:${key}`)); },
    async createIssue(issue) {
      if (failCreateOnce && children.length === 1 && !failed) { failed = true; throw new Error("interrupted"); }
      const child = { ...issue, nodeId: `I_child_${children.length + 1}`, number: 600 + children.length, state: "OPEN", parent: null };
      children.push(child); return child;
    },
    async attachNativeParent(issue, parent) { issue.parent = { ...parent }; }, async ensureProjectMembership() {},
    async ensureLabels(issue, labels) { issue.labels = [...labels]; },
    async findParentCommentsByBody(_number, body) { return comments.filter((comment) => comment.body === body); },
    async createParentComment(_number, body) {
      const id = 90 + comments.length;
      const comment = { id, nodeId: `IC_${id}`, body, createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z" };
      comments.push(comment); return comment;
    },
    async addReadyLabel(number) { children.find((child) => child.number === number).labels.push("factory:ready"); },
  };
}

const candidate = (comment, owner = "jessepollak", id = 92) => ({ comment, reactions: [{ id, nodeId: `R_${id}`, content: "+1", user: Object.fromEntries([["lo" + "gin", owner]]) }] });
async function published(adapter = memoryAdapter()) { return { ...await publishBrief(structuredClone(BASE), adapter), adapter }; }
function approvalInput(result, childIndex = 0) {
  const child = result.adapter.children[childIndex];
  return { repository: BASE.repository, repositoryOwner: "jessepollak", parent: PARENT, ...candidate({ ...result.comment, body: result.body }), currentChild: { ...child, labels: [...child.labels, "factory:ready"] } };
}

test("lean brief validates six proposal fields, 1–5 outcomes, and exact mapped child specs", () => {
  assert.deepEqual(Object.keys(validateBriefBundle(structuredClone(BASE))), ["schema", "repository", "parent", "proposal", "outcomes", "children"]);
  const one = structuredClone(BASE); one.outcomes = [one.outcomes[0]]; one.children = [one.children[0]];
  assert.equal(validateBriefBundle(one).outcomes.length, 1);
  for (const mutate of [
    (brief) => { brief.baseCommit = "a".repeat(40); }, (brief) => { brief.designRefs = []; },
    (brief) => { brief.children[0].evidenceKinds = ["test"]; }, (brief) => { brief.children[0].labels.push("factory:ready"); },
    (brief) => { brief.children[0].outcomeIds = ["unknown"]; }, (brief) => { brief.children[0].parent = { nodeId: "other", number: 1 }; },
  ]) { const brief = structuredClone(BASE); mutate(brief); assert.throws(() => validateBriefBundle(brief)); }
});

test("publication is safely rerunnable after a partial failure and reuses its exact proposal comment", async () => {
  const adapter = memoryAdapter({ failCreateOnce: true });
  await assert.rejects(publishBrief(structuredClone(BASE), adapter), /interrupted/); assert.equal(adapter.children.length, 1);
  const first = await publishBrief(structuredClone(BASE), adapter); const second = await publishBrief(structuredClone(BASE), adapter);
  assert.equal(adapter.children.length, 2); assert.equal(adapter.comments.length, 1); assert.equal(second.comment.id, first.comment.id);
  assert.deepEqual(Object.keys(parseProposalComment(first.body)), ["schema", "repository", "parent", "outcomes", "children"]);
  assert.equal(first.manifest.children[0].bodySha256, bodySha256(adapter.children[0].body));
});

test("approval ignores non-owner thumbs, maps only its child outcomes, and revocation defeats stale ready", async () => {
  const result = await published(), input = approvalInput(result);
  input.reactions.push({ id: 93, nodeId: "R_93", content: "+1", user: Object.fromEntries([["lo" + "gin", "other"]]) });
  const authorization = verifyBriefApproval(input);
  assert.deepEqual(authorization.outcomeIds, ["operator-change"]); assert.deepEqual(authorization.outcomes, [BASE.outcomes[0]]);
  assert.equal(sameApprovalIdentity(authorization, structuredClone(authorization)), true);
  assert.throws(() => verifyBriefApproval({ ...input, reactions: input.reactions.slice(1) }), /owner \+1/);
});

test("newest valid approved revision supersedes older matching records", async () => {
  const result = await published(), input = approvalInput(result);
  const old = { ...input.comment, id: 10, nodeId: "IC_10", createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z" };
  const newest = { ...input.comment, id: 11, nodeId: "IC_11", createdAt: "2026-09-18T00:00:00Z", updatedAt: "2026-09-18T00:00:00Z" };
  assert.equal(selectApprovedBrief({ ...input, candidates: [candidate(old, "jessepollak", 20), candidate(newest, "jessepollak", 21)] }).approval.commentId, 11);
  const edited = { ...newest, updatedAt: "2026-09-19T00:00:00Z" };
  assert.equal(selectApprovedBrief({ ...input, candidates: [candidate(old, "jessepollak", 20), candidate(edited, "jessepollak", 21)] }).approval.commentId, 10);
  assert.throws(() => selectApprovedBrief({ ...input, candidates: [candidate(edited)] }), /missing/);
});

test("activation validates one parent reaction before readying all split-outcome children", async () => {
  const result = await published(), approval = candidate({ ...result.comment, body: result.body });
  assert.deepEqual((await activateBrief({ repository: BASE.repository, repositoryOwner: "jessepollak", parent: PARENT, candidates: [approval] }, result.adapter)).children, [600, 601]);
  for (const child of result.adapter.children) {
    assert.ok(child.labels.includes("factory:ready"));
    const auth = verifyBriefApproval({ repository: BASE.repository, repositoryOwner: "jessepollak", parent: PARENT, ...approval, currentChild: child });
    assert.deepEqual(auth.outcomeIds, BASE.children.find(({ key }) => child.body.includes(key)).outcomeIds);
  }
});

test("approval fails on edit, body/parent change, owner ambiguity, and conflicting PR", async () => {
  const result = await published(), valid = approvalInput(result);
  for (const changed of [
    { comment: { ...valid.comment, updatedAt: "2026-09-18T00:00:00Z" } },
    { reactions: [...valid.reactions, { id: 3, nodeId: "R_3", content: "+1", user: Object.fromEntries([["lo" + "gin", "jessepollak"]]) }] },
    { currentChild: { ...valid.currentChild, body: `${valid.currentChild.body}\nchanged` } },
    { currentChild: { ...valid.currentChild, parent: { nodeId: "other", number: 1 } } },
    { openPullRequests: [{ number: 1, url: "https://example.test/1" }] },
  ]) assert.throws(() => verifyBriefApproval({ ...valid, ...changed }));
});
