import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { analyzeMigrations, documentedTables, evaluateDataModel, migrationTables, repositoryDataModel } from "../data-model.mjs";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const migrationPath = "apps/web/server/db/migrations/999_new_table.sql";
const model = "## Data model\n\n| Table | Kind | Why it exists |\n|---|---|---|\n";

// Table name -> reason for a migration table intentionally absent from the
// data-model inventory. Entries fail once the table is documented or removed.
const EXEMPTIONS = {};

test("a new migration table needs a paired data-model row", () => {
  const created = migrationTables([{ path: migrationPath, content: "CREATE TABLE new_table (id integer);" }]);
  assert.deepEqual(evaluateDataModel({ created, documented: documentedTables(model) }), {
    undocumented: [`new_table (${migrationPath})`],
    staleExemptions: [],
  });
  assert.deepEqual(
    evaluateDataModel({ created, documented: documentedTables(`${model}| \`new_table\` | record | test |\n`) }),
    { undocumented: [], staleExemptions: [] },
  );
});

test("reports each migration path for an undocumented table in sorted order", () => {
  const created = migrationTables([
    { path: "z.sql", content: "CREATE TABLE shared (id int);" },
    { path: "a.sql", content: "CREATE TABLE shared (id int);" },
  ]);
  assert.deepEqual(evaluateDataModel({ created, documented: new Set() }).undocumented, [
    "shared (a.sql)",
    "shared (z.sql)",
  ]);
});

test("detects case-insensitive, conditional, schema-qualified, and quoted CREATE TABLE names", () => {
  const created = migrationTables([
    { path: "a.sql", content: 'create table if not exists public."MixedCase" (id int);' },
    { path: "b.sql", content: 'CREATE UNLOGGED TABLE "public"."Another" (id int); CREATE TEMP TABLE temp_one (id int);' },
    { path: "c.sql", content: "CREATE TEMPORARY TABLE plain (id int); CREATE TABLE mixedcase (id int);" },
  ]);
  assert.deepEqual([...created].sort(([a], [b]) => a.localeCompare(b)), [
    ["Another", new Set(["b.sql"])],
    ["mixedcase", new Set(["c.sql"])],
    ["MixedCase", new Set(["a.sql"])],
    ["plain", new Set(["c.sql"])],
    ["temp_one", new Set(["b.sql"])],
  ]);
});

test("preserves quoted names and non-public schemas as distinct table identities", () => {
  const created = migrationTables([{
    path: "identity.sql",
    content: 'CREATE TABLE "Actions" (id int); CREATE TABLE private.actions (id int); CREATE TABLE public.actions (id int); CREATE TABLE "actions" (id int); CREATE TABLE "a""b" (id int);',
  }]);
  assert.deepEqual([...created.keys()], ["Actions", "private.actions", "actions", 'a"b']);
  assert.deepEqual(
    evaluateDataModel({ created, documented: documentedTables(`${model}| \`actions\` | record | present |\n`) }).undocumented,
    ['Actions (identity.sql)', 'a"b (identity.sql)', 'private.actions (identity.sql)'],
  );
  assert.deepEqual(documentedTables(`${model}| \`private.actions\` | record | present |\n`), new Set(["private.actions"]));
});

test("ignores SQL comments and single-quoted literals without joining tokens", () => {
  const created = migrationTables([{
    path: "comments.sql",
    content: `
      -- CREATE TABLE line_only (id int);
      /* CREATE TABLE block_only (id int); */
      SELECT 'CREATE TABLE in_string (id int); -- still string', 'it''s CREATE TABLE also_string (id int)';
      CREATE/* harmless */TABLE kept (id text DEFAULT 'CREATE TABLE default_string (id int)');
    `,
  }]);
  assert.deepEqual([...created], [["kept", new Set(["comments.sql"])]]);
});

test("literal and comment dollar markers cannot hide later CREATE TABLE", () => {
  const created = migrationTables([{
    path: "markers.sql",
    content: "SELECT '$$'; CREATE TABLE undisclosed (id int); SELECT '$$';\n-- $$\nCREATE TABLE after_comment (id int);",
  }]);
  assert.deepEqual([...created.keys()], ["undisclosed", "after_comment"]);
});

test("an E-string body decodes its escapes before scanning", () => {
  const created = migrationTables([
    { path: "exec.sql", content: "DO $$ BEGIN EXECUTE E'CREATE\\nTABLE hidden (id int)'; END $$;" },
    { path: "fn.sql", content: String.raw`CREATE FUNCTION f() RETURNS void AS E'BEGIN CREATE\x20TABLE hidden_fn (id int); END;' LANGUAGE plpgsql;` },
    { path: "data.sql", content: "INSERT INTO templates(body) VALUES (E'CREATE\\nTABLE stored (id int)');" },
  ]);
  assert.deepEqual([...created.keys()].sort(), ["hidden", "hidden_fn"]);
});


test("E-strings with escaped quotes do not expose CREATE TABLE text", () => {
  const created = migrationTables([{ path: "escape.sql", content: String.raw`SELECT E'hi\'CREATE TABLE fake (id int)'; CREATE TABLE real (id int);` }]);
  assert.deepEqual([...created.keys()], ["real"]);
});

test("quoted column identifiers cannot manufacture CREATE TABLE tokens", () => {
  const created = migrationTables([{ path: "columns.sql", content: 'CREATE TABLE real ("CREATE TABLE phantom" text);' }]);
  assert.deepEqual([...created.keys()], ["real"]);
});

test("nested block comments hide CREATE TABLE and retain following SQL", () => {
  const created = migrationTables([{ path: "nested.sql", content: "/* outer /* CREATE TABLE fake (id int); */ end */ CREATE TABLE real (id int);" }]);
  assert.deepEqual([...created.keys()], ["real"]);
});

test("dollar-quoted bodies neither hide later SQL nor hide tables they create", () => {
  const created = migrationTables([{
    path: "dollar.sql",
    content: `
      CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RAISE NOTICE 'it''s'; -- don't
      RETURN NEW; END; $$ LANGUAGE plpgsql;
      DO $body$ BEGIN CREATE TABLE IF NOT EXISTS inside_do (id int); END $body$;
      CREATE TABLE after_function (id int);
    `,
  }]);
  assert.deepEqual([...created.keys()].sort(), ["after_function", "inside_do"]);
});

test("nested dollar-quoted bodies are scanned recursively", () => {
  const created = migrationTables([{ path: "nested-body.sql", content: "DO $outer$ BEGIN DO $inner$ CREATE TABLE nested (id int); $inner$; END $outer$;" }]);
  assert.deepEqual([...created.keys()], ["nested"]);
});

test("quoted data is not scanned as SQL", () => {
  const created = migrationTables([{
    path: "data.sql",
    content: `
      INSERT INTO templates(body) VALUES ($$CREATE TABLE stored_text (id int)$$);
      SELECT 'CREATE TABLE quoted_data (id int)';
      DO $b$ BEGIN INSERT INTO templates(body) VALUES ($$CREATE TABLE still_text (id int)$$); END $b$;
    `,
  }]);
  assert.deepEqual([...created], []);
});

test("procedural EXECUTE of a static string is scanned", () => {
  const created = migrationTables([{
    path: "execute.sql",
    content: `
      DO $b$ BEGIN EXECUTE 'CREATE TABLE hidden (id int)'; END $b$;
      DO $c$ BEGIN EXECUTE $s$CREATE TABLE hidden_dollar (id int)$s$; END $c$;
      DO $d$ BEGIN EXECUTE 'ALTER TABLE hidden ADD COLUMN note text'; END $d$;
      CREATE FUNCTION g() RETURNS void AS 'CREATE TABLE hidden_sql_fn (id int)' LANGUAGE sql;
    `,
  }]);
  assert.deepEqual([...created.keys()].sort(), ["hidden", "hidden_dollar", "hidden_sql_fn"]);
});

test("dynamic SQL is reported instead of silently skipped, and trigger clauses are not", () => {
  const dynamic = analyzeMigrations([{
    path: "a.sql",
    content: "DO $b$ BEGIN\n  EXECUTE format('CREATE TABLE %I (id int)', 't');\nEND $b$;\nDO $c$ DECLARE s text; BEGIN EXECUTE s; END $c$;",
  }]);
  assert.deepEqual(dynamic.dynamicSql, ["a.sql:2", "a.sql:4"]);
  assert.deepEqual([...dynamic.tables], []);
  assert.deepEqual(
    analyzeMigrations([{
      path: "triggers.sql",
      content: "CREATE TRIGGER t AFTER INSERT ON x FOR EACH ROW EXECUTE FUNCTION f(); CREATE TRIGGER u AFTER INSERT ON x FOR EACH ROW EXECUTE PROCEDURE g();",
    }]).dynamicSql,
    [],
  );
});


test("a literal EXECUTE argument only counts when the statement ends there", () => {
  const expression = analyzeMigrations([{
    path: "a.sql",
    content: "DO $$BEGIN EXECUTE 'CREATE ' || 'TABLE hidden (id int)'; END$$;",
  }]);
  assert.deepEqual(expression.dynamicSql, ["a.sql:1"]);
  assert.deepEqual([...expression.tables], []);
  const terminated = analyzeMigrations([{
    path: "a.sql",
    content: "DO $b$ DECLARE r record; BEGIN EXECUTE 'SELECT 1' INTO r; EXECUTE 'ALTER TABLE t ADD COLUMN c int'; END $b$;",
  }]);
  assert.deepEqual(terminated.dynamicSql, []);
});

test("an E-string is one literal, in data and in an executable body", () => {
  const created = migrationTables([
    { path: "fn.sql", content: "CREATE FUNCTION f() RETURNS void AS E'BEGIN CREATE TABLE hidden (id int); END;' LANGUAGE plpgsql;" },
    { path: "exec.sql", content: "DO $$ BEGIN EXECUTE E'CREATE TABLE hidden_e (id int)'; END $$;" },
    { path: "data.sql", content: "INSERT INTO templates(body) VALUES (E'CREATE TABLE stored (id int)');" },
  ]);
  assert.deepEqual([...created.keys()].sort(), ["hidden", "hidden_e"]);
  assert.deepEqual(analyzeMigrations([{ path: "exec.sql", content: "DO $$ BEGIN EXECUTE E'CREATE TABLE hidden_e (id int)'; END $$;" }]).dynamicSql, []);
});

test("a single-quoted body reports the line of its EXECUTE", () => {
  const dynamic = analyzeMigrations([{ path: "a.sql", content: "DO 'BEGIN\nEXECUTE v;\nEND';" }]);
  assert.deepEqual(dynamic.dynamicSql, ["a.sql:2"]);
});


test("skips partition children but retains their parent", () => {
  const created = migrationTables([{
    path: "partitions.sql",
    content: `
      CREATE TABLE parent (id int) PARTITION BY HASH (id);
      CREATE TABLE IF NOT EXISTS child PARTITION OF parent FOR VALUES WITH (MODULUS 2, REMAINDER 0);
      CREATE TABLE "public"."quoted_child" PARTITION OF parent FOR VALUES WITH (MODULUS 2, REMAINDER 1);
    `,
  }]);
  assert.deepEqual([...created.keys()], ["parent"]);
});

test("ignores other SQL statements and CREATE TABLESPACE", () => {
  const created = migrationTables([{
    path: "unrelated.sql",
    content: `
      ALTER TABLE existing ADD COLUMN new_column int;
      CREATE INDEX existing_idx ON existing (new_column);
      CREATE TABLESPACE elsewhere LOCATION '/data';
      SELECT 'CREATE TABLE fake (id int)';
      CREATE OR REPLACE VIEW example AS SELECT 1;
    `,
  }]);
  assert.deepEqual([...created], []);
});

test("exemptions skip undocumented tables and stale exemptions fail", () => {
  const created = migrationTables([{ path: "a.sql", content: "CREATE TABLE pending (id int);" }]);
  assert.deepEqual(evaluateDataModel({ created, documented: new Set(), exemptions: { pending: "separate inventory" } }), {
    undocumented: [],
    staleExemptions: [],
  });
  assert.deepEqual(evaluateDataModel({ created, documented: new Set(), exemptions: { removed: "old" } }), {
    undocumented: ["pending (a.sql)"],
    staleExemptions: ["removed"],
  });
  assert.deepEqual(evaluateDataModel({ created, documented: new Set(["pending"]), exemptions: { pending: "old" } }), {
    undocumented: [],
    staleExemptions: ["pending"],
  });
  assert.deepEqual(evaluateDataModel({ created, documented: new Set(), exemptions: { pending: "" } }), {
    undocumented: [],
    staleExemptions: ["pending"],
  });
  assert.deepEqual(evaluateDataModel({ created, documented: new Set(), exemptions: { pending: 1 } }), {
    undocumented: [],
    staleExemptions: ["pending"],
  });
});

test("the data-model section is required; rows outside it do not count", () => {
  assert.throws(() => documentedTables("## Other\n| `table` | record | description |"), /Missing ## Data model/);
  assert.deepEqual(
    documentedTables(`## Other\n| \`before\` | record | other |\n${model}| \`inside\` | record | real |\n## Next\n| \`after\` | record | other |`),
    new Set(["inside"]),
  );
  assert.deepEqual(documentedTables(`${model}| \`one\` and \`two\` | record | not single |`), new Set());
});

test("data-model rows require three populated cells and cannot be fenced", () => {
  assert.deepEqual(documentedTables(`${model}
| \`one_cell\` |
| \`no_kind\` | | reason |
| \`no_reason\` | record | |
| \`valid\` | record | reason |
\`\`\`markdown
| \`inside_ticks\` | record | reason |
\`\`\`
~~~markdown
| \`inside_tildes\` | record | reason |
~~~
| \`private.qualified\` | record | reason |
| \`dash_kind\` | — | reason |
| \`other_kind\` | table | reason |
| \`observed\` | observation | reason |

    | \`indented\` | record | reason |
\t| \`tabbed\` | record | reason |
<!--
| \`commented\` | record | reason |
-->
`), new Set(["valid", "private.qualified", "observed"]));
});

test("only the exact public schema collapses onto an unqualified name", () => {
  const created = migrationTables([{
    path: "schemas.sql",
    content: 'CREATE TABLE "PUBLIC".upper_schema (id int); CREATE TABLE PUBLIC.folded (id int); CREATE TABLE "public".quoted (id int);',
  }]);
  assert.deepEqual([...created.keys()].sort(), ["PUBLIC.upper_schema", "folded", "quoted"]);
});

test("every migration-created table is documented in the repository", () => {
  const { created, documented, dynamicSql } = repositoryDataModel(repositoryRoot);
  assert.ok(created.size > 10, "migration scan should discover non-trivial table coverage");
  assert.deepEqual(dynamicSql, [], "use a literal EXECUTE or document the table it creates");
  assert.deepEqual(created.get("funding_orders"), new Set(["apps/web/server/funding/migrations/002_funding_provider_seam.sql"]));
  assert.deepEqual(evaluateDataModel({ created, documented, exemptions: EXEMPTIONS }), {
    undocumented: [],
    staleExemptions: [],
  });
});
