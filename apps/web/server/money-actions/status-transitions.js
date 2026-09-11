export function canReleaseMoneyActionAdmission(record) {
  return ["submitting", "submitted", "included", "unknown"].includes(record.status);
}

export function canTransitionMoneyActionStatus(record, to, constraints) {
  const from = record.status;
  if (constraints?.expectedSourceStatus && from !== constraints.expectedSourceStatus) {
    return false;
  }
  if (
    constraints?.requireNoSubmissionReference &&
    (record.submissionId || record.transactionHash || record.userOperationHash)
  ) return false;
  if (from === to) return true;
  if (["confirmed", "rejected", "expired", "failed"].includes(from)) return false;
  if (to === "prepared" || to === "submitting") return false;
  if (["submitting", "submitted", "unknown"].includes(from) && ["included", "confirmed"].includes(to)) {
    return true;
  }
  if (from === "submitted" && to === "unknown") return true;
  if (from === "unknown" && to === "submitted") return true;
  const rank = { submitted: 1, included: 2, confirmed: 3 };
  if (rank[from] !== undefined && rank[to] !== undefined) {
    return rank[to] >= rank[from];
  }
  return ["rejected", "expired", "failed", "unknown"].includes(to);
}
