const MAIN_BRANCH = "main";
const STACKED_LABEL = "delivery:stacked";
const PROMOTION_LABELS = new Set([
  "status:ready-for-review",
  "status:needs-jesse",
]);

function assertSafeRef(value, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    !/^[A-Za-z0-9._/-]+$/.test(value) ||
    value.includes("..") ||
    value.startsWith("/") ||
    value.endsWith("/")
  ) {
    throw new Error(`unsafe ${field}`);
  }
  return value;
}

function labelName(label) {
  const value = typeof label === "string" ? label : label?.name;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("unsafe label name");
  }
  return value;
}

export function pullRequestLabels(pullRequest) {
  if (!Array.isArray(pullRequest?.labels)) throw new Error("pull request labels are required");
  return pullRequest.labels.map(labelName);
}

export function evaluatePullRequestDestination(pullRequest) {
  if (!pullRequest || typeof pullRequest !== "object") throw new Error("pull request is required");
  const baseRef = assertSafeRef(pullRequest.base?.ref, "base ref");
  const labels = pullRequestLabels(pullRequest);
  const isStacked = labels.includes(STACKED_LABEL);
  const promotionLabels = labels.filter((label) => PROMOTION_LABELS.has(label));

  if (baseRef === MAIN_BRANCH && !isStacked) {
    return {
      allowed: true,
      mode: "main",
      baseRef,
      promotionLabels,
      message: "Pull request targets main.",
    };
  }

  if (baseRef === MAIN_BRANCH && isStacked) {
    return {
      allowed: false,
      mode: "invalid",
      baseRef,
      promotionLabels,
      message: `Remove ${STACKED_LABEL} after retargeting the pull request to main.`,
    };
  }

  if (!isStacked) {
    return {
      allowed: false,
      mode: "invalid",
      baseRef,
      promotionLabels,
      message: `Pull request targets ${baseRef}; retarget it to main or apply the reviewed ${STACKED_LABEL} exception.`,
    };
  }

  if (promotionLabels.length > 0) {
    return {
      allowed: false,
      mode: "invalid",
      baseRef,
      promotionLabels,
      message: `Stacked pull requests cannot carry delivery promotion labels: ${promotionLabels.join(", ")}.`,
    };
  }

  return {
    allowed: true,
    mode: "stacked",
    baseRef,
    promotionLabels,
    message: `Stacked pull request targets ${baseRef}; it is an intermediate change and is not delivered to main.`,
  };
}

export function isDirectMainDestination(pullRequest) {
  const result = evaluatePullRequestDestination(pullRequest);
  return result.allowed && result.mode === "main";
}

export const deliveryDestinationConstants = Object.freeze({
  mainBranch: MAIN_BRANCH,
  stackedLabel: STACKED_LABEL,
  promotionLabels: Object.freeze([...PROMOTION_LABELS]),
});
