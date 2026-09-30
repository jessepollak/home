import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { changedSqlCandidates, containsSql, sqlPerformanceReport } from "../sql-performance.mjs";

const path = "apps/web/server/example/store.ts";
const select = 'const statement = `SELECT id FROM items WHERE owner = ${owner}`;';
const change = (content = select, baseContent = "", file = path) => ({ path: file, content, baseContent });

for (const [name, file, source, expected] of [
  ["select template", path, select, true],
  ["string SQL", path, 'sql.query("SELECT id FROM items");', true],
  ["comment before SQL", path, 'const q = "/* query */ SELECT id FROM items";', true],
  ["CTE", path, 'const q = `WITH recent AS (SELECT id FROM items) SELECT id FROM recent`;', true],
  ["update", path, 'const q = `UPDATE items SET name = $1 WHERE id = $2`;', true],
  ["index migration", "apps/web/server/db/migrations/099_items.sql", "CREATE INDEX items_owner_idx ON items(owner);", true],
  ["SQL comments in JS", path, '// SELECT id FROM items\nconst x = 1;', false],
  ["keyword alone", path, 'const mode = "update";', false],
  ["non SQL module", path, 'const x = "hello";', false],
  ["test", "apps/web/server/example/store.test.ts", select, false],
  ["test directory", "apps/web/server/__tests__/helper.ts", select, false],
  ["fixture", "apps/web/server/fixtures/query.ts", select, false],
  ["client query", "apps/web/client/query.ts", select, false],
]) test(name, () => assert.equal(containsSql(file, source), expected));

test("changed SQL module, removed query, and migration require evidence; unchanged and unrelated changes do not", () => {
  for (const item of [change(), change("const x = 1;", select), change("CREATE INDEX x ON t(id)", "", "apps/web/server/db/migrations/099_x.sql")]) {
    assert.equal(sqlPerformanceReport([item], "").findings.length, 1);
  }
  for (const item of [change(select, select), change("const x = 2;", "const x = 1;"), change(select, "", "docs/sql.md")]) {
    assert.deepEqual(sqlPerformanceReport([item], "").findings, []);
  }
});

for (const status of ["verified", "not-verified", "not-applicable"]) test(`accepts explicit ${status} evidence`, () => {
  assert.deepEqual(sqlPerformanceReport([change()], `SQL-performance: ${status} — Specific index/plan evidence or reason.`).findings, []);
});

for (const body of ["", "SQL-performance: verified", "SQL-performance: verified — ", "SQL-performance: yes — claim", "<!-- SQL-performance: verified — hidden -->", "```\nSQL-performance: verified — hidden\n```", "SQL-performance: verified — a\nSQL-performance: verified — b"]) {
  test(`rejects missing, malformed, hidden, or duplicate evidence ${JSON.stringify(body)}`, () => {
    assert.equal(sqlPerformanceReport([change()], body).findings.length, 1);
  });
}

test("git integration includes new and deleted SQL, renamed query files, and excludes untouched SQL", () => {
  const dir = mkdtempSync(join(tmpdir(), "home-sql-gate-"));
  const previous = process.cwd();
  const run = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  const write = (file, source) => { mkdirSync(join(dir, file, ".."), { recursive: true }); writeFileSync(join(dir, file), source); };
  try {
    run("init", "-q"); run("config", "user.name", "test"); run("config", "user.email", "test@example.test");
    write(path, select); write("apps/web/server/stable.ts", select); write("apps/web/server/deleted.ts", select);
    run("add", "."); run("commit", "-qm", "baseline"); run("branch", "baseline");
    run("mv", path, "apps/web/server/renamed.ts"); run("rm", "apps/web/server/deleted.ts");
    write("apps/web/server/db/migrations/099_new.sql", "CREATE INDEX items_owner_idx ON items(owner);");
    run("add", "."); run("commit", "-qm", "changed"); process.chdir(dir);
    const result = sqlPerformanceReport(changedSqlCandidates("baseline"), "");
    assert.deepEqual(result.files.sort(), [path, "apps/web/server/deleted.ts", "apps/web/server/renamed.ts", "apps/web/server/db/migrations/099_new.sql"].sort());
  } finally { process.chdir(previous); rmSync(dir, { recursive: true, force: true }); }
});
