import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const BRIEF_SCHEMA = "home.factory-brief/v1";
export const PROPOSAL_SCHEMA = "home.factory-proposal/v1";
export const ROUTING_LABEL_PREFIXES = Object.freeze(["status:", "lane:", "priority:"]);
export const FACTORY_REPOSITORY = "jessepollak/home";
export const FACTORY_BRIEF_CHILD_LABEL = "factory:brief-child";
const FACTORY_MARKER = "<!-- factory -->";

export function labelNames(value) {
  if (!Array.isArray(value)) return [];
  return value.map((label) => typeof label === "string" ? label : label?.name).filter((label) => typeof label === "string" && label !== "");
}

export function childMarker(parent, key) {
  return `<!-- factory-brief-child:${parent.number}:${key} -->`;
}

// Routing labels drive factory authorization, so a current value that the approved spec does not
// contain is always a conflict. Unrelated labels (for example area:*) never conflict.
export function conflictingRoutingLabels(currentValues, approvedValues) {
  const approved = [...approvedValues];
  return labelNames(currentValues).filter((label) => ROUTING_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix)) && !approved.includes(label));
}

function exactFields(value, fields, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error(`${name} fields are invalid`);
  }
}

function text(value, name, max = 500) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || /[\0\r]/.test(value)) {
    throw new Error(`${name} must be concise text`);
  }
  return value.trim();
}

function identity(value, name, nullable = false) {
  exactFields(value, ["nodeId", "number"], name);
  if (nullable && value.nodeId === null && value.number === null) return { nodeId: null, number: null };
  if (typeof value.nodeId !== "string" || value.nodeId === "") throw new Error(`${name}.nodeId is required`);
  if (!Number.isSafeInteger(value.number) || value.number < 1) throw new Error(`${name}.number is invalid`);
  return { nodeId: value.nodeId, number: value.number };
}

function unique(values, name) {
  if (new Set(values).size !== values.length) throw new Error(`${name} must be unique`);
}

function labels(value, name) {
  if (!Array.isArray(value) || value.length < 3) throw new Error(`${name} are invalid`);
  const result = value.map((label) => text(label, name, 80));
  unique(result, name);
  if (result.includes("factory:ready")) throw new Error("brief publication must never add factory:ready");
  if (result.includes(FACTORY_BRIEF_CHILD_LABEL)) throw new Error(`${FACTORY_BRIEF_CHILD_LABEL} is publication-managed`);
  for (const prefix of ROUTING_LABEL_PREFIXES) {
    if (result.filter((label) => label.startsWith(prefix)).length !== 1) throw new Error(`${name} must have exactly one ${prefix} label`);
  }
  if (!result.includes("status:todo")) throw new Error(`${name} must start status:todo`);
  return result;
}

function exactHttpsUrl(value, name) {
  const rawUrl = text(value, name, 500);
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error(`${name} is invalid`); }
  if (rawUrl !== value || url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hostname === "" || url.href !== rawUrl) {
    throw new Error(`${name} must be an exact HTTPS URL without credentials`);
  }
  return rawUrl;
}

function designReferences(value, name, { allowMissing = false } = {}) {
  if (value === undefined && allowMissing) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error(`${name} must define 0–8 references`);
  const result = value.map((reference, index) => {
    const item = `${name}[${index}]`;
    const storybook = reference?.type === "storybook";
    exactFields(reference, storybook
      ? ["type", "label", "managerUrl", "canvasUrl", "commitSha", "deploymentId", "criteria"]
      : ["label", "url"], item);
    const label = text(reference.label, `${item}.label`, 120);
    if (/[\x00-\x1f\x7f]/.test(label)) throw new Error(`${item}.label must be single-line text`);
    if (!storybook) return { label, url: exactHttpsUrl(reference.url, `${item}.url`) };
    if (!/^[0-9a-f]{40}$/.test(reference.commitSha)) throw new Error(`${item}.commitSha must be a 40-hex commit SHA`);
    if (!/^dpl_[A-Za-z0-9]+$/.test(reference.deploymentId)) throw new Error(`${item}.deploymentId is invalid`);
    if (!Array.isArray(reference.criteria) || reference.criteria.length < 1 || reference.criteria.length > 8) {
      throw new Error(`${item}.criteria must define 1–8 observable criteria`);
    }
    const criteria = reference.criteria.map((criterion, criterionIndex) => {
      const result = text(criterion, `${item}.criteria[${criterionIndex}]`, 240);
      if (result !== criterion || /[\x00-\x1f\x7f]/.test(result)) throw new Error(`${item}.criteria must be concise single-line text`);
      return result;
    });
    unique(criteria, `${item}.criteria`);
    return {
      type: "storybook", label,
      managerUrl: exactHttpsUrl(reference.managerUrl, `${item}.managerUrl`),
      canvasUrl: exactHttpsUrl(reference.canvasUrl, `${item}.canvasUrl`),
      commitSha: reference.commitSha, deploymentId: reference.deploymentId, criteria,
    };
  });
  unique(result.flatMap((reference) => reference.type === "storybook" ? [reference.managerUrl, reference.canvasUrl] : [reference.url]), `${name} URLs`);
  return result;
}

function outcomes(value, name) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) throw new Error(`${name} must define 1–5 outcomes`);
  const result = value.map((outcome, index) => {
    exactFields(outcome, ["id", "text"], `${name}[${index}]`);
    const id = text(outcome.id, `${name}[${index}].id`, 64);
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`${name}[${index}].id is unstable`);
    return { id, text: text(outcome.text, `${name}[${index}].text`, 240) };
  });
  unique(result.map(({ id }) => id), `${name} IDs`);
  return result;
}

function completionEvidenceMap(value, children, name, { allowMissing = false } = {}) {
  if (value === undefined && allowMissing) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error(`${name} must define 1–20 child-outcome edges`);
  const result = value.map((entry, index) => {
    const item = `${name}[${index}]`;
    exactFields(entry, ["outcomeId", "childKey", "evidence"], item);
    const outcomeId = text(entry.outcomeId, `${item}.outcomeId`, 64);
    const childKey = text(entry.childKey, `${item}.childKey`, 64);
    if (!/^[a-z][a-z0-9-]*$/.test(outcomeId)) throw new Error(`${item}.outcomeId is unstable`);
    if (!/^[a-z][a-z0-9-]*$/.test(childKey)) throw new Error(`${item}.childKey is unstable`);
    const evidence = text(entry.evidence, `${item}.evidence`, 240);
    if (/[\x00-\x1f\x7f]/.test(evidence)) throw new Error(`${item}.evidence must be concise single-line text`);
    return { outcomeId, childKey, evidence };
  });
  const edgeIds = result.map(({ outcomeId, childKey }) => `${childKey}\0${outcomeId}`);
  unique(edgeIds, `${name} child-outcome edges`);
  const actualEdges = new Set(children.flatMap((child) => child.outcomeIds.map((outcomeId) => `${child.key}\0${outcomeId}`)));
  if (edgeIds.some((edge) => !actualEdges.has(edge))) throw new Error(`${name} entries must correspond to actual child-outcome edges`);
  if (edgeIds.length !== actualEdges.size || [...actualEdges].some((edge) => !edgeIds.includes(edge))) {
    throw new Error(`${name} must cover every child-outcome edge exactly once`);
  }
  return result;
}

function validateContract(input, published) {
  const legacyPublishedDesignReferences = published && input && typeof input === "object" && !Object.hasOwn(input, "designReferences");
  const legacyPublishedEvidenceMap = published && input && typeof input === "object" && !Object.hasOwn(input, "evidenceMap");
  exactFields(input, ["schema", "repository", "parent", ...(published ? [] : ["proposal"]), ...(legacyPublishedDesignReferences ? [] : ["designReferences"]), "outcomes", "children", ...(legacyPublishedEvidenceMap ? [] : ["evidenceMap"])], published ? "proposal manifest" : "brief");
  const schema = published ? PROPOSAL_SCHEMA : BRIEF_SCHEMA;
  if (input.schema !== schema) throw new Error(`schema must be ${schema}`);
  const repository = text(input.repository, "repository", 200);
  if (repository !== FACTORY_REPOSITORY) throw new Error(`repository must be ${FACTORY_REPOSITORY}`);
  const parent = identity(input.parent, "parent");
  // Compatibility: already-published v1 manifests predate structured design references. They
  // remain authorizable with an empty list; every newly validated brief must provide the field.
  const approvedDesignReferences = designReferences(input.designReferences, "designReferences", { allowMissing: legacyPublishedDesignReferences });
  const requiredOutcomes = outcomes(input.outcomes, "outcomes");
  const outcomeIds = new Set(requiredOutcomes.map(({ id }) => id));

  if (!Array.isArray(input.children) || input.children.length < 1 || input.children.length > 4) throw new Error("brief must define 1–4 children");
  const children = input.children.map((child, index) => {
    const name = `children[${index}]`;
    exactFields(child, published
      ? ["key", "nodeId", "number", "title", "bodySha256", "labels", "outcomeIds"]
      : ["key", "identity", "title", "body", "labels", "parent", "outcomeIds"], name);
    const key = text(child.key, `${name}.key`, 64);
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error(`${name}.key is unstable`);
    const mapped = Array.isArray(child.outcomeIds) ? [...child.outcomeIds] : [];
    if (mapped.length === 0 || mapped.some((id) => !outcomeIds.has(id))) throw new Error(`${name} maps invalid outcomes`);
    unique(mapped, `${name} outcome IDs`);
    const common = { key, title: text(child.title, `${name}.title`, 160), labels: labels(child.labels, `${name}.labels`), outcomeIds: mapped };
    if (published) {
      if (typeof child.nodeId !== "string" || child.nodeId === "" || !Number.isSafeInteger(child.number) || child.number < 1 || !/^[0-9a-f]{64}$/.test(child.bodySha256)) {
        throw new Error(`${name} identity is invalid`);
      }
      return { ...common, nodeId: child.nodeId, number: child.number, bodySha256: child.bodySha256 };
    }
    const childParent = identity(child.parent, `${name}.parent`);
    if (childParent.nodeId !== parent.nodeId || childParent.number !== parent.number) throw new Error(`${name} has the wrong parent`);
    const body = text(child.body, `${name}.body`, 12_000);
    if (body.includes("<!-- factory") || body.includes("<!-- hugo -->")) throw new Error(`${name}.body contains a reserved marker`);
    return { ...common, identity: identity(child.identity, `${name}.identity`, true), body, parent: childParent };
  });
  unique(children.map(({ key }) => key), "child keys");
  if (published) {
    unique(children.map(({ nodeId }) => nodeId), "child node IDs");
    unique(children.map(({ number }) => number), "child numbers");
  }
  if (requiredOutcomes.some(({ id }) => !children.some((child) => child.outcomeIds.includes(id)))) throw new Error("every outcome must map to a child");
  // Compatibility is deliberately field-presence based: old published v1 manifests without the
  // field authorize with no invented evidence, while any manifest that declares it is strict.
  const evidenceMap = completionEvidenceMap(input.evidenceMap, children, "evidenceMap", { allowMissing: legacyPublishedEvidenceMap });
  const userVisible = children.some((child) => child.labels.includes("lane:frontend") || child.labels.includes("lane:design"));
  if (!published && userVisible && approvedDesignReferences.length === 0) throw new Error("user-visible briefs require a structured design reference");

  let proposal;
  if (!published) {
    exactFields(input.proposal, ["outcome", "proposal", "boundary", "done", "decision", "delivery"], "proposal");
    proposal = Object.fromEntries(Object.entries(input.proposal).map(([key, value]) => [key, text(value, `proposal.${key}`, 600)]));
    if (Object.values(proposal).some((value) => value.includes(FACTORY_MARKER) || value.includes("```json factory-proposal"))) throw new Error("proposal text contains a reserved marker");
  }
  return { schema, repository, parent, ...(proposal ? { proposal } : {}), designReferences: approvedDesignReferences, outcomes: requiredOutcomes, children, evidenceMap };
}

export function bodySha256(body) {
  if (typeof body !== "string") throw new Error("child body is unavailable");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function validateBriefBundle(input) {
  return validateContract(input, false);
}

function publishedBody(child, parent) {
  return `${child.body.trim()}\n\n${childMarker(parent, child.key)}\n${FACTORY_MARKER}`;
}

function markdownTableValue(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replace(/\r?\n/g, "<br>")
    .replace(/[|`*_[\]<>]/g, (character) => `\\${character}`);
}

function renderDesignReference(reference) {
  if (reference.type !== "storybook") return [`- ${reference.label}: ${reference.url}`];
  return [
    `- **${markdownTableValue(reference.label)}** — Proposed — unreviewed design reference; factory evidence is not design approval`,
    `  - Immutable identity: commit \`${reference.commitSha}\`; deployment \`${reference.deploymentId}\``,
    `  - Manager: ${reference.managerUrl}`,
    `  - Canvas: ${reference.canvasUrl}`,
    "  - Observable criteria:",
    ...reference.criteria.map((criterion, index) => `    ${index + 1}. ${markdownTableValue(criterion)}`),
  ];
}

export function renderProposalComment(manifest, proposal) {
  const references = manifest.designReferences.length > 0
    ? ["", "Shaping references — not acceptance proof:", ...manifest.designReferences.flatMap(renderDesignReference)]
    : [];
  const evidenceRows = manifest.evidenceMap.map(({ outcomeId, childKey, evidence }) => {
    const outcome = manifest.outcomes.find(({ id }) => id === outcomeId);
    const child = manifest.children.find(({ key }) => key === childKey);
    return `| ${markdownTableValue(`${outcome.id} — ${outcome.text}`)} | ${markdownTableValue(`#${child.number} — ${child.title}`)} | ${markdownTableValue(evidence)} |`;
  });
  const evidenceTable = evidenceRows.length > 0 ? [
    "", "| Required outcome | Delivery child | Completion evidence |",
    "|---|---|---|", ...evidenceRows,
  ] : [];
  return [
    "## Outcome", proposal.outcome, "", "## Proposal", proposal.proposal,
    "", "## Boundary", proposal.boundary, "", "## Done", proposal.done, ...references,
    "", "## Decision", proposal.decision, "", "## Delivery", proposal.delivery, ...evidenceTable,
    "", "```json factory-proposal", JSON.stringify(manifest), "```", FACTORY_MARKER,
  ].join("\n");
}

export async function publishBrief(input, adapter) {
  const brief = validateBriefBundle(input);
  await adapter.verifyParent(brief.parent);
  const resolved = [];
  for (const spec of brief.children) {
    const body = publishedBody(spec, brief.parent);
    let issue;
    if (spec.identity.number !== null) {
      issue = await adapter.getIssue(spec.identity.number);
      if (issue?.nodeId !== spec.identity.nodeId) throw new Error(`mapped child ${spec.key} identity changed`);
    } else {
      const matches = await adapter.findChildrenByMarker(brief.parent, spec.key);
      if (!Array.isArray(matches) || matches.length > 1) throw new Error(`mapped child ${spec.key} is ambiguous`);
      issue = matches[0];
    }
    if (issue) {
      if (issue.title !== spec.title || issue.body !== body) throw new Error(`mapped child ${spec.key} does not match the exact spec`);
      if (labelNames(issue.labels).includes("factory:ready")) throw new Error("publish must not reuse a factory:ready child");
      const conflicts = conflictingRoutingLabels(issue.labels, spec.labels);
      if (conflicts.length > 0) throw new Error(`mapped child ${spec.key} has conflicting routing labels`);
    }
    resolved.push({ spec, body, issue });
  }
  for (const item of resolved) {
    item.issue ??= await adapter.createIssue({ title: item.spec.title, body: item.body, labels: [...item.spec.labels, FACTORY_BRIEF_CHILD_LABEL] });
    if (item.issue.title !== item.spec.title || item.issue.body !== item.body) throw new Error(`mapped child ${item.spec.key} does not match the exact spec`);
  }
  const publishedChildren = [];
  for (const { spec, body, issue } of resolved) {
    await adapter.attachNativeParent(issue, brief.parent);
    await adapter.ensureProjectMembership(issue);
    await adapter.ensureLabels(issue, [...spec.labels, FACTORY_BRIEF_CHILD_LABEL]);
    publishedChildren.push({ key: spec.key, nodeId: issue.nodeId, number: issue.number, title: spec.title, bodySha256: bodySha256(body), labels: spec.labels, outcomeIds: spec.outcomeIds });
  }
  const manifest = validateContract({ schema: PROPOSAL_SCHEMA, repository: brief.repository, parent: brief.parent, designReferences: brief.designReferences, outcomes: brief.outcomes, children: publishedChildren, evidenceMap: brief.evidenceMap }, true);
  const body = renderProposalComment(manifest, brief.proposal);
  const matches = await adapter.findParentCommentsByBody(brief.parent.number, body);
  if (!Array.isArray(matches) || matches.length > 1) throw new Error("proposal comment is ambiguous");
  const comment = matches[0] ?? await adapter.createParentComment(brief.parent.number, body);
  return { manifest, comment, body };
}

export function parseProposalComment(body) {
  if (typeof body !== "string" || !body.endsWith(`\n${FACTORY_MARKER}`)) throw new Error("proposal comment is not factory-marked");
  const matches = [...body.matchAll(/```json factory-proposal\n([^\n]+)\n```/g)];
  if (matches.length !== 1) throw new Error("proposal manifest is missing or ambiguous");
  let value;
  try { value = JSON.parse(matches[0][1]); } catch { throw new Error("proposal manifest is malformed"); }
  return validateContract(value, true);
}

function compareLabels(currentChild, spec, revalidation, readyMode) {
  const actual = labelNames(currentChild.labels);
  const base = spec.labels.map((label) => revalidation && label === "status:todo" ? "status:working" : label);
  if (conflictingRoutingLabels(actual, base).length > 0) throw new Error("current child labels changed from the approved spec");
  for (const prefix of ROUTING_LABEL_PREFIXES) {
    if (base.filter((label) => label.startsWith(prefix)).some((label) => !actual.includes(label))) {
      throw new Error("current child labels changed from the approved spec");
    }
  }
  if (readyMode === "required" && !actual.includes("factory:ready")) throw new Error("issue must have factory:ready");
}

export function verifyBriefApproval({ repository, repositoryOwner, parent, comment, reactions, currentChild, openPullRequests = [], revalidation = false, readyMode = "required" }) {
  const manifest = parseProposalComment(comment?.body);
  const currentParent = identity(parent, "current parent");
  if (manifest.repository !== repository || manifest.parent.nodeId !== currentParent.nodeId || manifest.parent.number !== currentParent.number) throw new Error("approval repository or parent changed");
  // Creation/update equality is only a tamper hint inside the explicitly accepted shared-account
  // trust model: owner reaction approval is deliberately not cryptographic authorship, and a
  // compromised owner account could still revise an edited comment. The check only fails closed
  // on an edit that GitHub itself records.
  if (!comment?.id || !comment?.nodeId || comment.createdAt !== comment.updatedAt) throw new Error("proposal comment was edited or has no stable identity");
  const ownerThumbs = (reactions ?? []).filter((reaction) => reaction?.content === "+1" && reaction?.user?.login === repositoryOwner);
  if (ownerThumbs.length !== 1 || !ownerThumbs[0].id || !ownerThumbs[0].nodeId) throw new Error("exact owner +1 approval is unavailable or ambiguous");
  if (openPullRequests.length > 0) throw new Error("issue already has a conflicting open pull request");
  const selected = manifest.children.filter((child) => child.number === currentChild?.number && child.nodeId === currentChild?.nodeId);
  if (selected.length !== 1) throw new Error("current child is not selected exactly once");
  const spec = selected[0];
  if (currentChild.parent?.number !== manifest.parent.number || currentChild.parent?.nodeId !== manifest.parent.nodeId) throw new Error("current child native parent changed");
  if (currentChild.title !== spec.title || bodySha256(currentChild.body) !== spec.bodySha256) throw new Error("current child title or body changed");
  if (currentChild.state !== "OPEN") throw new Error("issue must be OPEN");
  compareLabels(currentChild, spec, revalidation, readyMode);
  const selectedOutcomes = manifest.outcomes.filter(({ id }) => spec.outcomeIds.includes(id));
  return Object.freeze({
    route: "approved-factory-brief/v1", repository, parent: manifest.parent,
    approval: Object.freeze({
      source: "github-issue-comment-owner-plus-one/v1", state: "active",
      commentId: comment.id, commentNodeId: comment.nodeId, proposalBodySha256: bodySha256(comment.body),
      reactionId: ownerThumbs[0].id, reactionNodeId: ownerThumbs[0].nodeId,
      revocation: Object.freeze({ action: "remove-reaction", contract: "removing this exact owner +1 reaction revokes authorization on mechanical revalidation" }),
    }),
    child: Object.freeze({ nodeId: currentChild.nodeId, number: currentChild.number, title: spec.title, body: currentChild.body, bodySha256: spec.bodySha256 }),
    designReferences: Object.freeze(manifest.designReferences.map((value) => Object.freeze({ ...value, ...(value.criteria ? { criteria: Object.freeze([...value.criteria]) } : {}) }))),
    outcomes: Object.freeze(selectedOutcomes.map((value) => Object.freeze({ ...value }))), outcomeIds: Object.freeze([...spec.outcomeIds]),
    evidenceMap: Object.freeze(manifest.evidenceMap.filter(({ childKey }) => childKey === spec.key).map((value) => Object.freeze({ ...value }))),
  });
}

function newestFirst(left, right) {
  const time = String(right.comment.createdAt).localeCompare(String(left.comment.createdAt));
  return time || String(right.comment.id).localeCompare(String(left.comment.id), undefined, { numeric: true });
}

export function selectApprovedBrief({ candidates, ...input }) {
  const valid = [];
  for (const candidate of candidates ?? []) {
    try { valid.push({ candidate, authorization: verifyBriefApproval({ ...input, ...candidate }) }); } catch {}
  }
  valid.sort((left, right) => newestFirst(left.candidate, right.candidate));
  if (valid.length === 0) throw new Error("approved proposal comment is missing");
  return valid[0].authorization;
}

export async function activateBrief({ repository, repositoryOwner, parent, candidates }, adapter) {
  const valid = [];
  for (const candidate of candidates ?? []) {
    try {
      const manifest = parseProposalComment(candidate.comment.body);
      const children = [];
      for (const spec of manifest.children) {
        const child = await adapter.getIssue(spec.number);
        verifyBriefApproval({ repository, repositoryOwner, parent, ...candidate, currentChild: child, readyMode: "optional" });
        children.push(child);
      }
      valid.push({ candidate, manifest, children });
    } catch {}
  }
  valid.sort((left, right) => newestFirst(left.candidate, right.candidate));
  if (valid.length === 0) throw new Error("approved proposal comment is missing");
  const selected = valid[0];
  for (const child of selected.children) {
    const names = child.labels.map((label) => typeof label === "string" ? label : label.name);
    if (!names.includes("factory:ready")) await adapter.addReadyLabel(child.number);
  }
  for (const spec of selected.manifest.children) {
    verifyBriefApproval({ repository, repositoryOwner, parent, ...selected.candidate, currentChild: await adapter.getIssue(spec.number) });
  }
  return { commentId: selected.candidate.comment.id, children: selected.manifest.children.map(({ number }) => number) };
}

export function sameApprovalIdentity(expected, actual) {
  if (expected?.route !== "approved-factory-brief/v1" || actual?.route !== expected.route) return false;
  // The authorization returned by verifyBriefApproval can only be active. A missing exact reaction
  // is the mechanically revalidated revoked state and throws before an authorization is returned.
  return isDeepStrictEqual(expected, actual);
}
