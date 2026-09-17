import assert from "node:assert/strict";
import test from "node:test";
import { activateBrief, bodySha256, FACTORY_BRIEF_CHILD_LABEL, parseProposalComment, publishBrief, sameApprovalIdentity, selectApprovedBrief, validateBriefBundle, verifyBriefApproval } from "../factory-brief-policy.mjs";

const PARENT = { nodeId: "I_parent", number: 568 };
const STORYBOOK_REFERENCE = {
  type: "storybook",
  label: "Account settings scenarios",
  managerUrl: "https://storybook.example.test/?path=/docs/account-settings--docs",
  canvasUrl: "https://storybook.example.test/iframe.html?id=account-settings--default&viewMode=story",
  commitSha: "a".repeat(40),
  deploymentId: "dpl_AbCd1234",
  criteria: ["Name field is visible and editable.", "Saved colors are visible in the preview."],
};
const BASE = {
  schema: "home.factory-brief/v1", repository: "jessepollak/home", parent: PARENT,
  proposal: {
    outcome: "Authenticated operator changes Home name/colors, sees it in customer app, retains it across an update.",
    proposal: "Add bounded name and color configuration.", boundary: "Name and colors only; arbitrary CSS and layout excluded.",
    done: "The mapped outcomes are met with the evidence required by each child body.",
    decision: "Approve these exact children and outcomes.", delivery: "Two exact implementation children.",
  },
  designReferences: [
    { label: "Base account settings reference", url: "https://base.org/account/settings" },
  ],
  outcomes: [
    { id: "operator-change", text: "Authenticated operator changes Home name/colors." },
    { id: "customer-visible", text: "The customer app shows the change and retains it across an update." },
  ],
  children: [
    { key: "operator-config", identity: { nodeId: null, number: null }, title: "Add bounded operator branding controls", body: "Implement controls. Validate with the references and evidence named in this approved prose.", labels: ["status:todo", "lane:frontend", "priority:p1"], parent: PARENT, outcomeIds: ["operator-change"] },
    { key: "customer-branding", identity: { nodeId: null, number: null }, title: "Render retained customer branding", body: "Render and retain the configured branding.", labels: ["status:todo", "lane:frontend", "priority:p1"], parent: PARENT, outcomeIds: ["customer-visible"] },
  ],
  evidenceMap: [
    { outcomeId: "operator-change", childKey: "operator-config", evidence: "Focused tests and operator-flow browser proof show the saved configuration." },
    { outcomeId: "customer-visible", childKey: "customer-branding", evidence: "Current-head browser proof shows the retained branding in the customer app." },
  ],
};

function memoryAdapter({ failCreateOnce = false } = {}) {
  const children = [], comments = [], labelMutations = [];
  let failed = false;
  return {
    children, comments, labelMutations,
    async getIssue(number) { return children.find((child) => child.number === number); },
    async verifyParent() {},
    async findChildrenByMarker(parent, key) { return children.filter((child) => child.body.includes(`factory-brief-child:${parent.number}:${key}`)); },
    async createIssue(issue) {
      if (failCreateOnce && children.length === 1 && !failed) { failed = true; throw new Error("interrupted"); }
      const child = { ...issue, nodeId: `I_child_${children.length + 1}`, number: 600 + children.length, state: "OPEN", parent: null };
      children.push(child); return child;
    },
    async attachNativeParent(issue, parent) { issue.parent = { ...parent }; }, async ensureProjectMembership() {},
    async ensureLabels(issue, labels) {
      const missing = labels.filter((label) => !issue.labels.includes(label));
      if (missing.length > 0) labelMutations.push({ number: issue.number, added: missing });
      issue.labels.push(...missing);
    },
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

test("lean brief validates six proposal fields, 1–5 outcomes, exact mapped child specs, and completion evidence", () => {
  assert.deepEqual(Object.keys(validateBriefBundle(structuredClone(BASE))), ["schema", "repository", "parent", "proposal", "designReferences", "outcomes", "children", "evidenceMap"]);
  const one = structuredClone(BASE); one.outcomes = [one.outcomes[0]]; one.children = [one.children[0]]; one.evidenceMap = [one.evidenceMap[0]];
  assert.equal(validateBriefBundle(one).outcomes.length, 1);
  for (const mutate of [
    (brief) => { brief.repository = "someone/else"; }, (brief) => { brief.baseCommit = "a".repeat(40); }, (brief) => { brief.designRefs = []; },
    (brief) => { delete brief.designReferences; }, (brief) => { brief.designReferences = [{ label: "insecure", url: "http://example.test/reference" }]; },
    (brief) => { brief.designReferences = []; }, (brief) => { brief.designReferences = [{ label: "extra", url: "https://example.test/reference", type: "mock" }]; },
    (brief) => { brief.children[0].evidenceKinds = ["test"]; }, (brief) => { brief.children[0].labels.push("factory:ready"); },
    (brief) => { brief.children[0].outcomeIds = ["unknown"]; }, (brief) => { brief.children[0].parent = { nodeId: "other", number: 1 }; },
    (brief) => { brief.evidenceMap[0].evidence = "line one\nline two"; },
  ]) { const brief = structuredClone(BASE); mutate(brief); assert.throws(() => validateBriefBundle(brief)); }
});

test("Storybook design references validate an exact immutable deployment and reject partial or malformed objects", () => {
  const enhanced = structuredClone(BASE);
  enhanced.designReferences = [structuredClone(STORYBOOK_REFERENCE)];
  assert.deepEqual(validateBriefBundle(enhanced).designReferences, [STORYBOOK_REFERENCE]);

  const mutations = [
    (reference) => { delete reference.canvasUrl; },
    (reference) => { reference.url = reference.managerUrl; },
    (reference) => { reference.managerUrl = "http://storybook.example.test/"; },
    (reference) => { reference.canvasUrl += " "; },
    (reference) => { reference.commitSha = "A".repeat(40); },
    (reference) => { reference.deploymentId = "deployment_123"; },
    (reference) => { reference.criteria = []; },
    (reference) => { reference.criteria = Array.from({ length: 9 }, (_, index) => `Criterion ${index}`); },
    (reference) => { reference.criteria = ["line one\nline two"]; },
    (reference) => { reference.criteria = ["duplicate", "duplicate"]; },
  ];
  for (const mutate of mutations) {
    const malformed = structuredClone(enhanced);
    mutate(malformed.designReferences[0]);
    assert.throws(() => validateBriefBundle(malformed));
  }
});

test("publication renders and authorizes the unchanged Storybook identity, links, criteria, and unreviewed status", async () => {
  const brief = structuredClone(BASE);
  brief.designReferences = [structuredClone(STORYBOOK_REFERENCE)];
  const adapter = memoryAdapter();
  const result = await publishBrief(brief, adapter);
  assert.deepEqual(result.manifest.designReferences, [STORYBOOK_REFERENCE]);
  assert.match(result.body, /Proposed — unreviewed design reference; factory evidence is not design approval/);
  assert.match(result.body, new RegExp(STORYBOOK_REFERENCE.commitSha));
  assert.match(result.body, new RegExp(STORYBOOK_REFERENCE.deploymentId));
  assert.ok(result.body.includes(STORYBOOK_REFERENCE.managerUrl));
  assert.ok(result.body.includes(STORYBOOK_REFERENCE.canvasUrl));
  assert.match(result.body, /1\. Name field is visible and editable\./);

  const authorization = verifyBriefApproval(approvalInput({ ...result, adapter }));
  assert.deepEqual(authorization.designReferences, [STORYBOOK_REFERENCE]);
});

test("publication verifies the exact parent before creating children", async () => {
  const adapter = memoryAdapter();
  adapter.verifyParent = async () => { throw new Error("brief parent identity changed"); };
  await assert.rejects(publishBrief(structuredClone(BASE), adapter), /parent identity changed/);
  assert.equal(adapter.children.length, 0);
  assert.equal(adapter.comments.length, 0);
});

test("publication is safely rerunnable after a partial failure and reuses its exact proposal comment", async () => {
  const adapter = memoryAdapter({ failCreateOnce: true });
  await assert.rejects(publishBrief(structuredClone(BASE), adapter), /interrupted/); assert.equal(adapter.children.length, 1);
  const first = await publishBrief(structuredClone(BASE), adapter); const second = await publishBrief(structuredClone(BASE), adapter);
  assert.equal(adapter.children.length, 2); assert.equal(adapter.comments.length, 1); assert.equal(second.comment.id, first.comment.id);
  assert.ok(adapter.children.every((child) => child.labels.includes(FACTORY_BRIEF_CHILD_LABEL)));
  assert.ok(adapter.children.every((child) => !child.labels.includes("factory:ready")));
  assert.deepEqual(Object.keys(parseProposalComment(first.body)), ["schema", "repository", "parent", "designReferences", "outcomes", "children", "evidenceMap"]);
  assert.deepEqual(first.manifest.designReferences, BASE.designReferences);
  assert.deepEqual(first.manifest.evidenceMap, BASE.evidenceMap);
  assert.match(first.body, /Shaping references — not acceptance proof:/);
  assert.match(first.body, /\| operator-change — Authenticated operator changes Home name\/colors\. \| #600 — Add bounded operator branding controls \| Focused tests and operator-flow browser proof show the saved configuration\. \|/);
  assert.equal(first.manifest.children[0].bodySha256, bodySha256(adapter.children[0].body));
});

test("completion evidence maps reject missing, extra, duplicate, and wrong child-outcome edges", () => {
  const cases = [
    ["missing map", (brief) => { delete brief.evidenceMap; }, /brief fields are invalid/],
    ["missing edge", (brief) => { brief.evidenceMap.pop(); }, /cover every child-outcome edge exactly once/],
    ["extra", (brief) => { brief.evidenceMap.push({ outcomeId: "unknown", childKey: "operator-config", evidence: "Extra evidence." }); }, /actual child-outcome edges/],
    ["duplicate", (brief) => { brief.evidenceMap[1] = { ...brief.evidenceMap[0] }; }, /child-outcome edges must be unique/],
    ["wrong edge", (brief) => { brief.evidenceMap[0].childKey = "customer-branding"; }, /actual child-outcome edges/],
  ];
  for (const [name, mutate, error] of cases) {
    const brief = structuredClone(BASE);
    mutate(brief);
    assert.throws(() => validateBriefBundle(brief), error, name);
  }
});

test("published Delivery evidence table resolves issue identities and safely escapes Markdown", async () => {
  const brief = structuredClone(BASE);
  brief.outcomes[0].text = "Operator changes Home | safely.";
  brief.children[0].title = "Add [bounded] | controls";
  brief.evidenceMap[0].evidence = "Focused test | current-head proof.";
  const result = await publishBrief(brief, memoryAdapter());

  assert.ok(result.body.includes("#600 — Add \\[bounded\\] \\| controls"));
  assert.ok(result.body.includes("Operator changes Home \\| safely."));
  assert.ok(result.body.includes("Focused test \\| current-head proof."));
  assert.ok(result.body.indexOf("| Required outcome | Delivery child | Completion evidence |") < result.body.indexOf("```json factory-proposal"));
});

test("legacy v1 proposal manifests remain parseable with explicit empty compatibility fields", async () => {
  const result = await published();
  for (const omitted of [["evidenceMap"], ["designReferences"], ["designReferences", "evidenceMap"]]) {
    const legacy = structuredClone(result.manifest);
    for (const field of omitted) delete legacy[field];
    const body = result.body.replace(JSON.stringify(result.manifest), JSON.stringify(legacy));
    const parsed = parseProposalComment(body);
    assert.deepEqual(parsed.designReferences, omitted.includes("designReferences") ? [] : BASE.designReferences);
    assert.deepEqual(parsed.evidenceMap, omitted.includes("evidenceMap") ? [] : BASE.evidenceMap);
  }
});

test("approval ignores non-owner thumbs, maps only its child outcomes, and revocation defeats stale ready", async () => {
  const result = await published(), input = approvalInput(result);
  input.reactions.push({ id: 93, nodeId: "R_93", content: "+1", user: Object.fromEntries([["lo" + "gin", "other"]]) });
  const authorization = verifyBriefApproval(input);
  assert.deepEqual(authorization.outcomeIds, ["operator-change"]); assert.deepEqual(authorization.outcomes, [BASE.outcomes[0]]);
  assert.deepEqual(authorization.designReferences, BASE.designReferences);
  assert.deepEqual(authorization.evidenceMap, [BASE.evidenceMap[0]]);
  assert.deepEqual(authorization.approval, {
    source: "github-issue-comment-owner-plus-one/v1", state: "active",
    commentId: result.comment.id, commentNodeId: result.comment.nodeId,
    proposalBodySha256: bodySha256(result.body), reactionId: 92, reactionNodeId: "R_92",
    revocation: { action: "remove-reaction", contract: "removing this exact owner +1 reaction revokes authorization on mechanical revalidation" },
  });
  assert.equal(sameApprovalIdentity(authorization, structuredClone(authorization)), true);
  for (const mutate of [
    (value) => { value.approval.state = "revoked"; },
    (value) => { value.approval.source = "other"; },
    (value) => { value.approval.proposalBodySha256 = "0".repeat(64); },
    (value) => { value.approval.revocation.action = "other"; },
    (value) => { value.child.title = "changed"; },
    (value) => { value.designReferences[0].url = "https://example.test/changed"; },
    (value) => { value.outcomes[0].text = "Changed"; },
    (value) => { value.evidenceMap[0].evidence = "Changed"; },
  ]) {
    const changed = structuredClone(authorization);
    mutate(changed);
    assert.equal(sameApprovalIdentity(authorization, changed), false);
  }
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
    assert.deepEqual(auth.outcomeIds, BASE.children.find(({ key }) => child.body.includes(`factory-brief-child:${PARENT.number}:${key}`)).outcomeIds);
  }
});

test("child markers are namespaced by parent so two briefs may reuse the same child key", async () => {
  const adapter = memoryAdapter();
  const first = await publishBrief(structuredClone(BASE), adapter);
  const otherParent = { nodeId: "I_parent_other", number: 584 };
  const secondBrief = structuredClone(BASE);
  secondBrief.parent = otherParent;
  for (const child of secondBrief.children) child.parent = otherParent;
  const second = await publishBrief(secondBrief, adapter);

  assert.equal(adapter.children.length, 4);
  assert.deepEqual(second.manifest.children.map(({ number }) => number), [602, 603]);
  assert.ok(adapter.children[0].body.includes(`<!-- factory-brief-child:568:${BASE.children[0].key} -->`));
  assert.ok(adapter.children[2].body.includes(`<!-- factory-brief-child:584:${BASE.children[0].key} -->`));
  assert.deepEqual(first.manifest.children.map(({ number }) => number), [600, 601]);

  await publishBrief(structuredClone(BASE), adapter);
  await publishBrief(secondBrief, adapter);
  assert.equal(adapter.children.length, 4);
  assert.equal(adapter.comments.length, 2);
});

test("publication reuses an exactly pre-mapped child without creating a duplicate", async () => {
  const first = await published();
  const mapped = first.adapter.children[0];
  const adapter = memoryAdapter();
  adapter.children.push({ ...structuredClone(mapped), labels: [...mapped.labels] });
  const brief = structuredClone(BASE);
  brief.children[0].identity = { nodeId: mapped.nodeId, number: mapped.number };

  const result = await publishBrief(brief, adapter);
  assert.equal(adapter.children.length, 2);
  assert.equal(adapter.children.filter(({ nodeId }) => nodeId === mapped.nodeId).length, 1);
  assert.equal(result.manifest.children[0].nodeId, mapped.nodeId);
  assert.equal(result.manifest.children[0].bodySha256, bodySha256(mapped.body));

  const changed = structuredClone(brief);
  changed.children[0].identity.nodeId = "I_changed";
  await assert.rejects(publishBrief(changed, adapter), /identity changed/);
});

test("publication preserves unrelated labels and fails closed on conflicting routing labels", async () => {
  const first = await published();
  const mapped = first.adapter.children[0];
  const adapter = memoryAdapter();
  adapter.children.push({ ...structuredClone(mapped), labels: ["status:todo", "lane:frontend", "area:settings"] });
  const brief = structuredClone(BASE);
  brief.children[0].identity = { nodeId: mapped.nodeId, number: mapped.number };

  await publishBrief(brief, adapter);
  assert.deepEqual(adapter.children[0].labels, ["status:todo", "lane:frontend", "area:settings", "priority:p1", FACTORY_BRIEF_CHILD_LABEL]);
  assert.deepEqual(adapter.labelMutations, [{ number: mapped.number, added: ["priority:p1", FACTORY_BRIEF_CHILD_LABEL] }]);

  const conflicting = memoryAdapter();
  conflicting.children.push({ ...structuredClone(mapped), labels: ["status:todo", "lane:backend", "priority:p1"] });
  await assert.rejects(publishBrief(structuredClone(brief), conflicting), /conflicting routing labels/);
  assert.deepEqual(conflicting.labelMutations, []);

  const ready = memoryAdapter();
  ready.children.push({ ...structuredClone(mapped), labels: [...mapped.labels, "factory:ready"] });
  await assert.rejects(publishBrief(structuredClone(brief), ready), /factory:ready/);
  assert.deepEqual(ready.labelMutations, []);
});

test("activation tolerates unrelated labels but requires the approved routing labels", async () => {
  const result = await published();
  const approval = candidate({ ...result.comment, body: result.body });
  for (const child of result.adapter.children) child.labels.push("area:settings");

  const input = { repository: BASE.repository, repositoryOwner: "jessepollak", parent: PARENT, candidates: [approval] };
  assert.deepEqual((await activateBrief(input, result.adapter)).children, [600, 601]);
  for (const child of result.adapter.children) assert.ok(child.labels.includes("area:settings"));

  const changed = ["factory:ready", "status:working", "lane:frontend", "priority:p1"];
  result.adapter.children[0].labels = [...changed];
  await assert.rejects(activateBrief(input, result.adapter), /approved proposal comment is missing/);
  assert.deepEqual(result.adapter.children[0].labels, changed);
  assert.equal(result.adapter.children[1].labels.includes("factory:ready"), true);
});

test("activation after reaction removal rejects and never readies children", async () => {
  const result = await published();
  const removed = { comment: { ...result.comment, body: result.body }, reactions: [] };
  const nonOwner = { comment: { ...result.comment, body: result.body }, reactions: [{ id: 94, nodeId: "R_94", content: "+1", user: Object.fromEntries([["lo" + "gin", "other"]]) }] };
  for (const candidateInput of [removed, nonOwner]) {
    await assert.rejects(activateBrief({ repository: BASE.repository, repositoryOwner: "jessepollak", parent: PARENT, candidates: [candidateInput] }, result.adapter), /approved proposal comment is missing/);
  }
  assert.equal(result.adapter.children.some((child) => child.labels.includes("factory:ready")), false);
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
