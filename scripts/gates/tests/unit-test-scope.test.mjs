import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { CATEGORY_IDS, MANIFEST_PATH, checkUnitTestScope, run } from "../unit-test-scope.mjs";
import { gitFixtureEnv } from "./git-fixture-env.mjs";

const protectedFile = "server/actions/confirm.test.ts";
const residue = "client/query/cache.test.ts";
const scope = { pattern: "server/actions/**", category: "action-lifecycle" };
const grandfather = { path: residue, reason: "Existing query plumbing suite." };
const manifest = () => ({ categories: Object.fromEntries(CATEGORY_IDS.map((id) => [id, "Protected policy category."])), scopes: [{ ...scope }], grandfathered: [{ ...grandfather }] });

function fixture(t, paths = [protectedFile, residue]) {
  const root = mkdtempSync(join(tmpdir(), "unit-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, env: gitFixtureEnv(), stdio: "pipe" });
  const write = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  git("init", "-q");
  for (const path of paths) write(`apps/web/${path}`, "export {};\n");
  const save = (value) => write(MANIFEST_PATH, JSON.stringify(value));
  save(manifest());
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "initial");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return { root, git, write, save, check: () => checkUnitTestScope({ root, baseRef: "main" }) };
}

function findings(t, change) {
  const f = fixture(t);
  const value = manifest();
  change(value, f);
  f.save(value);
  return f.check().findings.join("\n");
}

test("the real indexed unit tests all have a policy category or reasoned residue", () => {
  const result = checkUnitTestScope();
  assert.ok(result.total > 0);
  assert.deepEqual(result.findings, []);
  assert.equal(result.scoped + result.grandfathered, result.total);
});

test("fixture discovery covers Bun names and extensions, excludes stories and Playwright, and reads the index", (t) => {
  const paths = [protectedFile, residue, ...["js", "jsx", "ts", "tsx", "mts", "cts", "mjs", "cjs"].map((ext, i) => `server/actions/case${i}${[".test.", "_test.", ".spec.", "_spec."][i % 4]}${ext}`), "server/actions/browser.test.pw.ts", "stories/board.test.ts", "server/actions/view.test.stories.tsx", ".hidden/ignored.test.ts", "node_modules/ignored.test.ts", "storybook-static/ignored.test.ts"];
  const f = fixture(t, paths);
  f.write("apps/web/client/query/not-indexed.test.ts", "export {};\n");
  assert.equal(f.check().total, 10);
  assert.deepEqual(f.check().findings.map((line) => line.split(":")[0]), ["server/actions/case1_test.jsx", "server/actions/case2.spec.ts", "server/actions/case3_spec.tsx", "server/actions/case5_test.cts", "server/actions/case6.spec.mjs", "server/actions/case7_spec.cjs"]);
  f.git("add", "apps/web/client/query/not-indexed.test.ts");
  assert.match(f.check().findings.join("\n"), /not-indexed.test.ts.*docs\/architecture.md#test-policy.*scope requires a policy category/);
});

test("an unclassified indexed test names its path, policy and scope requirement", (t) => {
  assert.match(findings(t, (value) => { value.grandfathered = []; }), /client\/query\/cache.test.ts.*docs\/architecture.md#test-policy.*adding a scope requires a policy category/);
});

test("deleted grandfathered tests must leave the residue list", (t) => {
  assert.match(findings(t, (_value, f) => { f.git("rm", `apps/web/${residue}`); }), /Stale grandfathered path: client\/query\/cache.test.ts.*no longer exists/);
});

test("newly protected grandfathered tests must leave the residue list", (t) => {
  assert.match(findings(t, (value) => { value.scopes.push({ pattern: residue, category: "auth" }); }), /Stale grandfathered path: client\/query\/cache.test.ts.*now matches a scope/);
});

test("empty scopes fail rather than silently surviving deletion", (t) => {
  assert.match(findings(t, (value) => { value.scopes.push({ pattern: "server/auth/**", category: "auth" }); }), /Scope server\/auth\/\*\* matches zero/);
});

for (const target of ["categories", "scopes"]) {
  test(`unknown ${target} category ids fail`, (t) => {
    assert.match(findings(t, (value) => {
      if (target === "categories") value.categories.presentation = "Not protected.";
      else value.scopes[0] = { ...scope, category: "presentation" };
    }), /Unknown category id: presentation/);
  });
}

for (const target of ["scopes", "grandfathered"]) {
  test(`duplicate ${target} entries fail`, (t) => {
    assert.match(findings(t, (value) => { value[target].push(value[target][0]); }), /Duplicate (?:scope pattern|grandfathered path)/);
  });
}

test("overlapping scopes cannot classify one test twice", (t) => {
  assert.match(findings(t, (value) => { value.scopes.push({ pattern: protectedFile, category: "auth" }); }), /Duplicate scope classification: server\/actions\/confirm.test.ts/);
});

for (const pattern of ["**", "server/**", "shared/**", "client/account/**", "components/**", "server/*/confirm.test.ts", "server/{actions,auth}/**", "../server/actions/**"]) {
  test(`overbroad scope ${pattern} fails`, (t) => {
    assert.match(findings(t, (value) => { value.scopes[0] = { pattern, category: "auth" }; }), /Invalid scope/);
  });
}

test("shared parser globs and one-directory client filename globs stay narrow", (t) => {
  const f = fixture(t, [protectedFile, residue, "shared/funding/contract-order.test.ts"]);
  const value = manifest();
  value.grandfathered = [];
  value.scopes.push({ pattern: "client/query/cache*.test.ts", category: "auth" }, { pattern: "shared/**/contract*.test.ts", category: "route-contract-parser" });
  f.save(value);
  assert.deepEqual(f.check().findings, []);
});

test("grandfathering can shrink but cannot admit a new path against the base", (t) => {
  const f = fixture(t);
  const value = manifest();
  f.write("apps/web/client/query/new.test.ts", "export {};\n");
  f.git("add", "apps/web/client/query/new.test.ts");
  value.grandfathered.push({ path: "client/query/new.test.ts", reason: "New debt." });
  f.save(value);
  assert.match(f.check().findings.join("\n"), /New grandfathered path: client\/query\/new.test.ts.*only shrink/);
  f.git("rm", "--cached", "apps/web/client/query/new.test.ts");
  f.git("rm", `apps/web/${residue}`);
  value.grandfathered = [];
  f.save(value);
  assert.deepEqual(f.check().findings, []);
});

for (const mutation of [
  (value) => { delete value.categories.auth; },
  (value) => { value.categories.auth = ""; },
  (value) => { value.scopes = null; },
  (value) => { value.grandfathered = null; },
  (value) => { value.grandfathered[0].reason = " "; },
]) {
  test("malformed policy input fails closed", (t) => assert.ok(findings(t, mutation).length));
}

test("a missing base manifest admits the initial residue, but unreadable bases fail closed", (t) => {
  const f = fixture(t);
  f.git("rm", MANIFEST_PATH);
  f.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "without manifest");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.save(manifest());
  assert.deepEqual(f.check().findings, []);
  assert.throws(() => checkUnitTestScope({ root: f.root, baseRef: "missing" }));
});

test("CLI entrypoint returns failure for an invalid manifest", (t) => {
  const f = fixture(t);
  f.save({});
  assert.equal(run({ root: f.root, baseRef: "main" }), 1);
});
