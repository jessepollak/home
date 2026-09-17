const REQUIRED_LABELS = ["factory:ready", "status:todo"];
const GENERATED_BODY_MARKERS = ["<!-- factory -->", "<!-- hugo -->"];
const MAX_FIX_LOOPS = 2;

function labelNames(issue) {
  if (!Array.isArray(issue?.labels)) return [];
  return issue.labels.map((label) => typeof label === "string" ? label : label?.name).filter(Boolean);
}

export function evaluateFactoryRunEligibility(issue, openPullRequests = [], repositoryOwner, authorizationRoute = "legacy-human-body/v1") {
  const failures = [];
  if (!issue || typeof issue !== "object") failures.push("issue is unavailable");
  if (issue?.state !== "OPEN") failures.push("issue must be OPEN");
  if (typeof repositoryOwner !== "string" || repositoryOwner === "") {
    failures.push("repository owner is unavailable");
  } else if (authorizationRoute === "legacy-human-body/v1" && issue?.author?.login !== repositoryOwner) {
    failures.push("issue must be authored by the repository owner");
  }
  if (authorizationRoute === "legacy-human-body/v1" && typeof issue?.body === "string" && GENERATED_BODY_MARKERS.some((marker) => issue.body.includes(marker))) {
    failures.push("issue body must not contain a generated-text marker");
  }
  if (!["legacy-human-body/v1", "approved-factory-brief/v1"].includes(authorizationRoute)) failures.push("authorization route is invalid");

  const names = labelNames(issue);
  const labels = new Set(names);
  for (const label of REQUIRED_LABELS) {
    if (!labels.has(label)) failures.push(`issue must have ${label}`);
  }
  for (const [prefix, expected] of [["status:", "status:todo"], ["lane:", null], ["priority:", null]]) {
    const matching = names.filter((label) => label.startsWith(prefix));
    if (matching.length !== 1 || (expected && matching[0] !== expected)) {
      failures.push(`issue must have exactly one ${prefix} label${expected ? ` (${expected})` : ""}`);
    }
  }
  if (openPullRequests.length > 0) failures.push("issue already has an open pull request");

  return { eligible: failures.length === 0, failures };
}

export function openPullRequestsFromTimelinePages(pages) {
  if (!Array.isArray(pages)) throw new Error("issue timeline is unavailable");
  const events = pages.length > 0 && Array.isArray(pages[0]) ? pages.flat() : pages;
  const pulls = events
    .filter((event) => event?.event === "cross-referenced")
    .map((event) => event?.source?.issue)
    .filter((issue) => issue?.pull_request && String(issue.state).toLowerCase() === "open")
    .map((issue) => ({ number: issue.number, url: issue.html_url }));
  return [...new Map(pulls.map((pull) => [pull.number, pull])).values()];
}

const WORKER_BROWSER_EVIDENCE_FIELDS = Object.freeze([
  "mode",
  "route",
  "viewport",
  "exercisedPath",
  "recoveryAndBackResult",
  "consoleResult",
  "pageErrorResult",
  "serverCleanupResult",
]);

function assertExactFields(value, expected, description) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((field, index) => field !== wanted[index])) {
    throw new Error(`${description} fields are invalid`);
  }
}

function conciseWorkerEvidenceText(value, field, maxLength) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`worker browser evidence ${field} is required`);
  }
  if (value.length > maxLength || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`worker browser evidence ${field} is not concise`);
  }
  return value.trim();
}

export function parseWorkerReport(output, browserEvidenceRequired) {
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("worker output is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("worker report must be an object");
  }
  assertExactFields(value, ["complete", "browserEvidence"], "worker report");
  if (value.complete !== true) throw new Error("worker report is incomplete");
  if (typeof browserEvidenceRequired !== "boolean") {
    throw new Error("browser evidence requirement is unavailable");
  }
  if (value.browserEvidence === null) {
    if (browserEvidenceRequired) throw new Error("worker browser evidence is required");
    return { complete: true, browserEvidence: null };
  }
  if (!value.browserEvidence || typeof value.browserEvidence !== "object" || Array.isArray(value.browserEvidence)) {
    throw new Error("worker browser evidence must be an object or null");
  }

  const evidence = value.browserEvidence;
  assertExactFields(evidence, WORKER_BROWSER_EVIDENCE_FIELDS, "worker browser evidence");
  if (evidence.mode !== "factory fixture") {
    throw new Error("worker browser evidence mode must be factory fixture");
  }
  const route = conciseWorkerEvidenceText(evidence.route, "route", 200);
  if (!/^\/[^\s?#]*$/.test(route)) {
    throw new Error("worker browser evidence route must be a pathname without query or fragment");
  }
  if (!evidence.viewport || typeof evidence.viewport !== "object" || Array.isArray(evidence.viewport)) {
    throw new Error("worker browser evidence viewport must be an object");
  }
  assertExactFields(evidence.viewport, ["width", "height"], "worker browser evidence viewport");
  for (const dimension of ["width", "height"]) {
    if (!Number.isInteger(evidence.viewport[dimension]) || evidence.viewport[dimension] < 200 || evidence.viewport[dimension] > 4_000) {
      throw new Error(`worker browser evidence viewport ${dimension} is invalid`);
    }
  }

  return {
    complete: true,
    browserEvidence: {
      mode: "factory fixture",
      route,
      viewport: { width: evidence.viewport.width, height: evidence.viewport.height },
      exercisedPath: conciseWorkerEvidenceText(evidence.exercisedPath, "exercisedPath", 500),
      recoveryAndBackResult: conciseWorkerEvidenceText(evidence.recoveryAndBackResult, "recoveryAndBackResult", 300),
      consoleResult: conciseWorkerEvidenceText(evidence.consoleResult, "consoleResult", 200),
      pageErrorResult: conciseWorkerEvidenceText(evidence.pageErrorResult, "pageErrorResult", 200),
      serverCleanupResult: conciseWorkerEvidenceText(evidence.serverCleanupResult, "serverCleanupResult", 200),
    },
  };
}

export function parseReviewerVerdict(output, requiredOutcomes = []) {
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("reviewer output is not valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("reviewer verdict must be an object");
  }
  if (value.complete !== true) throw new Error("reviewer verdict is incomplete");
  if (value.verdict !== "pass" && value.verdict !== "fail") {
    throw new Error("reviewer verdict must be pass or fail");
  }
  if (!Array.isArray(value.findings)) throw new Error("reviewer findings must be an array");
  if (!Array.isArray(requiredOutcomes)) throw new Error("required outcomes are unavailable");

  const findings = value.findings.map((finding) => {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      throw new Error("reviewer finding must be an object");
    }
    if (finding.severity !== "blocking" && finding.severity !== "non-blocking") {
      throw new Error("reviewer finding severity is invalid");
    }
    for (const [field, maxLength] of [["file", 160], ["description", 500]]) {
      if (typeof finding[field] !== "string" || finding[field].trim() === "") {
        throw new Error(`reviewer finding ${field} is required`);
      }
      if (finding[field].length > maxLength || /[\r\n\0]/.test(finding[field])) {
        throw new Error(`reviewer finding ${field} is not concise`);
      }
    }
    return {
      severity: finding.severity,
      file: finding.file.trim(),
      description: finding.description.trim(),
    };
  });

  let outcomeAssessments;
  if (requiredOutcomes.length === 0) {
    if (Object.hasOwn(value, "outcomeAssessments")) throw new Error("legacy reviewer verdict must not add outcome assessments");
  } else {
    if (!Array.isArray(value.outcomeAssessments)) throw new Error("reviewer outcome assessments are required");
    const requiredIds = requiredOutcomes.map((outcome) => outcome.id);
    const seen = new Set();
    outcomeAssessments = value.outcomeAssessments.map((assessment) => {
      assertExactFields(assessment, ["id", "status", "evidence"], "reviewer outcome assessment");
      if (!requiredIds.includes(assessment.id) || seen.has(assessment.id)) throw new Error("reviewer outcome assessment IDs are invalid");
      seen.add(assessment.id);
      if (!["Met", "Not met", "Unverified"].includes(assessment.status)) throw new Error("reviewer outcome assessment status is invalid");
      if (typeof assessment.evidence !== "string" || assessment.evidence.trim() === "" || assessment.evidence.length > 500 || /[\r\n\0]/.test(assessment.evidence)) {
        throw new Error("reviewer outcome assessment evidence is not concise");
      }
      return { id: assessment.id, status: assessment.status, evidence: assessment.evidence.trim() };
    });
    if (seen.size !== requiredIds.length || requiredIds.some((id) => !seen.has(id))) throw new Error("reviewer outcome assessments must exactly cover required outcomes");
  }

  const hasBlockingFinding = findings.some((finding) => finding.severity === "blocking");
  const hasBlockingOutcome = outcomeAssessments?.some((assessment) => assessment.status !== "Met") ?? false;
  if (value.verdict === "pass" && (hasBlockingFinding || hasBlockingOutcome)) {
    throw new Error("passing verdict contains blocking findings or non-Met outcomes");
  }
  if (value.verdict === "fail" && !hasBlockingFinding && !hasBlockingOutcome) {
    throw new Error("failing verdict has no blocking finding or outcome");
  }

  return { complete: true, verdict: value.verdict, findings, ...(outcomeAssessments ? { outcomeAssessments } : {}) };
}

export function previewProofRequired(issue) {
  const labels = labelNames(issue);
  return labels.includes("lane:frontend") || labels.includes("lane:design");
}

export function hasPreviewProof(body) {
  if (typeof body !== "string") return false;
  const hasPreviewUrl = /https:\/\/[^\s)]+\.vercel\.app(?:[\/\w.?=&%#-]*)?/i.test(body);
  const hasMedia = /!\[[^\]]*\]\(https:\/\/[^)]+\)|<video\b[^>]*>|https:\/\/github\.com\/user-attachments\/assets\//i.test(body);
  return hasPreviewUrl && hasMedia;
}

export function planAfterReview(verdict, completedFixLoops) {
  if (!Number.isInteger(completedFixLoops) || completedFixLoops < 0) {
    throw new Error("completed fix loops must be a non-negative integer");
  }
  if (verdict?.verdict === "pass") return { action: "complete", completedFixLoops };
  if (verdict?.verdict !== "fail") throw new Error("completed reviewer verdict is required");
  if (completedFixLoops >= MAX_FIX_LOOPS) {
    return { action: "stop-for-jesse", completedFixLoops };
  }
  return { action: "remediate", completedFixLoops: completedFixLoops + 1 };
}

export const factoryRunPolicyConstants = Object.freeze({
  generatedBodyMarkers: Object.freeze([...GENERATED_BODY_MARKERS]),
  maxFixLoops: MAX_FIX_LOOPS,
  requiredLabels: Object.freeze([...REQUIRED_LABELS]),
});
