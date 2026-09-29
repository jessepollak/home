import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectBranches, eligiblePreviews, planPrune } from "../../ci/neon-preview-prune-plan.mjs";

const cli = fileURLToPath(new URL("../../ci/neon-preview-prune-plan.mjs", import.meta.url));
const branch = (name, created_at, extra = {}) => ({ name, id: name, created_at, ...extra });
const previews = Array.from({ length: 5 }, (_, i) => branch(`preview/${i + 1}`, `2026-01-0${i + 1}T00:00:00Z`));
const other = Array.from({ length: 5 }, (_, i) => branch(i === 0 ? "main" : `other/${i}`, "2025-01-01T00:00:00Z"));
const names = (rows) => rows.map((row) => row.name);

test("total branch count determines the budget, not just preview count", () => {
  const branches = [...other, ...previews];
  const result = planPrune({ branches, stale: [], cap: 10, headroom: 4 });
  assert.deepEqual({ total: result.total, target: result.target, after: result.after, status: result.status },
    { total: 10, target: 6, after: 6, status: "ok" });
  assert.deepEqual(names(result.plan), ["preview/1", "preview/2", "preview/3", "preview/4"]);
  assert.deepEqual(names(result.eligible), names(previews));

  const oneSlot = planPrune({ branches, stale: [], cap: 10, headroom: 1 });
  assert.deepEqual(names(oneSlot.plan), ["preview/1"]);
  assert.equal(oneSlot.after, 9);
  assert.equal(oneSlot.status, "ok");
});

test("main plus five previews fits the target; a sixth removes the oldest", () => {
  const branches = [other[0], ...previews];
  const base = planPrune({ branches, stale: [], cap: 10, headroom: 4 });
  assert.deepEqual(names(base.plan), []);
  assert.equal(base.after, 6);
  assert.equal(base.status, "ok");

  const sixth = planPrune({ branches: [...branches, branch("preview/6", "2026-01-06T00:00:00Z")], stale: [], cap: 10, headroom: 4 });
  assert.deepEqual(names(sixth.plan), ["preview/1"]);
  assert.equal(sixth.after, 6);
  assert.equal(sixth.status, "ok");
});

test("stale previews go first in created order even below target; ties retain input order", () => {
  const branches = [other[0], previews[2], previews[0], previews[4], previews[1], previews[3]];
  const result = planPrune({ branches: [...branches, branch("preview/6", "2026-01-06T00:00:00Z")], stale: ["preview/5", "preview/4", "missing"], cap: 10, headroom: 4 });
  assert.deepEqual(names(result.plan), ["preview/4", "preview/5"]);
  const staleFirst = planPrune({ branches: [...branches, branch("preview/6", "2026-01-06T00:00:00Z"), branch("preview/7", "2026-01-07T00:00:00Z")], stale: ["preview/7"], cap: 10, headroom: 4 });
  assert.deepEqual(names(staleFirst.plan), ["preview/7", "preview/1"]);
  const below = planPrune({ branches, stale: ["preview/5"], cap: 10, headroom: 4 });
  assert.deepEqual(names(below.plan), ["preview/5"]);
  assert.equal(below.status, "ok");
  const tied = [branch("preview/b", "2026-01-01"), branch("preview/a", "2026-01-01")];
  assert.deepEqual(names(eligiblePreviews(tied)), ["preview/b", "preview/a"]);
});

test("unprunable branches report full or short instead of silently succeeding", () => {
  const ten = Array.from({ length: 10 }, (_, i) => branch(`other/${i}`, "2026-01-01"));
  const full = planPrune({ branches: ten, stale: [], cap: 10, headroom: 4 });
  assert.deepEqual(names(full.plan), []);
  assert.equal(full.after, 10);
  assert.equal(full.status, "full");

  const short = planPrune({ branches: ten.slice(0, 9), stale: [], cap: 10, headroom: 4 });
  assert.deepEqual(names(short.plan), []);
  assert.equal(short.after, 9);
  assert.equal(short.status, "short");
});

test("default, protected and non-preview branches are never selected", () => {
  const branches = [
    branch("preview/allowed", "2026-01-09"),
    branch("preview/default", "2026-01-01", { default: true }),
    branch("preview/protected", "2026-01-02", { protected: true }),
    branch("main", "2026-01-01"), branch("production", "2026-01-01"), branch("prod", "2026-01-01"),
    branch("other/preview/invalid", "2026-01-01"),
  ];
  assert.deepEqual(names(eligiblePreviews(branches)), ["preview/allowed"]);
  const result = planPrune({ branches, stale: ["preview/default", "preview/protected", "preview/allowed"], cap: 10, headroom: 4 });
  assert.deepEqual(names(result.plan), ["preview/allowed"]);
  assert.ok(result.plan.every((row) => row.name.startsWith("preview/")));
  assert.equal(result.status, "ok");
});

test("production-like preview names count toward the cap but are never eligible for deletion", () => {
  const excluded = ["preview/production", "preview/prod", "preview/PRODUCTION", "preview/Main"]
    .map((name) => branch(name, "2025-01-01"));
  const branches = [other[0], ...excluded, ...previews];
  const result = planPrune({ branches, stale: names(excluded), cap: 10, headroom: 4 });
  assert.equal(result.total, 10);
  assert.deepEqual(names(eligiblePreviews(branches)), names(previews));
  assert.deepEqual(names(result.eligible), names(previews));
  assert.deepEqual(names(result.plan), names(previews.slice(0, 4)));
  assert.equal(result.after, 6);
  assert.equal(result.status, "ok");
});

test("collectBranches concatenates pages in order and rejects untrustworthy lists", () => {
  const pages = [{ branches: [other[0], previews[0]], pagination: { next: "cursor" } }, { branches: [previews[1]] }];
  assert.deepEqual(collectBranches(pages), [other[0], previews[0], previews[1]]);
  const invalid = [
    [undefined, /pages must be an array/],
    [[null], /plain object/],
    [[[]], /plain object/],
    [[{}], /page.branches must be an array/],
    [[{ branches: null }], /page.branches must be an array/],
    [[{ branches: {} }], /page.branches must be an array/],
    [[{ branches: [null] }], /each branch/],
    [[{ branches: [{ name: "preview/x" }] }], /each branch/],
    [[{ branches: [{ name: 2, created_at: "2026-01-01" }] }], /each branch/],
    [[], /no branches/],
    [[{ branches: [] }], /no branches/],
    [[{ branches: [previews[0]] }, { branches: null }], /page.branches must be an array/],
    [[{ branches: [previews[0]] }, {}], /page.branches must be an array/],
  ];
  for (const [input, message] of invalid) assert.throws(() => collectBranches(input), message);
});

test("collect CLI matches the collector and rejects malformed pages", () => {
  const pages = [{ branches: [other[0]] }, { branches: previews }];
  const result = spawnSync(process.execPath, [cli, "collect"], { input: JSON.stringify(pages), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), collectBranches(pages));
  for (const input of ["not json", JSON.stringify([{}]), JSON.stringify([{ branches: [] }])]) {
    const bad = spawnSync(process.execPath, [cli, "collect"], { input, encoding: "utf8" });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /Neon preview prune planner:/);
  }
});

test("invalid cap, headroom and stale values fail", () => {
  for (const [cap, headroom] of [[0, 1], [10, 0], [10, 10], [10, 11], [-1, 1], [1.5, 1], [10, 1.5], ["10", 4], [10, NaN]]) {
    assert.throws(() => planPrune({ branches: [], stale: [], cap, headroom }), /cap and headroom/);
  }
  assert.throws(() => planPrune({ branches: [], stale: "preview/a", cap: 10, headroom: 4 }), /stale/);
  assert.throws(() => eligiblePreviews({}), /branches/);
});

test("eligible and plan CLIs match the module and reject malformed input", () => {
  const branches = [...other, ...previews];
  const eligible = spawnSync(process.execPath, [cli, "eligible"], { input: JSON.stringify(branches), encoding: "utf8" });
  assert.equal(eligible.status, 0, eligible.stderr);
  assert.deepEqual(JSON.parse(eligible.stdout), eligiblePreviews(branches));
  const args = [cli, "plan", "--cap", "10", "--headroom", "4", "--stale", '["preview/5"]'];
  const result = spawnSync(process.execPath, args, { input: JSON.stringify(branches), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), planPrune({ branches, stale: ["preview/5"], cap: 10, headroom: 4 }));
  const bad = spawnSync(process.execPath, args, { input: "not json", encoding: "utf8" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Neon preview prune planner:/);
});
