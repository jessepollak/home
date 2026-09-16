const OPEN_STATUS = Object.freeze({
  "status:todo": "Todo",
  "status:working": "Working",
  "status:ready-for-review": "Independent review",
  "status:needs-jesse": "Needs Jesse",
  "status:blocked": "Blocked",
});

export function deriveDeliveryStatus(issue) {
  if (issue?.state === "CLOSED") {
    const reason = String(issue.stateReason ?? "").toUpperCase();
    if (reason === "COMPLETED") return "Done";
    if (reason === "NOT_PLANNED" || reason === "DUPLICATE") return "Not planned";
    return "Needs triage";
  }
  if (issue?.state !== "OPEN") return "Needs triage";
  const labels = (issue.labels ?? []).map((label) => typeof label === "string" ? label : label?.name)
    .filter((name) => typeof name === "string" && name.startsWith("status:"));
  if (labels.length !== 1) return "Needs triage";
  return OPEN_STATUS[labels[0]] ?? "Needs triage";
}

export function indexRoots(config) {
  const byId = new Map();
  const numbers = new Set();
  const workstreams = new Set();
  for (const root of config.roots ?? []) {
    if (!root?.id || !Number.isSafeInteger(root.number) || root.number < 1 || !root.workstream) {
      throw new Error("invalid workstream root configuration");
    }
    if (byId.has(root.id) || numbers.has(root.number) || workstreams.has(root.workstream)) {
      throw new Error("duplicate workstream root");
    }
    if (!Object.hasOwn(config.fields.workstream.options, root.workstream)) {
      throw new Error(`root #${root.number} has an unknown workstream`);
    }
    byId.set(root.id, root);
    numbers.add(root.number);
    workstreams.add(root.workstream);
  }
  if (byId.size !== 8) throw new Error("exactly eight workstream roots are required");
  return byId;
}

export function deriveHierarchy(issue, ancestors, config) {
  const roots = indexRoots(config);
  const chain = [issue, ...(ancestors ?? [])];
  const seen = new Set();
  if (chain.length > 101) throw new Error(`issue #${issue?.number ?? "unknown"} ancestor depth exceeds 100`);
  for (const entry of chain) {
    if (!entry?.id || seen.has(entry.id)) throw new Error(`issue #${issue?.number ?? "unknown"} has an invalid parent cycle`);
    seen.add(entry.id);
    const root = roots.get(entry.id);
    if (root) {
      return {
        level: roots.has(issue.id) ? "Workstream" : "Delivery",
        workstream: root.workstream,
      };
    }
  }
  return { level: roots.has(issue.id) ? "Workstream" : "Delivery", workstream: null };
}

export function desiredFields(issue, ancestors, config) {
  return {
    deliveryStatus: deriveDeliveryStatus(issue),
    ...deriveHierarchy(issue, ancestors, config),
  };
}

export function planFieldChanges(current, desired, config) {
  const changes = [];
  const definitions = [
    ["deliveryStatus", desired.deliveryStatus],
    ["workstream", desired.workstream],
    ["level", desired.level],
  ];
  for (const [key, value] of definitions) {
    const field = config.fields[key];
    const currentOptionId = current?.[key] ?? null;
    if (value === null) {
      if (currentOptionId !== null) changes.push({ action: "clear", key, fieldId: field.id });
      continue;
    }
    const optionId = field.options[value];
    if (!optionId) throw new Error(`missing configured ${field.name} option: ${value}`);
    if (currentOptionId !== optionId) changes.push({ action: "update", key, fieldId: field.id, optionId });
  }
  return changes;
}

export function mergeCandidateIssues(groups, roots) {
  const candidates = new Map();
  for (const group of groups) {
    for (const issue of group) {
      if (issue?.__typename === "Issue" && issue.id) candidates.set(issue.id, issue);
    }
  }
  for (const root of roots) candidates.set(root.id, { __typename: "Issue", ...root });
  return [...candidates.values()].sort((a, b) => a.number - b.number);
}
