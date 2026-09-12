#!/usr/bin/env node
// Home delivery reconciler: the coordinator is a tick, not a resident.
//
// Every run reads the GitHub board and the local lane records, plans (see
// reconcile-plan.mjs), then applies: launches one fresh headless Pi process per
// issue in its own worktree, kills lanes that are stale/over budget/over turns,
// relaunches dead lanes once, picks up Jesse review rounds, fixes PR labels,
// and writes an append-only ledger. No LLM runs inside this script.
//
//   node scripts/delivery/reconcile.mjs [--dry-run] [--target N] [--doctor]
//
// State: $HOME_RECONCILE_STATE (default ~/.local/state/home-coordinator)
//   lanes/<id>.json      live/exited lane records      lanes/done/   archived
//   lanes/<id>/          brief.md, session.jsonl, stdout.log (mode 700)
//   wt/issue-N           worktrees                     ledger.jsonl  audit trail
//   state.json           cooldowns, watermarks, spend  tick.lock     single-run lock

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, MARKER, planTick } from "./reconcile-plan.mjs";
import { laneUsage } from "./reconcile-usage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : dflt; };

const CFG = {
  repo: process.env.HOME_RECONCILE_REPO ?? "jessepollak/home",
  repoDir: resolve(process.env.HOME_RECONCILE_REPO_DIR ?? join(HERE, "..", "..")),
  stateDir: process.env.HOME_RECONCILE_STATE ?? join(homedir(), ".local/state/home-coordinator"),
  cbcode: process.env.HOME_RECONCILE_CBCODE ?? "cbcode",
  envFile: process.env.HOME_RECONCILE_ENV_FILE ?? join(homedir(), ".config/home/web.env.local"),
  jesse: process.env.HOME_RECONCILE_OWNER_LOGIN ?? "jessepollak",
  target: Number(opt("--target", process.env.HOME_RECONCILE_TARGET ?? DEFAULTS.target)),
  dryRun: flag("--dry-run"),
};
const LANES = join(CFG.stateDir, "lanes");
const DONE = join(LANES, "done");
const WT = join(CFG.stateDir, "wt");
const STATE = join(CFG.stateDir, "state.json");
const LEDGER = join(CFG.stateDir, "ledger.jsonl");
const LOG = join(CFG.stateDir, "reconcile.log");
const HOOK_MARK = "# home-reconcile pre-push guard v1";

// ---------------------------------------------------------------- utilities
function log(msg) {
  mkdirSync(CFG.stateDir, { recursive: true });
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
}
function ledger(entry) {
  if (CFG.dryRun) return;
  appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}
function sh(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...opts });
}
function tryRun(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: "utf8", ...opts });
  return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
}
function readJson(path, dflt) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return dflt; } }
function writeJson(path, value) { if (!CFG.dryRun) writeFileSync(path, JSON.stringify(value, null, 1) + "\n"); }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "work";

// ------------------------------------------------------------------ locking
function acquireLock() {
  const lock = join(CFG.stateDir, "tick.lock");
  mkdirSync(CFG.stateDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => { try { rmSync(lock); } catch { /* already gone */ } };
    } catch {
      const pid = Number(readFileSync(lock, "utf8").trim() || 0);
      if (pid && pidAlive(pid)) throw new Error(`another reconcile tick (pid ${pid}) is running`);
      rmSync(lock, { force: true }); // stale lock from a crashed tick
    }
  }
  throw new Error("could not acquire tick.lock");
}
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function pidStart(pid) { const r = tryRun("ps", ["-o", "lstart=", "-p", String(pid)]); return r.ok ? r.out.trim() : ""; }

// ------------------------------------------------------------------- GitHub
// Every fetch must succeed completely or the tick aborts: acting on a partial
// board (e.g. an empty PR list after a 5xx) would look like mass orphaning.
function ghLines(path) {
  const out = sh("gh", ["api", "--paginate", path, "--jq", ".[]"]);
  return out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function fetchBoard(sinceIso) {
  const raw = ghLines(`repos/${CFG.repo}/issues?state=open&per_page=100`);
  const issues = raw.filter((i) => !i.pull_request).map((i) => ({
    number: i.number, title: i.title, body: i.body ?? "", state: i.state, labels: i.labels.map((l) => l.name), updatedAt: i.updated_at,
  }));
  const prs = ghLines(`repos/${CFG.repo}/pulls?state=open&per_page=100`).map((p) => ({
    number: p.number, title: p.title, body: p.body ?? "", labels: p.labels.map((l) => l.name), draft: Boolean(p.draft),
    headRef: p.head.ref, headSha: p.head.sha, fork: p.head.repo?.full_name !== p.base.repo.full_name, updatedAt: p.updated_at,
  }));
  const openPrs = new Set(prs.map((p) => p.number));
  const comments = ghLines(`repos/${CFG.repo}/issues/comments?since=${encodeURIComponent(sinceIso)}&per_page=100&sort=created&direction=asc`)
    .filter((c) => c.user?.login === CFG.jesse && !(c.body ?? "").includes(MARKER))
    .map((c) => ({ pr: Number(c.issue_url.split("/").pop()), id: c.id, createdAt: c.created_at, body: c.body ?? "" }))
    .filter((c) => openPrs.has(c.pr));
  return { issues, prs, comments };
}
function ghLabel(number, add, remove) {
  if (CFG.dryRun) return;
  for (const l of remove) tryRun("gh", ["api", "-X", "DELETE", `repos/${CFG.repo}/issues/${number}/labels/${encodeURIComponent(l)}`]);
  if (add.length) sh("gh", ["api", "-X", "POST", `repos/${CFG.repo}/issues/${number}/labels`, ...add.flatMap((l) => ["-f", `labels[]=${l}`])]);
}
function ghComment(number, body) {
  if (CFG.dryRun) return;
  sh("gh", ["api", "-X", "POST", `repos/${CFG.repo}/issues/${number}/comments`, "-f", `body=${body}`]);
}

// -------------------------------------------------------------------- lanes
function loadLanes() {
  mkdirSync(DONE, { recursive: true });
  const lanes = [];
  for (const f of readdirSync(LANES)) {
    if (!f.endsWith(".json")) continue;
    const lane = readJson(join(LANES, f), null);
    if (!lane) continue;
    const alive = Boolean(lane.pid) && pidAlive(lane.pid) && pidStart(lane.pid) === lane.pidStart;
    lanes.push({ ...lane, alive, ...laneUsage(lane.laneDir) });
  }
  return lanes;
}
function saveLane(lane) { writeJson(join(LANES, `${lane.id}.json`), lane); }

// ------------------------------------------------------------------- launch
function installPrePushGuard() {
  const hooks = sh("git", ["-C", CFG.repoDir, "rev-parse", "--git-common-dir"]).trim();
  const hookPath = join(resolve(CFG.repoDir, hooks), "hooks", "pre-push");
  if (existsSync(hookPath) && readFileSync(hookPath, "utf8").includes(HOOK_MARK)) return;
  const script = `#!/bin/sh
${HOOK_MARK}
# Refuse to push env files or key-shaped secrets. Installed by scripts/delivery/reconcile.mjs.
zero=0000000000000000000000000000000000000000
while read -r _local_ref local_sha _remote_ref remote_sha; do
  [ "$local_sha" = "$zero" ] && continue
  if [ "$remote_sha" = "$zero" ]; then range="$local_sha"; else range="$remote_sha..$local_sha"; fi
  if git diff-tree --no-commit-id --name-only -r $range | grep -E '(^|/)\\.env(\\.|$)|\\.pem$|\\.key$' >/dev/null; then
    echo "pre-push: refusing to push env/key files" >&2; exit 1
  fi
  if git diff $range -U0 | grep -E '^\\+' | grep -Ei '(api[_-]?key|secret|token|private[_-]?key)["'"'"']?\\s*[:=]\\s*["'"'"']?[A-Za-z0-9_\\-]{24,}' >/dev/null; then
    echo "pre-push: refusing to push a key-shaped value" >&2; exit 1
  fi
done
exit 0
`;
  if (CFG.dryRun) return;
  mkdirSync(dirname(hookPath), { recursive: true });
  writeFileSync(hookPath, script);
  chmodSync(hookPath, 0o755);
  log(`installed pre-push guard at ${hookPath}`);
}

/** Path of an existing worktree that already has `branch` checked out (git refuses a second one). */
function worktreeFor(branch) {
  const out = tryRun("git", ["-C", CFG.repoDir, "worktree", "list", "--porcelain"]).out;
  let current = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice(9);
    else if (line === `branch refs/heads/${branch}` && current && existsSync(current)) return current;
  }
  return null;
}
function ensureWorktree(path, branch, kind) {
  if (existsSync(path) && tryRun("git", ["-C", path, "rev-parse", "--is-inside-work-tree"]).ok) {
    return { path, reused: true };
  }
  const elsewhere = worktreeFor(branch);
  if (elsewhere) return { path: elsewhere, reused: true };
  if (CFG.dryRun) return { path, reused: false };
  mkdirSync(WT, { recursive: true });
  tryRun("git", ["-C", CFG.repoDir, "worktree", "prune"]);
  const remoteHas = tryRun("git", ["-C", CFG.repoDir, "ls-remote", "--exit-code", "--heads", "origin", branch]).ok;
  if (remoteHas) sh("git", ["-C", CFG.repoDir, "worktree", "add", "--track", "-B", branch, path, `origin/${branch}`]);
  else if (kind === "implement") sh("git", ["-C", CFG.repoDir, "worktree", "add", "-B", branch, path, "origin/main"]);
  else {
    const localHas = tryRun("git", ["-C", CFG.repoDir, "rev-parse", "--verify", branch]).ok;
    sh("git", ["-C", CFG.repoDir, "worktree", "add", ...(localHas ? [path, branch] : ["-B", branch, path, "origin/main"])]);
  }
  return { path, reused: false };
}
function installEnv(wt) {
  const target = join(wt, "apps/web/.env.local");
  if (!existsSync(CFG.envFile)) return "no env file";
  if (!tryRun("git", ["-C", wt, "check-ignore", "-q", "apps/web/.env.local"]).ok) return "REFUSED: apps/web/.env.local is not gitignored";
  if (!CFG.dryRun) { copyFileSync(CFG.envFile, target); chmodSync(target, 0o600); }
  return "env installed";
}
function renderBrief(kind, vars) {
  let text = readFileSync(join(HERE, "briefs", `${kind}.md`), "utf8").replaceAll("{{CONTRACT}}", readFileSync(join(HERE, "briefs", "_contract.md"), "utf8"));
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, String(v ?? ""));
  return text;
}

function launch(action, board, state, now) {
  const issue = board.issues.find((i) => i.number === action.issue);
  const pr = board.prs.find((p) => p.number === action.pr);
  const id = `${action.kind}-${action.issue}-${new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const branch = action.branch ?? `wip/issue-${action.issue}-${slug(issue?.title ?? "")}`;
  const wtPath = join(WT, action.pr && !issue ? `pr-${action.pr}` : `issue-${action.issue}`);
  const laneDir = join(LANES, id);
  const lane = {
    id, issue: action.issue, pr: action.pr ?? null, kind: action.kind, attempt: action.attempt, tier: action.tier,
    writer: action.writer, reviewer: action.reviewer, branch, worktree: wtPath, laneDir,
    sessionFile: join(laneDir, "session.jsonl"), pid: null, pidStart: null, startedAt: now, lastCost: 0, killed: false,
  };
  const wt = ensureWorktree(wtPath, branch, action.kind);
  const { reused } = wt;
  lane.worktree = wt.path;
  const envNote = installEnv(wt.path);
  const comments = (board.comments ?? []).filter((c) => c.pr === action.pr).map((c) => `- (${c.createdAt}) ${c.body.slice(0, 1200)}`).join("\n");
  const brief = renderBrief(action.kind, {
    REPO: CFG.repo, ISSUE_NUMBER: action.issue, ISSUE_TITLE: issue?.title ?? pr?.title ?? "", ISSUE_BODY: (issue?.body ?? pr?.body ?? "").slice(0, 6000),
    PR_NUMBER: action.pr ?? "", BRANCH: branch, WORKTREE: wt.path, ATTEMPT: action.attempt, WRITER_MODEL: action.writer, REVIEWER_MODEL: action.reviewer,
    LANE_LABEL: issue?.labels.find((l) => l.startsWith("lane:")) ?? pr?.labels.find((l) => l.startsWith("lane:")) ?? "lane:product",
    PRIORITY_LABEL: issue?.labels.find((l) => l.startsWith("priority:")) ?? "priority:p1",
    HEAVY_SLOT: join(CFG.repoDir, "scripts/delivery/heavy-slot"), JESSE_COMMENTS: comments || "(none fetched — read the PR thread)", MARKER,
  });
  if (CFG.dryRun) { log(`DRY-RUN launch ${id} writer=${action.writer} reviewer=${action.reviewer} wt=${wt.path} (${reused ? "reused" : "new"}; ${envNote})`); return lane; }
  mkdirSync(laneDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(laneDir, "brief.md"), brief, { mode: 0o600 });
  saveLane(lane); // record exists before the process does
  const out = openSync(join(laneDir, "stdout.log"), "a");
  const child = spawn(CFG.cbcode, ["--agent", "pi", "--", "--approve", "--model", action.writer, "--session", lane.sessionFile, "-p", "Execute the brief provided on stdin exactly as written. It is your complete task."], {
    cwd: wt.path, detached: true, stdio: [openSync(join(laneDir, "brief.md"), "r"), out, out], env: { ...process.env, HOME_HEAVY_SLOTS: process.env.HOME_HEAVY_SLOTS ?? "4" },
  });
  child.on("error", () => { /* handled below via missing pid; keeps the tick alive */ });
  if (!child.pid) {
    log(`ERROR launch ${id}: could not spawn ${CFG.cbcode} (not found or not executable); lane record removed, issue left as-is`);
    ledger({ action: "error", step: "spawn", laneId: id, issue: action.issue, cbcode: CFG.cbcode });
    rmSync(join(LANES, `${id}.json`), { force: true });
    return null;
  }
  child.unref();
  lane.pid = child.pid;
  lane.pidStart = pidStart(child.pid);
  saveLane(lane);
  if (action.kind === "implement") ghLabel(action.issue, ["status:working"], ["status:todo"]);
  state.requested[String(action.issue)] = now;
  if (action.kind === "fix-round") { state.fixRounds[String(action.pr)] = now; if (action.watermark) state.watermarks[String(action.pr)] = action.watermark; }
  if (action.kind === "finish-round" || action.kind === "relaunch") state.finishRounds[String(action.issue)] = now;
  log(`launched ${id} pid=${lane.pid} writer=${action.writer} reviewer=${action.reviewer} wt=${wt.path} (${reused ? "reused" : "new"}; ${envNote})`);
  ledger({ action: "launch", ...action, laneId: id, pid: lane.pid, branch, worktree: wt.path });
  return lane;
}

// -------------------------------------------------------------------- apply
function applyActions(plan, board, lanes, state, now) {
  const byId = new Map(lanes.map((l) => [l.id, l]));
  for (const a of plan.actions) {
    try {
      if (a.type === "kill") {
        const lane = byId.get(a.lane);
        log(`kill ${a.lane} (${a.reason}) pid=${lane?.pid}`);
        if (!CFG.dryRun && lane?.pid) { try { process.kill(-lane.pid, lane.killed ? "SIGKILL" : "SIGTERM"); } catch { /* gone */ } lane.killed = true; lane.killedAt = now; lane.killReason = a.reason; saveLane(lane); }
        ledger({ action: "kill", laneId: a.lane, issue: a.issue, reason: a.reason });
      } else if (a.type === "archive") {
        const lane = byId.get(a.lane);
        if (!lane) continue;
        state.issueSpend[String(lane.issue)] = (state.issueSpend[String(lane.issue)] ?? 0) + (lane.costUsd ?? 0);
        log(`archive ${a.lane} outcome=${a.outcome} cost=$${(lane.costUsd ?? 0).toFixed(2)} turns=${lane.turns}`);
        if (!CFG.dryRun) {
          renameSync(join(LANES, `${lane.id}.json`), join(DONE, `${lane.id}.json`));
          writeJson(join(DONE, `${lane.id}.json`), { ...lane, outcome: a.outcome, archivedAt: now });
          if (a.outcome === "done") tryRun("git", ["-C", CFG.repoDir, "worktree", "remove", "--force", lane.worktree]);
        }
        ledger({ action: "archive", laneId: a.lane, issue: lane.issue, outcome: a.outcome, costUsd: lane.costUsd, turns: lane.turns });
      } else if (a.type === "launch") {
        launch(a, board, state, now);
      } else if (a.type === "label") {
        log(`label #${a.number} +[${a.add}] -[${a.remove}]`);
        ghLabel(a.number, a.add, a.remove);
        ledger({ action: "label", ...a });
      } else if (a.type === "comment") {
        log(`comment #${a.number}: ${a.body.slice(0, 80)}`);
        ghComment(a.number, a.body);
        ledger({ action: "comment", number: a.number });
      }
    } catch (e) {
      log(`ERROR applying ${a.type} ${a.lane ?? a.issue ?? a.number}: ${e.message?.split("\n")[0]}`);
      ledger({ action: "error", step: a.type, detail: String(e.message).slice(0, 300) });
    }
  }
}

function accrueSpend(lanes, state, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  for (const lane of lanes) {
    const delta = Math.max(0, (lane.costUsd ?? 0) - (lane.lastCost ?? 0));
    if (delta > 0) { state.dailySpend[today] = (state.dailySpend[today] ?? 0) + delta; lane.lastCost = lane.costUsd; if (!CFG.dryRun) saveLane({ ...lane, alive: undefined, costUsd: undefined, turns: undefined, lastActivityAt: undefined }); }
  }
  for (const k of Object.keys(state.dailySpend)) if (k < new Date(now - 14 * 86_400_000).toISOString().slice(0, 10)) delete state.dailySpend[k];
}

// ------------------------------------------------------------------- doctor
function doctor() {
  const checks = [];
  const ok = (name, pass, detail = "") => checks.push(`${pass ? "OK  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  ok("gh auth github.com", tryRun("gh", ["auth", "status", "-h", "github.com"]).ok);
  const rl = tryRun("gh", ["api", "rate_limit", "--jq", ".resources.core.remaining"]); ok("gh rate limit", rl.ok && Number(rl.out) > 500, rl.out.trim());
  ok("git repo on main", tryRun("git", ["-C", CFG.repoDir, "rev-parse", "--abbrev-ref", "HEAD"]).out.trim() === "main", CFG.repoDir);
  ok("cbcode runnable", tryRun(CFG.cbcode, ["version"]).ok, CFG.cbcode);
  ok("node runnable", tryRun("node", ["--version"]).ok, tryRun("node", ["--version"]).out.trim());
  const models = readJson(join(homedir(), ".pi/agent/models.json"), {});
  const sol = models.providers?.["cbhq-openai"]?.modelOverrides?.["gpt-5.6-sol"]?.contextWindow;
  ok("models.json Sol contextWindow cap ≤ 400K", typeof sol === "number" && sol <= 400_000, String(sol));
  ok("env file present (0600)", existsSync(CFG.envFile) && (statSync(CFG.envFile).mode & 0o777) === 0o600, CFG.envFile);
  ok("heavy-slot present", existsSync(join(CFG.repoDir, "scripts/delivery/heavy-slot")));
  ok("briefs present", ["implement", "fix-round", "finish-round", "relaunch"].every((k) => existsSync(join(HERE, "briefs", `${k}.md`))));
  try { mkdirSync(CFG.stateDir, { recursive: true }); ok("state dir writable", true, CFG.stateDir); } catch { ok("state dir writable", false, CFG.stateDir); }
  console.log(checks.join("\n"));
  process.exit(checks.some((c) => c.startsWith("FAIL")) ? 1 : 0);
}

// --------------------------------------------------------------------- main
function main() {
  if (flag("--doctor")) return doctor();
  const release = acquireLock();
  try {
    const now = Date.now();
    mkdirSync(LANES, { recursive: true });
    const state = { requested: {}, fixRounds: {}, finishRounds: {}, watermarks: {}, issueSpend: {}, dailySpend: {}, ...readJson(STATE, {}) };
    // Keep the checkout current so script updates land without a manual pull; skip if dirty.
    if (!CFG.dryRun && tryRun("git", ["-C", CFG.repoDir, "status", "--porcelain"]).out.trim() === "") tryRun("git", ["-C", CFG.repoDir, "pull", "--ff-only", "--quiet"]);
    tryRun("git", ["-C", CFG.repoDir, "fetch", "--prune", "--quiet", "origin"]);
    installPrePushGuard();

    let board;
    try {
      board = fetchBoard(new Date((state.commentsSince ?? now - 86_400_000) - 10 * 60_000).toISOString());
    } catch (e) {
      log(`ABORT tick: board fetch failed (${e.message.split("\n")[0]}); no actions taken`);
      ledger({ action: "abort", reason: "board-fetch" });
      return;
    }
    const lanes = loadLanes();
    accrueSpend(lanes, state, now);
    const plan = planTick({ board, lanes, comments: board.comments, state, now, cfg: { target: CFG.target } });
    const today = new Date(now).toISOString().slice(0, 10);
    log(`board: ${board.issues.length} issues, ${board.prs.length} PRs, ${board.comments.length} Jesse comments; live lanes ${plan.live}/${CFG.target}; today $${(state.dailySpend[today] ?? 0).toFixed(2)}; actions ${plan.actions.length}${CFG.dryRun ? " (dry-run)" : ""}`);
    for (const n of plan.notes) log(`  note: ${n}`);
    applyActions(plan, board, lanes, state, now);
    state.commentsSince = now;
    writeJson(STATE, state);
  } finally {
    release();
  }
}

main();
