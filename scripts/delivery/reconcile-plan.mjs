// Pure planner for the Home delivery reconciler. No I/O: takes a normalized
// board snapshot, lane records, Jesse comments and persisted state, returns the
// list of actions for this tick. reconcile.mjs owns fetching and applying.
//
// Invariants the tests pin: never more than `target` live lanes, never two
// lanes on one issue, a tick after apply converges to no-op, and any board
// fetch problem is the caller's job to catch (this module never sees a partial
// board — the caller aborts before calling planTick).

export const MARKER = "<!-- hugo -->";

export const DEFAULTS = Object.freeze({
  target: 6,
  maxPerLane: Object.freeze({ frontend: 3, backend: 3, design: 2, dx: 2, product: 2, ops: 2 }),
  launchCooldownMs: 20 * 60_000,
  fixRoundCooldownMs: 20 * 60_000,
  finishRoundCooldownMs: 6 * 3_600_000,
  staleMs: 45 * 60_000, // pid alive but no session write for this long -> kill
  laneTimeoutMs: 50 * 60_000,
  maxTurns: 120,
  maxAttempts: 2,
  // Cumulative per issue across attempts, fix rounds and reviewer children.
  issueCapUsd: Object.freeze({ docs: 3, product: 6, money: 12 }),
  dailyCapUsd: 150,
});

const DEP = /(?:depends on|blocked (?:on|by)|after|requires|prerequisites?:?)\s+(?:PR\s*)?#(\d+)/gi;
const CLOSES = /\b(?:closes|fixes|resolves)\s+#(\d+)/gi;
const BRANCH_ISSUE = /issue-?(\d+)/;
const TRACKER = /tracking|^arch\(|phase 2\(|feat\(latam\)/i;
const MONEY = /money-action|funding|onramp|ripio|idrx|\bauth\b|session|privacy|dispatch|settlement|postgres|neon|balance|borrow|earn|save|trade|swap|payment/i;

const all = (re, s) => Array.from((s ?? "").matchAll(re), (m) => Number(m[1]));
export const statusOf = (item) => item.labels.find((l) => l.startsWith("status:"))?.slice(7) ?? null;
export const laneOf = (item) => item.labels.find((l) => l.startsWith("lane:"))?.slice(5) ?? null;
const priorityRank = (item) => {
  const p = item.labels.find((l) => l.startsWith("priority:"));
  return p === "priority:p0" ? 0 : p === "priority:p1" ? 1 : p === "priority:p2" ? 2 : 3;
};

/** Model routing. Reviewer escalates on money *text* (any lane); the writer
 *  escalates to Sol only for backend money work. Everything else is DeepSeek. */
export function routeIssue(issue) {
  const lane = laneOf(issue);
  const text = `${issue.title}\n${issue.body ?? ""}`;
  if (lane === "dx" || lane === "ops" || /^docs/.test(issue.title)) {
    return { tier: "docs", writer: "cbhq-openai/gpt-5.6-terra:medium", reviewer: "cbhq-openai/gpt-5.6-terra:medium" };
  }
  const money = MONEY.test(text);
  if (money && lane === "backend") {
    return { tier: "money", writer: "cbhq-openai/gpt-5.6-sol:medium", reviewer: "cbhq-openai/gpt-6-astra:medium" };
  }
  return {
    tier: money ? "money" : "product",
    writer: "cbhq-deepseek/deepseek-v4-pro",
    reviewer: money ? "cbhq-openai/gpt-6-astra:medium" : "cbhq-openai/gpt-5.6-sol:medium",
  };
}

/** Open PRs indexed by the issue they close (body `Closes #N` or branch `issue-N`). */
function prsByIssue(prs) {
  const map = new Map();
  for (const pr of prs) {
    const issues = new Set(all(CLOSES, pr.body));
    const m = pr.headRef.match(BRANCH_ISSUE);
    if (m) issues.add(Number(m[1]));
    for (const n of issues) if (!map.has(n)) map.set(n, pr);
  }
  return map;
}

function issueTerminal(issue, pr) {
  if (!issue || issue.state === "closed") return true;
  const st = statusOf(issue);
  if (st === "blocked") return true;
  return Boolean(pr && !pr.draft && ["needs-jesse", "blocked"].includes(statusOf(pr)));
}

/**
 * @param {object} input
 * @param {{issues: Issue[], prs: PR[]}} input.board  open issues (no PRs) and open PRs, labels as name strings
 * @param {Lane[]} input.lanes  lane records enriched by the adapter: alive, lastActivityAt, costUsd, turns
 * @param {Comment[]} input.comments  Jesse's unmarked comments on open PRs: {pr, id, createdAt}
 * @param {State} input.state  persisted: requested, fixRounds, finishRounds, watermarks, issueSpend, dailySpend
 * @param {number} input.now
 * @param {Partial<typeof DEFAULTS>} [input.cfg]
 */
export function planTick({ board, lanes, comments, state, now, cfg = {} }) {
  const c = { ...DEFAULTS, ...cfg, maxPerLane: { ...DEFAULTS.maxPerLane, ...(cfg.maxPerLane ?? {}) }, issueCapUsd: { ...DEFAULTS.issueCapUsd, ...(cfg.issueCapUsd ?? {}) } };
  const actions = [];
  const notes = [];
  const issues = new Map(board.issues.map((i) => [i.number, i]));
  const prByIssue = prsByIssue(board.prs);
  const prByNumber = new Map(board.prs.map((p) => [p.number, p]));
  const today = new Date(now).toISOString().slice(0, 10);
  const dailySpent = state.dailySpend?.[today] ?? 0;
  const spendFor = (issue) => (state.issueSpend?.[issue] ?? 0) + lanes.filter((l) => l.issue === issue && l.alive).reduce((a, l) => a + (l.costUsd ?? 0), 0);

  // 1. Lane triage --------------------------------------------------------
  const live = lanes.filter((l) => l.alive && !l.killed);
  const liveIssues = new Set(live.map((l) => l.issue));
  const relaunchedIssues = new Set();
  for (const lane of lanes) {
    const issue = issues.get(lane.issue);
    const pr = prByIssue.get(lane.issue) ?? (lane.pr ? prByNumber.get(lane.pr) : undefined);
    const route = issue ? routeIssue(issue) : { tier: "product", writer: lane.writer, reviewer: lane.reviewer };
    if (lane.alive) {
      let reason = null;
      if (now - (lane.lastActivityAt ?? lane.startedAt) > c.staleMs) reason = "stale";
      else if (now - lane.startedAt > c.laneTimeoutMs) reason = "timeout";
      else if ((lane.turns ?? 0) > c.maxTurns) reason = "turns";
      else if (spendFor(lane.issue) > c.issueCapUsd[route.tier]) reason = "cost";
      if (reason && !lane.killed) {
        actions.push({ type: "kill", lane: lane.id, issue: lane.issue, reason });
        if (reason === "cost") {
          actions.push({ type: "label", number: lane.issue, add: ["status:blocked"], remove: ["status:working", "status:todo"] });
          actions.push({ type: "comment", number: lane.issue, body: `Reconciler stopped this lane: cumulative spend $${spendFor(lane.issue).toFixed(2)} exceeded the ${route.tier} cap ($${c.issueCapUsd[route.tier]}). Needs a scope or routing decision. ${MARKER}` });
        }
      }
      continue;
    }
    // Exited lane
    if (issueTerminal(issue, pr)) {
      actions.push({ type: "archive", lane: lane.id, issue: lane.issue, outcome: "done" });
      continue;
    }
    if (lane.attempt >= c.maxAttempts) {
      actions.push({ type: "label", number: lane.issue, add: ["status:blocked"], remove: ["status:working", "status:todo"] });
      actions.push({ type: "comment", number: lane.issue, body: `Reconciler: lane exited twice without reaching a reviewable state (last kind: ${lane.kind}, branch \`${lane.branch}\`). Parking as blocked for Jesse. ${MARKER}` });
      actions.push({ type: "archive", lane: lane.id, issue: lane.issue, outcome: "dead" });
      continue;
    }
    if (liveIssues.has(lane.issue) || relaunchedIssues.has(lane.issue)) {
      actions.push({ type: "archive", lane: lane.id, issue: lane.issue, outcome: "superseded" });
      continue;
    }
    const last = state.finishRounds?.[String(lane.issue)] ?? 0;
    if (pr && now - last < c.finishRoundCooldownMs) {
      notes.push(`hold finish-round #${lane.issue}: cooldown`);
      continue;
    }
    if (dailySpent >= c.dailyCapUsd) { notes.push(`hold relaunch #${lane.issue}: daily cap`); continue; }
    relaunchedIssues.add(lane.issue);
    actions.push({ type: "archive", lane: lane.id, issue: lane.issue, outcome: "dead" });
    actions.push({
      type: "launch", kind: pr ? "finish-round" : "relaunch", issue: lane.issue, pr: pr?.number ?? null,
      branch: lane.branch, attempt: lane.attempt + 1, writer: route.writer, reviewer: route.reviewer, tier: route.tier,
    });
  }
  const launchesThisTick = () => actions.filter((a) => a.type === "launch").length;

  // 2. Jesse fix rounds -----------------------------------------------------
  const fixTargets = new Map(); // pr -> max comment id
  for (const cm of comments) {
    const wm = state.watermarks?.[String(cm.pr)] ?? 0;
    if (cm.id > wm) fixTargets.set(cm.pr, Math.max(fixTargets.get(cm.pr) ?? 0, cm.id));
  }
  for (const pr of board.prs) {
    if (pr.labels.includes("review:jesse") && !fixTargets.has(pr.number)) fixTargets.set(pr.number, state.watermarks?.[String(pr.number)] ?? 0);
  }
  for (const [prNumber, maxId] of fixTargets) {
    const pr = prByNumber.get(prNumber);
    if (!pr || !pr.labels.includes("owner:hugo")) continue;
    const issueNumber = all(CLOSES, pr.body)[0] ?? Number(pr.headRef.match(BRANCH_ISSUE)?.[1] ?? 0) ?? 0;
    if (live.some((l) => l.pr === prNumber || (issueNumber && l.issue === issueNumber))) continue;
    if (now - (state.fixRounds?.[String(prNumber)] ?? 0) < c.fixRoundCooldownMs) continue;
    if (dailySpent >= c.dailyCapUsd) { notes.push(`hold fix-round PR #${prNumber}: daily cap`); continue; }
    const issue = issues.get(issueNumber);
    const route = issue ? routeIssue(issue) : routeIssue({ title: pr.title, body: pr.body, labels: pr.labels });
    actions.push({ type: "launch", kind: "fix-round", issue: issueNumber || prNumber, pr: prNumber, branch: pr.headRef, attempt: 1, writer: route.writer, reviewer: route.reviewer, tier: route.tier, watermark: maxId });
    liveIssues.add(issueNumber || prNumber);
  }

  // 3. Refill to target -------------------------------------------------------
  const perLane = {};
  for (const l of live) { const issue = issues.get(l.issue); const key = issue ? laneOf(issue) : null; if (key) perLane[key] = (perLane[key] ?? 0) + 1; }
  const deficit = Math.max(0, c.target - live.length - launchesThisTick());
  if (deficit > 0 && dailySpent >= c.dailyCapUsd) notes.push(`no refill: daily spend $${dailySpent.toFixed(2)} ≥ cap $${c.dailyCapUsd}`);
  else if (deficit > 0) {
    const sorted = [...board.issues].sort((a, b) => priorityRank(a) - priorityRank(b) || a.number - b.number);
    let launched = 0;
    for (const issue of sorted) {
      if (launched >= deficit) break;
      const n = issue.number;
      if (statusOf(issue) !== "todo" || TRACKER.test(issue.title)) continue;
      if (prByIssue.has(n) || liveIssues.has(n) || relaunchedIssues.has(n)) continue;
      const deps = [...new Set(all(DEP, `${issue.body ?? ""}\n${issue.title}`))].filter((d) => d !== n && issues.has(d));
      if (deps.length) { notes.push(`skip #${n}: depends on open [${deps.join(", ")}]`); continue; }
      if (now - (state.requested?.[String(n)] ?? 0) < c.launchCooldownMs) continue;
      const key = laneOf(issue);
      if (key && (perLane[key] ?? 0) >= c.maxPerLane[key]) { notes.push(`skip #${n}: lane:${key} at cap`); continue; }
      if (spendFor(n) > c.issueCapUsd[routeIssue(issue).tier]) { notes.push(`skip #${n}: over issue cap`); continue; }
      const route = routeIssue(issue);
      actions.push({ type: "launch", kind: "implement", issue: n, pr: null, branch: null, attempt: 1, writer: route.writer, reviewer: route.reviewer, tier: route.tier });
      liveIssues.add(n);
      if (key) perLane[key] = (perLane[key] ?? 0) + 1;
      launched++;
    }
  }

  // 4. PR hygiene (crew PRs from this repo only) ------------------------------
  for (const pr of board.prs) {
    if (pr.fork) continue;
    if (!pr.labels.some((l) => l.startsWith("status:"))) {
      actions.push({ type: "label", number: pr.number, add: ["owner:hugo", "status:working", "priority:p1"], remove: [] });
    }
  }

  return { actions, notes, live: live.length };
}
