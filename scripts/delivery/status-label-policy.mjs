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

export function planStatusLabelChanges(eventName, payload) {
  if (!payload || typeof payload !== "object") throw new Error("event payload is required");

  if (eventName === "issues") {
    if (payload.action !== "closed" || payload.issue?.state !== "closed") {
      throw new Error("unsupported issues event");
    }
    return {
      issueNumber: assertIssueNumber(payload.issue.number),
      labelsToRemove: statusLabels(pullRequestLabels(payload.issue)),
      reason: "closed-record-cleanup",
    };
  }

  if (eventName !== "pull_request_target") throw new Error("unsupported metadata event");
  const pullRequest = payload.pull_request;
  if (!pullRequest) throw new Error("pull request payload is required");
  const issueNumber = assertIssueNumber(pullRequest.number);
  const labels = pullRequestLabels(pullRequest);

  if (payload.action === "closed" && pullRequest.state === "closed") {
    return {
      issueNumber,
      labelsToRemove: statusLabels(labels),
      reason: pullRequest.merged ? "merged-record-cleanup" : "closed-record-cleanup",
    };
  }

  if (!PR_GUARD_ACTIONS.has(payload.action)) throw new Error("unsupported pull request metadata action");
  if (isDirectMainDestination(pullRequest)) {
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

export const statusLabelPolicyConstants = Object.freeze({
  statusPrefix: STATUS_PREFIX,
});
