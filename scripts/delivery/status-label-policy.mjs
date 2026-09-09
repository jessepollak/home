import {
  deliveryDestinationConstants,
  isDirectMainDestination,
  pullRequestLabels,
} from "./destination-policy.mjs";

const STATUS_PREFIX = "status:";
const PR_GUARD_ACTIONS = new Set([
  "opened",
  "reopened",
  "edited",
  "labeled",
  "unlabeled",
  "converted_to_draft",
  "ready_for_review",
]);

function assertIssueNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("unsafe issue number");
  return value;
}

function statusLabels(labels) {
  return labels.filter((label) => label.startsWith(STATUS_PREFIX));
}

export function validateMetadataEvent(eventName, payload) {
  if (!payload || typeof payload !== "object") throw new Error("event payload is required");

  if (eventName === "issues") {
    if (payload.action !== "closed" || payload.issue?.state !== "closed") {
      throw new Error("unsupported issues event");
    }
    return {
      action: payload.action,
      issueNumber: assertIssueNumber(payload.issue.number),
      recordKind: "issue",
    };
  }

  if (eventName !== "pull_request_target") throw new Error("unsupported metadata event");
  const pullRequest = payload.pull_request;
  if (!pullRequest) throw new Error("pull request payload is required");
  const issueNumber = assertIssueNumber(pullRequest.number);

  if (payload.action === "closed") {
    if (pullRequest.state !== "closed") throw new Error("unsupported pull request metadata action");
  } else if (!PR_GUARD_ACTIONS.has(payload.action)) {
    throw new Error("unsupported pull request metadata action");
  }

  return {
    action: payload.action,
    issueNumber,
    recordKind: "pull-request",
  };
}

export function planCurrentStatusLabelChanges(eventName, action, record) {
  if (!record || typeof record !== "object") throw new Error("current record is required");
  const issueNumber = assertIssueNumber(record.number);
  const labels = pullRequestLabels(record);

  if (eventName === "issues") {
    if (action !== "closed") throw new Error("unsupported issues event");
    if (record.state !== "open" && record.state !== "closed") throw new Error("unsafe issue state");
    if (record.state === "open") {
      return { issueNumber, labelsToRemove: [], reason: "current-record-open" };
    }
    return {
      issueNumber,
      labelsToRemove: statusLabels(labels),
      reason: "closed-record-cleanup",
    };
  }

  if (eventName !== "pull_request_target") throw new Error("unsupported metadata event");
  if (action !== "closed" && !PR_GUARD_ACTIONS.has(action)) {
    throw new Error("unsupported pull request metadata action");
  }

  if (record.state === "closed") {
    return {
      issueNumber,
      labelsToRemove: statusLabels(labels),
      reason: record.merged ? "merged-record-cleanup" : "closed-record-cleanup",
    };
  }

  if (record.state !== "open") throw new Error("unsafe pull request state");
  if (action === "closed") {
    return { issueNumber, labelsToRemove: [], reason: "current-record-open" };
  }
  if (record.draft === true) {
    return {
      issueNumber,
      labelsToRemove: labels.filter((label) =>
        deliveryDestinationConstants.promotionLabels.includes(label)
      ),
      reason: "draft-promotion-guard",
    };
  }
  if (isDirectMainDestination(record)) {
    return { issueNumber, labelsToRemove: [], reason: "direct-main" };
  }

  return {
    issueNumber,
    labelsToRemove: labels.filter((label) =>
      deliveryDestinationConstants.promotionLabels.includes(label)
    ),
    reason: "non-main-promotion-guard",
  };
}

export function planStatusLabelChanges(eventName, payload) {
  const event = validateMetadataEvent(eventName, payload);
  const record = event.recordKind === "issue" ? payload.issue : payload.pull_request;
  return planCurrentStatusLabelChanges(eventName, event.action, record);
}

export const statusLabelPolicyConstants = Object.freeze({
  statusPrefix: STATUS_PREFIX,
});
