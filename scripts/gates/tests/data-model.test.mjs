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

test("CREATE SCHEMA qualifies bundled tables without affecting later statements or qualified names", () => {
  const created = migrationTables([{
    path: "bundled.sql",
    content: `
      CREATE SCHEMA bundled
        CREATE TABLE customers (id int)
        CREATE TABLE IF NOT EXISTS orders (id int)
        CREATE TABLE private.other (id int)
        CREATE TABLE public.explicit_public (id int);
      CREATE TABLE after_bundle (id int);
    `,
  }]);
  assert.deepEqual([...created.keys()], ["bundled.customers", "bundled.orders", "private.other", "explicit_public", "after_bundle"]);
});

test("CREATE SCHEMA supports conditional names, authorization roles, and exact public collapsing", () => {
  for (const [declaration, expected] of [
    ["private", "private.customers"],
    ["IF NOT EXISTS private", "private.customers"],
    ["private AUTHORIZATION owner", "private.customers"],
    ['IF NOT EXISTS "Private" AUTHORIZATION "Owner"', "Private.customers"],
    ["AUTHORIZATION owner", "owner.customers"],
    ['AUTHORIZATION "Owner"', "Owner.customers"],
    ["IF NOT EXISTS AUTHORIZATION owner", "owner.customers"],
    ["PUBLIC", "customers"],
    ['"public" AUTHORIZATION owner', "customers"],
    ["AUTHORIZATION public", "customers"],
    ['"PUBLIC"', "PUBLIC.customers"],
  ]) {
    const content = `CREATE SCHEMA ${declaration} CREATE TABLE customers (id int); CREATE TABLE later (id int);`;
    assert.deepEqual([...migrationTables([{ path: "schemas.sql", content }]).keys()], [expected, "later"], declaration);
  }
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

test("DO bodies with LANGUAGE before or after the body discover their tables", () => {
  const created = migrationTables([
    { path: "word.sql", content: "DO LANGUAGE plpgsql $$BEGIN CREATE TABLE hidden_word (id int); END$$;" },
    { path: "quoted.sql", content: 'DO LANGUAGE "plpgsql" $$BEGIN CREATE TABLE hidden_quoted (id int); END$$;' },
    { path: "string.sql", content: "DO LANGUAGE 'plpgsql' $$BEGIN CREATE TABLE hidden_string (id int); END$$;" },
    { path: "dollar-language.sql", content: "DO LANGUAGE $$plpgsql$$ $b$BEGIN CREATE TABLE hidden_dollar_language (id int); END$b$;" },
    { path: "after.sql", content: "DO $$BEGIN CREATE TABLE hidden_after (id int); END$$ LANGUAGE plpgsql;" },
    { path: "literal.sql", content: "DO LANGUAGE plpgsql 'BEGIN CREATE TABLE hidden_literal (id int); END';" },
  ]);
  assert.deepEqual([...created.keys()].sort(), ["hidden_after", "hidden_dollar_language", "hidden_literal", "hidden_quoted", "hidden_string", "hidden_word"]);
});

test("quoted LANGUAGE names are not executable DO bodies", () => {
  for (const language of [
    "'CREATE TABLE language_data (id int); SET search_path = private; EXECUTE dynamic_sql;'",
    "$$CREATE TABLE language_data (id int); SET search_path = private; EXECUTE dynamic_sql;$$",
  ]) {
    const scanned = analyzeMigrations([{
      path: "language.sql",
      content: `DO LANGUAGE ${language} $b$CREATE TABLE real (id int);$b$;`,
    }]);
    assert.deepEqual([...scanned.tables.keys()], ["real"], language);
    assert.deepEqual(scanned.dynamicSql, [], language);
    assert.deepEqual(scanned.searchPath, [], language);
    assert.deepEqual(scanned.unreadable, [], language);
  }
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


test("reports the SET line for schema and literal-parsing settings and function attributes", () => {
  for (const content of [
    "SELECT 1;\nSET search_path = private;",
    'SELECT 1;\nset "SEARCH_PATH" TO private;',
    'SELECT 1;\nSET\nLOCAL "search_path" = private;',
    "SELECT 1;\nSET SESSION search_path TO private;",
    "SELECT 1;\nSET SCHEMA 'private';",
    "SELECT 1;\nSET LOCAL SCHEMA 'private';",
    "SELECT 1;\nSET SESSION SCHEMA 'private';",
    "SELECT 1;\nSET standard_conforming_strings = off;",
    "SELECT 1;\nSET LOCAL standard_conforming_strings TO off;",
    'SELECT 1;\nSET SESSION "STANDARD_CONFORMING_STRINGS" = off;',
    "CREATE FUNCTION f() RETURNS void\nSET search_path = private AS $$BEGIN END$$ LANGUAGE plpgsql;",
    'ALTER FUNCTION f()\nSET "Search_Path" = private;',
  ]) {
    assert.deepEqual(analyzeMigrations([{ path: "set.sql", content }]).searchPath, ["set.sql:2"], content);
  }
});

test("reports set_config calls for protected settings or a non-literal first argument", () => {
  for (const expression of [
    "set_config('search_path', 'private', true)",
    "pg_catalog.set_config(' SEARCH_PATH ', 'private', false)",
    String.raw`set_config(E'search\x5fpath', 'private', true)`,
    String.raw`set_config(E'search\u005fpath', 'private', true)`,
    String.raw`set_config(E'search\U0000005fpath', 'private', true)`,
    "set_config('standard_conforming_strings', 'off', true)",
    "pg_catalog.set_config(' STANDARD_CONFORMING_STRINGS ', 'off', false)",
    String.raw`set_config(E'standard\U0000005fconforming_strings', 'off', true)`,
    "set_config(setting_name, 'private', true)",
    "set_config(current_setting('app.setting'), 'private', true)",
    "set_config($$search_path$$, 'private', true)",
    "set_config('app.x' || suffix, 'private', true)",
  ]) {
    const content = `SELECT 1;\nSELECT ${expression};`;
    assert.deepEqual(analyzeMigrations([{ path: "config.sql", content }]).searchPath, ["config.sql:2"], expression);
  }
});

test("search_path changes in executable bodies retain their line numbers", () => {
  const scanned = analyzeMigrations([
    {
      path: "do.sql",
      content: "DO LANGUAGE 'plpgsql' $$BEGIN\nSET LOCAL search_path = private;\nPERFORM pg_catalog.set_config('search_path', 'private', true);\nEND$$;",
    },
    {
      path: "function.sql",
      content: "CREATE FUNCTION f() RETURNS void AS 'BEGIN\nSET SESSION search_path = private;\nPERFORM set_config(''search_path'', ''private'', true);\nEND' LANGUAGE plpgsql;",
    },
    {
      path: "execute.sql",
      content: "DO $$BEGIN\nEXECUTE 'SELECT 1;\nSET search_path = private;\nSELECT set_config(''search_path'', ''private'', true);';\nEND$$;",
    },
    {
      path: "escaped.sql",
      content: String.raw`DO $$BEGIN EXECUTE E'SELECT 1;\nSET search_path = private;'; END$$;`,
    },
  ]);
  assert.deepEqual(scanned.searchPath, ["do.sql:2", "do.sql:3", "function.sql:2", "function.sql:3", "execute.sql:3", "execute.sql:4", "escaped.sql:2"]);
  assert.deepEqual(scanned.dynamicSql, []);
});

test("UPDATE and conflict assignments do not change settings, but later SET statements do", () => {
  const scanned = analyzeMigrations([{
    path: "assignments.sql",
    content: [
      "UPDATE settings SET search_path = 'hello';",
      "INSERT INTO settings(search_path) VALUES ('hello') ON CONFLICT (id) DO UPDATE SET search_path = 'hello';",
      "UPDATE settings SET standard_conforming_strings = 'hello';",
      "SET search_path = private;",
      "CREATE FUNCTION f() RETURNS void SET search_path = private AS $$BEGIN",
      "UPDATE settings SET search_path = 'hello';",
      "SET LOCAL SCHEMA 'private';",
      "END$$ LANGUAGE plpgsql;",
      "ALTER FUNCTION f() SET search_path = private;",
      "DO $$BEGIN SET standard_conforming_strings = off;",
      "INSERT INTO settings(search_path) VALUES ('hello') ON CONFLICT (id) DO UPDATE SET search_path = 'hello';",
      "SET SESSION search_path = private; END$$;",
    ].join("\n"),
  }]);
  assert.deepEqual(scanned.searchPath, [
    "assignments.sql:4", "assignments.sql:5", "assignments.sql:7",
    "assignments.sql:9", "assignments.sql:10", "assignments.sql:12",
  ]);
});

test("UPDATE names and locking clauses cannot hide protected SET statements", () => {
  for (const content of [
    "DO $$BEGIN IF EXISTS (SELECT 1 FROM t FOR UPDATE) THEN\nSET LOCAL search_path = private; END IF; END$$;",
    "DO $$DECLARE r record; BEGIN FOR r IN SELECT id FROM t FOR UPDATE LOOP\nSET LOCAL search_path = private; END LOOP; END$$;",
    "DO $$DECLARE r record; BEGIN FOR r IN SELECT id FROM t FOR NO KEY UPDATE LOOP\nSET LOCAL search_path = private; END LOOP; END$$;",
    "CREATE FUNCTION private.update() RETURNS void\nSET search_path = private AS $$BEGIN END$$ LANGUAGE plpgsql;",
    "CREATE FUNCTION f() RETURNS private.update\nSET search_path = private AS $$SELECT NULL::private.update$$ LANGUAGE sql;",
    'CREATE FUNCTION f() RETURNS "update"\nSET search_path = private AS $$BEGIN END$$ LANGUAGE plpgsql;',
  ]) {
    assert.deepEqual(analyzeMigrations([{ path: "update-name.sql", content }]).searchPath, ["update-name.sql:2"], content);
  }
});

test("UPDATE assignment detection accepts qualified names, inheritance markers, aliases, and MERGE", () => {
  for (const content of [
    "UPDATE ONLY s.t * AS a SET search_path = 'hello';",
    'UPDATE ONLY "s"."t" * AS "a" SET standard_conforming_strings = \'hello\';',
    "UPDATE private.update SET search_path = 'hello';",
    "UPDATE only SET search_path = 'hello';",
    'UPDATE "as" SET search_path = \'hello\';',
    "MERGE INTO settings USING source ON settings.id = source.id WHEN MATCHED THEN UPDATE SET search_path = 'hello';",
  ]) {
    assert.deepEqual(analyzeMigrations([{ path: "assignments.sql", content }]).searchPath, [], content);
  }
});

test("Unicode-escape literals and identifiers are unreadable in migration SQL", () => {
  for (const content of [
    String.raw`SELECT 1;
SELECT U&'search\005fpath';`,
    String.raw`SELECT 1;
SELECT u&'standard_conforming_strings';`,
    String.raw`SELECT 1;
CREATE TABLE U&"hidden\005ftable" (id int);`,
    String.raw`SELECT 1;
CREATE TABLE u&"hidden\005ftable" (id int);`,
    String.raw`SELECT 1;
DO LANGUAGE U&'plpgsql' $$BEGIN END$$;`,
  ]) {
    assert.deepEqual(analyzeMigrations([{ path: "unicode.sql", content }]).unreadable, ["unicode.sql:2"], content);
  }
});

test("Unicode escapes are unreadable inside recursively scanned bodies", () => {
  const scanned = analyzeMigrations([
    { path: "do.sql", content: String.raw`DO $$BEGIN
PERFORM set_config(U&'search\005fpath', 'private', true); END$$;` },
    { path: "function.sql", content: String.raw`CREATE FUNCTION f() RETURNS void AS 'BEGIN
CREATE TABLE U&"hidden\005ftable" (id int); END' LANGUAGE plpgsql;` },
    { path: "execute.sql", content: String.raw`DO $$BEGIN EXECUTE $s$SELECT 1;
CREATE TABLE u&"hidden\005ftable" (id int);$s$; END$$;` },
  ]);
  assert.deepEqual(scanned.unreadable, ["do.sql:2", "function.sql:2", "execute.sql:2"]);
});

test("newline-concatenated literals are unreadable in data, names, and executable bodies", () => {
  const scanned = analyzeMigrations([
    { path: "data.sql", content: "SELECT 'a'\n'b';" },
    { path: "body.sql", content: "DO 'CREATE '\n'TABLE hidden (id int);';" },
    { path: "language.sql", content: "DO LANGUAGE 'pl'\n'pgsql' $$BEGIN END$$;" },
    { path: "config.sql", content: "SELECT set_config('search'\n'_path', 'private', true);" },
    { path: "execute.sql", content: "DO $$BEGIN EXECUTE 'CREATE '\n'TABLE hidden (id int);'; END$$;" },
    { path: "function.sql", content: "CREATE FUNCTION f() RETURNS text AS $$SELECT 'a'\r\n'b';$$ LANGUAGE sql;" },
    { path: "comment.sql", content: "SELECT 'a' /* separator\ncomment */ 'b';" },
  ]);
  assert.deepEqual(scanned.unreadable, [
    "data.sql:2", "body.sql:2", "language.sql:2", "config.sql:2",
    "execute.sql:2", "function.sql:2", "comment.sql:2",
  ]);
});

test("plain literals, separate expressions, comments, and stored SQL text remain readable", () => {
  const scanned = analyzeMigrations([{
    path: "readable.sql",
    content: String.raw`-- U&'ignored' and 'a'
'ignored in comment'
/* u&"ignored" and 'a'
'ignored in comment' */
SELECT 'a' 'b', 'c',
'd';
SELECT 'a' ||
'b';
SELECT 'U&''data''', $$U&"stored"$$;
INSERT INTO templates(body) VALUES ($$SELECT 'a'
'b';$$);
DO LANGUAGE $$plpgsql$$ $b$BEGIN PERFORM 'plain'; END$b$;`,
  }]);
  assert.deepEqual(scanned.unreadable, []);
});

test("RESET, other literal settings, comments, string data, and column names are allowed", () => {
  const scanned = analyzeMigrations([{
    path: "allowed.sql",
    content: `
      RESET search_path;
      SELECT set_config('app.x', 'value', true), pg_catalog.set_config('app.x', 'value', false);
      SELECT set_config('app.it''s', 'value', true);
      -- SET search_path = private; SELECT set_config(setting_name, 'private', true);
      /* SET LOCAL "search_path" = private; SELECT set_config('search_path', 'private', true); */
      SELECT 'SET search_path = private; SELECT set_config(''search_path'', ''private'', true);';
      INSERT INTO templates(body) VALUES ($$SET search_path = private; SELECT set_config(setting_name, 'private', true);$$);
      CREATE TABLE t ("search_path" text);
      DO $$BEGIN PERFORM set_config('app.x', 'value', true);
      INSERT INTO templates(body) VALUES ('SET search_path = private;'); END$$;
      DO $$BEGIN EXECUTE 'SELECT set_config(''app.x'', ''value'', true);'; END$$;
    `,
  }]);
  assert.deepEqual(scanned.searchPath, []);
  assert.deepEqual([...scanned.tables.keys()], ["t"]);
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
  const { created, documented, dynamicSql, searchPath, unreadable } = repositoryDataModel(repositoryRoot);
  assert.ok(created.size > 10, "migration scan should discover non-trivial table coverage");
  assert.deepEqual(dynamicSql, [], "use a literal EXECUTE or document the table it creates");
  assert.deepEqual(searchPath, [], "schema-qualify tables instead of changing search_path");
  assert.deepEqual(unreadable, [], "write plain literals and identifiers the gate can read");
  assert.deepEqual(created.get("funding_orders"), new Set(["apps/web/server/funding/migrations/002_funding_provider_seam.sql"]));
  assert.deepEqual(evaluateDataModel({ created, documented, exemptions: EXEMPTIONS }), {
    undocumented: [],
    staleExemptions: [],
  });
});
