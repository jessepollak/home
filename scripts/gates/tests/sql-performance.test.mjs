import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { containsSql, sqlPerformanceReport } from "../sql-performance.mjs";

const gateModule = new URL("../sql-performance.mjs", import.meta.url).href;
const path = "apps/web/server/example/store.ts";
const select = 'const statement = `SELECT id FROM items WHERE owner = ${owner}`;';
const change = (content = select, baseContent = "", file = path) => ({ path: file, content, baseContent });

function createGitFixture(t, callerEnv = process.env) {
  const dir = mkdtempSync(join(tmpdir(), "home-sql-gate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(callerEnv).filter(([name]) => !name.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null" };
  const run = (...args) => execFileSync("git", args, { cwd: dir, env, stdio: "pipe" });
  const read = (base) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", `const { changedSqlCandidates } = await import(${JSON.stringify(gateModule)}); process.stdout.write(JSON.stringify(changedSqlCandidates(${JSON.stringify(base)})));`], { cwd: dir, env, encoding: "utf8" }));
  const write = (file, source) => { mkdirSync(join(dir, file, ".."), { recursive: true }); writeFileSync(join(dir, file), source); };
  run("init", "-q"); run("config", "user.name", "test"); run("config", "user.email", "test@example.test");
  return { run, read, write };
}

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

test("git fixture stages and reads SQL despite caller global and system configuration", (t) => {
  const caller = mkdtempSync(join(tmpdir(), "home-sql-caller-"));
  t.after(() => rmSync(caller, { recursive: true, force: true }));
  const ignore = join(caller, "ignore");
  const globalConfig = join(caller, "global.gitconfig");
  const systemConfig = join(caller, "system.gitconfig");
  writeFileSync(ignore, "*.sql\n");
  for (const config of [globalConfig, systemConfig]) writeFileSync(config, `[core]\n\texcludesFile = ${JSON.stringify(ignore)}\n[diff]\n\torderFile = .git/diff-order\n`);
  const previous = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  // Keep hostile configs ambient so fixture or read isolation regressions fail.
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  process.env.GIT_CONFIG_SYSTEM = systemConfig;
  const { run, read, write } = createGitFixture(t);
  const migration = "apps/web/server/db/migrations/099_new.sql";
  write(migration, "CREATE INDEX items_owner_idx ON items(owner);");
  run("add", ".");
  assert.equal(run("ls-files").toString().trim(), migration);
  run("commit", "-qm", "baseline"); run("branch", "baseline");
  write(path, select);
  run("add", "."); run("commit", "-qm", "changed");
  assert.deepEqual(read("baseline").map(({ path }) => path), [path]);
});

test("git integration includes new and deleted SQL, renamed query files, and excludes untouched SQL", (t) => {
  const { run, read, write } = createGitFixture(t);
  write(path, select); write("apps/web/server/stable.ts", select); write("apps/web/server/deleted.ts", select);
  run("add", "."); run("commit", "-qm", "baseline"); run("branch", "baseline");
  run("mv", path, "apps/web/server/renamed.ts"); run("rm", "apps/web/server/deleted.ts");
  write("apps/web/server/db/migrations/099_new.sql", "CREATE INDEX items_owner_idx ON items(owner);");
  run("add", "."); run("commit", "-qm", "changed");
  const result = sqlPerformanceReport(read("baseline"), "");
  assert.deepEqual(result.files.sort(), [path, "apps/web/server/deleted.ts", "apps/web/server/renamed.ts", "apps/web/server/db/migrations/099_new.sql"].sort());
});
