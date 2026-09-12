import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS, MARKER, planTick, routeIssue } from "../reconcile-plan.mjs";
import { laneUsage } from "../reconcile-usage.mjs";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = Date.parse("2026-09-12T08:00:00Z");
const H = 3_600_000;
const issue = (number, over = {}) => ({ number, title: `feat(ui): thing ${number}`, body: "", state: "open", labels: ["owner:hugo", "status:todo", "lane:frontend", "priority:p1"], ...over });
const pr = (number, over = {}) => ({ number, title: `pr ${number}`, body: `Closes #${number - 100}`, labels: ["owner:hugo", "status:working", "lane:frontend"], draft: true, headRef: `wip/issue-${number - 100}-x`, headSha: "abc", fork: false, ...over });
const lane = (issueNumber, over = {}) => ({ id: `implement-${issueNumber}-1`, issue: issueNumber, pr: null, kind: "implement", attempt: 1, tier: "product", writer: "w", reviewer: "r", branch: `wip/issue-${issueNumber}-x`, alive: true, killed: false, startedAt: NOW - 10 * 60_000, lastActivityAt: NOW - 60_000, costUsd: 0.5, turns: 10, ...over });
const state = (over = {}) => ({ requested: {}, fixRounds: {}, finishRounds: {}, watermarks: {}, issueSpend: {}, dailySpend: {}, ...over });
const plan = (input) => planTick({ board: { issues: [], prs: [] }, lanes: [], comments: [], state: state(), now: NOW, ...input });
const launches = (p) => p.actions.filter((a) => a.type === "launch");

test("refills to target from todo issues in priority order, never above target", () => {
  const issues = [issue(1), issue(2, { labels: ["status:todo", "lane:backend", "priority:p0"] }), issue(3), issue(4, { labels: ["status:todo", "lane:dx", "priority:p2"] })];
  const p = plan({ board: { issues, prs: [] }, lanes: [lane(9), lane(10)], cfg: { target: 4 } });
  assert.deepEqual(launches(p).map((a) => a.issue), [2, 1]);
  assert.equal(p.live, 2);
});

test("skips issues that depend on open issues, that have a PR, or that already have a live lane", () => {
  const issues = [issue(1, { body: "depends on #2" }), issue(2), issue(3), issue(5)];
  const p = plan({ board: { issues, prs: [pr(103)] }, lanes: [lane(5)] });
  assert.deepEqual(launches(p).map((a) => a.issue), [2]);
  assert.ok(p.notes.some((n) => n.includes("skip #1: depends on open [2]")));
});

test("honours launch cooldown and per-lane caps", () => {
  const issues = [issue(1), issue(2), issue(3), issue(4)];
  const s = state({ requested: { "1": NOW - 5 * 60_000 } });
  const p = plan({ board: { issues, prs: [] }, lanes: [lane(7), lane(8), lane(9)].map((l, i) => ({ ...l, issue: 7 + i })), state: s, cfg: { target: 6, maxPerLane: { frontend: 3 } } });
  // 7,8,9 have no issue record (unknown lane label) so they don't count toward frontend; 1 is cooled down.
  assert.deepEqual(launches(p).map((a) => a.issue), [2, 3, 4]);
  const p2 = plan({ board: { issues: [issue(7), issue(8), issue(9), issue(1)].map((i) => (i.number === 1 ? i : { ...i, labels: ["status:working", "lane:frontend"] })), prs: [] }, lanes: [lane(7), lane(8), lane(9)] });
  assert.equal(launches(p2).length, 0);
  assert.ok(p2.notes.some((n) => n.includes("lane:frontend at cap")));
});

test("alive pid with stale session is killed, not relaunched; never two lanes per issue", () => {
  const p = plan({ board: { issues: [issue(1, { labels: ["status:working", "lane:frontend"] })], prs: [] }, lanes: [lane(1, { lastActivityAt: NOW - 50 * 60_000 })] });
  assert.deepEqual(p.actions.map((a) => a.type), ["kill"]);
  assert.equal(p.actions[0].reason, "stale");
});

test("kills on turn cap, wall clock, and cumulative issue cost (with blocked label + marked comment)", () => {
  const turns = plan({ board: { issues: [issue(1)], prs: [] }, lanes: [lane(1, { turns: 121 })] });
  assert.equal(turns.actions[0].reason, "turns");
  const clock = plan({ board: { issues: [issue(1)], prs: [] }, lanes: [lane(1, { startedAt: NOW - 51 * 60_000 })] });
  assert.equal(clock.actions[0].reason, "timeout");
  const cost = plan({ board: { issues: [issue(1)], prs: [] }, lanes: [lane(1, { costUsd: 2 })], state: state({ issueSpend: { "1": 4.5 } }) });
  assert.deepEqual(cost.actions.map((a) => a.type), ["kill", "label", "comment"]);
  assert.equal(cost.actions[0].reason, "cost");
  assert.ok(cost.actions[2].body.endsWith(MARKER));
});

test("dead lane without PR relaunches once on the same branch; second death parks the issue as blocked", () => {
  const working = issue(1, { labels: ["status:working", "lane:frontend"] });
  const first = plan({ board: { issues: [working], prs: [] }, lanes: [lane(1, { alive: false })] });
  assert.deepEqual(first.actions.map((a) => a.type), ["archive", "launch"]);
  assert.equal(first.actions[1].kind, "relaunch");
  assert.equal(first.actions[1].attempt, 2);
  assert.equal(first.actions[1].branch, "wip/issue-1-x");
  const second = plan({ board: { issues: [working], prs: [] }, lanes: [lane(1, { alive: false, attempt: 2 })] });
  assert.deepEqual(second.actions.map((a) => a.type), ["label", "comment", "archive"]);
  assert.deepEqual(second.actions[0].add, ["status:blocked"]);
});

test("dead lane that left a draft PR gets a finish-round; a ready PR is terminal", () => {
  const working = issue(1, { labels: ["status:working", "lane:frontend"] });
  const draft = plan({ board: { issues: [working], prs: [pr(101)] }, lanes: [lane(1, { alive: false })] });
  assert.equal(draft.actions[1].kind, "finish-round");
  assert.equal(draft.actions[1].pr, 101);
  const ready = plan({ board: { issues: [working], prs: [pr(101, { draft: false, labels: ["owner:hugo", "status:needs-jesse"] })] }, lanes: [lane(1, { alive: false })] });
  assert.deepEqual(ready.actions.map((a) => a.type), ["archive"]);
  assert.equal(ready.actions[0].outcome, "done");
  const held = plan({ board: { issues: [working], prs: [pr(101)] }, lanes: [lane(1, { alive: false })], state: state({ finishRounds: { "1": NOW - H } }) });
  assert.equal(launches(held).length, 0);
});

test("Jesse comments trigger one fix round per PR above the watermark; old comments do not respawn", () => {
  const board = { issues: [issue(1, { labels: ["status:working", "lane:frontend"] })], prs: [pr(101, { draft: false, labels: ["owner:hugo", "status:working", "review:jesse"] })] };
  const comments = [{ pr: 101, id: 50, createdAt: "x" }, { pr: 101, id: 55, createdAt: "x" }];
  const p = plan({ board, comments });
  assert.equal(launches(p).length, 1);
  assert.equal(launches(p)[0].kind, "fix-round");
  assert.equal(launches(p)[0].watermark, 55);
  const after = plan({ board: { ...board, prs: [pr(101, { draft: false })] }, comments, state: state({ watermarks: { "101": 55 } }) });
  assert.equal(launches(after).length, 0);
  const busy = plan({ board, comments, lanes: [lane(1)] });
  assert.equal(launches(busy).length, 0);
});

test("daily cap stops new launches and relaunches but still archives and labels", () => {
  const s = state({ dailySpend: { "2026-09-12": 151 } });
  const p = plan({ board: { issues: [issue(1), issue(2, { labels: ["status:working", "lane:frontend"] })], prs: [] }, lanes: [lane(2, { alive: false })], state: s });
  assert.equal(launches(p).length, 0);
  assert.ok(p.notes.some((n) => n.includes("daily")));
});

test("unlabeled non-fork PRs get board labels; forks are left alone", () => {
  const p = plan({ board: { issues: [], prs: [pr(101, { labels: [] }), pr(102, { labels: [], fork: true })] } });
  assert.deepEqual(p.actions, [{ type: "label", number: 101, add: ["owner:hugo", "status:working", "priority:p1"], remove: [] }]);
});

test("plan converges: applying the launches makes the next tick a no-op", () => {
  const issues = [issue(1), issue(2)];
  const p = plan({ board: { issues, prs: [] }, cfg: { target: 2 } });
  const nextLanes = launches(p).map((a) => lane(a.issue));
  const nextIssues = issues.map((i) => ({ ...i, labels: ["status:working", "lane:frontend"] }));
  const p2 = plan({ board: { issues: nextIssues, prs: [] }, lanes: nextLanes, cfg: { target: 2 } });
  assert.deepEqual(p2.actions, []);
});

test("routing: docs → Terra; backend money → Sol writer + Astra reviewer; frontend money → DeepSeek + Astra; plain → DeepSeek + Sol", () => {
  assert.equal(routeIssue(issue(1, { labels: ["lane:dx"] })).writer, "cbhq-openai/gpt-5.6-terra:medium");
  const money = routeIssue(issue(1, { title: "fix(funding): ripio webhook", labels: ["lane:backend"] }));
  assert.deepEqual([money.tier, money.writer, money.reviewer], ["money", "cbhq-openai/gpt-5.6-sol:medium", "cbhq-openai/gpt-6-astra:medium"]);
  const fe = routeIssue(issue(1, { title: "fix(balances): unavailable rows", labels: ["lane:frontend"] }));
  assert.deepEqual([fe.writer, fe.reviewer], ["cbhq-deepseek/deepseek-v4-pro", "cbhq-openai/gpt-6-astra:medium"]);
  const plain = routeIssue(issue(1, { title: "fix(ui): caret spacing", labels: ["lane:frontend"] }));
  assert.deepEqual([plain.tier, plain.reviewer], ["product", "cbhq-openai/gpt-5.6-sol:medium"]);
});

test("laneUsage sums cost and turns across the lane session and nested child sessions", () => {
  const dir = mkdtempSync(join(tmpdir(), "lane-"));
  const msg = (cost) => JSON.stringify({ type: "message", message: { role: "assistant", usage: { cost: { total: cost } } } });
  writeFileSync(join(dir, "session.jsonl"), [msg(0.5), JSON.stringify({ type: "custom", customType: "pr-tracker" }), msg(0.25)].join("\n"));
  mkdirSync(join(dir, "session", "child", "run-0"), { recursive: true });
  writeFileSync(join(dir, "session", "child", "run-0", "session.jsonl"), msg(1));
  const u = laneUsage(dir);
  assert.equal(u.turns, 3);
  assert.equal(Math.round(u.costUsd * 100), 175);
  assert.ok(u.lastActivityAt > 0);
});

test("defaults are the documented bounds", () => {
  assert.equal(DEFAULTS.target, 6);
  assert.equal(DEFAULTS.maxTurns, 120);
  assert.equal(DEFAULTS.maxAttempts, 2);
  assert.deepEqual(DEFAULTS.issueCapUsd, { docs: 3, product: 6, money: 12 });
});
