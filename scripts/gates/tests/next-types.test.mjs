import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { preflightGeneratedTypeLines } from "../preflight.mjs";
import {
  GENERATED_TYPE_DIRS,
  describeStaleReference,
  devServerState,
  pruneStaleNextTypes,
  staleTypeReferences,
} from "../../worktree/next-types.mjs";

const DEV_TYPES = "apps/web/.next/dev/types";
const BUILD_TYPES = "apps/web/.next/types";
const LOCK = "apps/web/.next/dev/lock";
const PID = 12345;

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), "home-next-types-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, file, content) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

function staleDevTypes(root) {
  write(root, `${DEV_TYPES}/validator.ts`, 'const handler = {} as typeof import("../../../app/removed/page.js");');
}

function lock(root, value = { pid: PID, port: 3101 }) {
  write(root, LOCK, JSON.stringify(value));
}

test("stale references name missing source files and ignore fresh sources and bare specifiers", (t) => {
  const root = scratch(t);
  assert.deepEqual(GENERATED_TYPE_DIRS, [DEV_TYPES, BUILD_TYPES]);
  assert.deepEqual(staleTypeReferences(root), []);
  const validator = `${DEV_TYPES}/validator.ts`;
  write(root, validator, [
    'import type { PageConfig } from "next/types.js";',
    'const handler = {} as typeof import("../../../app/removed/page.js");',
    ...["tsx", "ts", "jsx", "js", "mjs"].map((extension) => `export { default as ${extension} } from '../../../app/fresh-${extension}/page.js';`),
  ].join("\n"));
  for (const extension of ["tsx", "ts", "jsx", "js", "mjs"]) {
    write(root, `apps/web/app/fresh-${extension}/page.${extension}`, "export default function Page() {}\n");
  }
  write(root, `${BUILD_TYPES}/nested/extra.d.ts`, 'import "../../../app/other/page.js";');
  write(root, `${BUILD_TYPES}/ignored.txt`, 'import "../../../app/not-types/page.js";');
  const stale = staleTypeReferences(root);
  assert.deepEqual(stale, [
    { directory: DEV_TYPES, file: validator, module: "../../../app/removed/page.js", target: "apps/web/app/removed/page" },
    { directory: BUILD_TYPES, file: `${BUILD_TYPES}/nested/extra.d.ts`, module: "../../../app/other/page.js", target: "apps/web/app/other/page" },
  ]);
  assert.equal(describeStaleReference(stale[0]), `${validator} references apps/web/app/removed/page, which no longer exists`);
});

test("double-quoted imports report missing apostrophe paths", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, `const h = {} as typeof import("../../../app/it's-gone/page.js");`);
  assert.deepEqual(staleTypeReferences(root), [
    { directory: DEV_TYPES, file: `${DEV_TYPES}/validator.ts`, module: "../../../app/it's-gone/page.js", target: "apps/web/app/it's-gone/page" },
  ]);
});

test("double-quoted from imports preserve existing apostrophe paths", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, `export { default } from "../../../app/it's-here/page.js";`);
  write(root, "apps/web/app/it's-here/page.tsx", "export default function Page() {}");
  assert.deepEqual(staleTypeReferences(root), []);
});

test("single-quoted require calls report missing double-quote paths", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, `const h = require('../../../app/say"gone/page.js');`);
  assert.deepEqual(staleTypeReferences(root), [
    { directory: DEV_TYPES, file: `${DEV_TYPES}/validator.ts`, module: '../../../app/say"gone/page.js', target: 'apps/web/app/say"gone/page' },
  ]);
});

test("single-quoted side-effect imports preserve existing double-quote paths", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, `import '../../../app/say"here/page.js';`);
  write(root, 'apps/web/app/say"here/page.ts', "export {};");
  assert.deepEqual(staleTypeReferences(root), []);
});

test("escaped double-quoted imports report missing double-quote paths", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, String.raw`const handler = {} as typeof import("../../../app/say\"gone/page.js")`);
  assert.deepEqual(staleTypeReferences(root), [
    { directory: DEV_TYPES, file: `${DEV_TYPES}/validator.ts`, module: '../../../app/say"gone/page.js', target: 'apps/web/app/say"gone/page' },
  ]);
});

test("escaped double-quoted imports preserve existing double-quote paths", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, String.raw`const handler = {} as typeof import("../../../app/say\"here/page.js")`);
  write(root, 'apps/web/app/say"here/page.tsx', "export default function Page() {}");
  assert.deepEqual(staleTypeReferences(root), []);
});

test("escaped single-quoted imports report missing apostrophe paths", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, String.raw`const handler = {} as typeof import('../../../app/it\'s-gone/page.js')`);
  assert.deepEqual(staleTypeReferences(root), [
    { directory: DEV_TYPES, file: `${DEV_TYPES}/validator.ts`, module: "../../../app/it's-gone/page.js", target: "apps/web/app/it's-gone/page" },
  ]);
});

test("escaped single-quoted imports preserve existing apostrophe paths", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, String.raw`const handler = {} as typeof import('../../../app/it\'s-here/page.js')`);
  write(root, "apps/web/app/it's-here/page.tsx", "export default function Page() {}");
  assert.deepEqual(staleTypeReferences(root), []);
});

test("tab-escaped imports report deleted routes despite an existing lookalike", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, String.raw`const handler = {} as typeof import("../../../app/say\there/page.js")`);
  write(root, "apps/web/app/saythere/page.tsx", "export default function Page() {}");
  assert.deepEqual(staleTypeReferences(root), [
    { directory: DEV_TYPES, file: `${DEV_TYPES}/validator.ts`, module: "../../../app/say\there/page.js", target: "apps/web/app/say\there/page" },
  ]);
});

test("tab-escaped imports preserve existing routes alongside a lookalike", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, String.raw`const handler = {} as typeof import("../../../app/say\there/page.js")`);
  write(root, "apps/web/app/say\there/page.tsx", "export default function Page() {}");
  write(root, "apps/web/app/saythere/page.tsx", "export default function Page() {}");
  assert.deepEqual(staleTypeReferences(root), []);
});

test("unicode escapes decode to source path characters", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, String.raw`const handler = {} as typeof import("../../../app/say\u0022gone/page.js")`);
  assert.deepEqual(staleTypeReferences(root), [
    { directory: DEV_TYPES, file: `${DEV_TYPES}/validator.ts`, module: '../../../app/say"gone/page.js', target: 'apps/web/app/say"gone/page' },
  ]);
});

test("escaped backslashes remain literal source path characters", (t) => {
  const root = scratch(t);
  write(root, `${DEV_TYPES}/validator.ts`, String.raw`const handler = {} as typeof import("../../../app/say\\gone/page.js")`);
  assert.deepEqual(staleTypeReferences(root), [
    { directory: DEV_TYPES, file: `${DEV_TYPES}/validator.ts`, module: "../../../app/say\\gone/page.js", target: "apps/web/app/say\\gone/page" },
  ]);
});

test("fresh Next validators resolve routes.js to its generated routes.d.ts companion", (t) => {
  const root = scratch(t);
  for (const directory of GENERATED_TYPE_DIRS) {
    write(root, `${directory}/validator.ts`, 'import type { AppRoutes } from "./routes.js";');
    write(root, `${directory}/routes.d.ts`, 'export type AppRoutes = "/";');
  }
  assert.deepEqual(staleTypeReferences(root), []);
  assert.deepEqual(pruneStaleNextTypes(root), { state: "ready", stale: [] });
  for (const directory of GENERATED_TYPE_DIRS) assert.ok(existsSync(join(root, directory)));
});

test("pruning removes only stale type directories, preserving sibling output and caches", (t) => {
  const root = scratch(t);
  staleDevTypes(root);
  const survivors = [`${BUILD_TYPES}/routes.d.ts`, "apps/web/.next/dev/build-manifest.json", "apps/web/.next/cache/keep", "apps/web/.next/dev/cache/keep"];
  for (const file of survivors) write(root, file, "keep");
  const result = pruneStaleNextTypes(root);
  assert.equal(result.state, "pruned");
  assert.deepEqual(result.directories, [DEV_TYPES]);
  assert.equal(result.stale.length, 1);
  assert.equal(existsSync(join(root, DEV_TYPES)), false);
  for (const file of survivors) assert.equal(readFileSync(join(root, file), "utf8"), "keep");
  assert.deepEqual(pruneStaleNextTypes(root), { state: "ready", stale: [] });
});

test("both generated directories can be pruned when both contain stale references", (t) => {
  const root = scratch(t);
  staleDevTypes(root);
  write(root, `${BUILD_TYPES}/validator.ts`, 'const handler = {} as typeof import("../../app/gone/page.js");');
  assert.deepEqual(pruneStaleNextTypes(root).directories, GENERATED_TYPE_DIRS);
  for (const directory of GENERATED_TYPE_DIRS) assert.equal(existsSync(join(root, directory)), false);
});

test("a live pid protects generated types", (t) => {
  const root = scratch(t);
  staleDevTypes(root);
  lock(root, { pid: process.pid, port: 3101 });
  const devServer = devServerState(root);
  assert.deepEqual(devServer, { state: "running", pid: process.pid, port: 3101 });
  const before = readFileSync(join(root, `${DEV_TYPES}/validator.ts`), "utf8");
  const result = pruneStaleNextTypes(root, { devServer });
  assert.equal(result.state, "in-use");
  assert.deepEqual(result.devServer, devServer);
  assert.equal(readFileSync(join(root, `${DEV_TYPES}/validator.ts`), "utf8"), before);
  assert.equal(existsSync(join(root, LOCK)), true);
});

test("the same abandoned pid on re-check permits pruning without deleting the lock", (t) => {
  const root = scratch(t);
  staleDevTypes(root);
  lock(root);
  const devServer = devServerState(root, { isAlive: () => false });
  assert.deepEqual(devServer, { state: "abandoned", pid: PID });
  const result = pruneStaleNextTypes(root, { devServer, isAlive: () => false });
  assert.equal(result.state, "pruned");
  assert.deepEqual(result.directories, [DEV_TYPES]);
  assert.equal(existsSync(join(root, DEV_TYPES)), false);
  assert.equal(readFileSync(join(root, LOCK), "utf8"), '{"pid":12345,"port":3101}');
});

for (const devServer of [{ state: "stopped" }, { state: "abandoned", pid: PID }]) {
  test(`a live lock at deletion time overrides an initially ${devServer.state} snapshot`, (t) => {
    const root = scratch(t);
    staleDevTypes(root);
    write(root, `${BUILD_TYPES}/validator.ts`, 'import "../../app/gone/page.js";');
    write(root, `${DEV_TYPES}/routes.d.ts`, "keep dev");
    write(root, `${BUILD_TYPES}/routes.d.ts`, "keep build");
    lock(root, { pid: process.pid, port: 3176 });
    const result = pruneStaleNextTypes(root, { devServer });
    assert.equal(result.state, "in-use");
    assert.deepEqual(result.devServer, { state: "running", pid: process.pid, port: 3176 });
    assert.deepEqual(result.removedDirectories, []);
    assert.deepEqual(result.keptDirectories, [DEV_TYPES, BUILD_TYPES]);
    assert.equal(readFileSync(join(root, `${DEV_TYPES}/validator.ts`), "utf8"), 'const handler = {} as typeof import("../../../app/removed/page.js");');
    assert.equal(readFileSync(join(root, `${BUILD_TYPES}/validator.ts`), "utf8"), 'import "../../app/gone/page.js";');
    assert.equal(readFileSync(join(root, `${DEV_TYPES}/routes.d.ts`), "utf8"), "keep dev");
    assert.equal(readFileSync(join(root, `${BUILD_TYPES}/routes.d.ts`), "utf8"), "keep build");
  });
}

for (const [name, devServer, fresh] of [
  ["unknown lock", { state: "stopped" }, { state: "unknown" }],
  ["new abandoned lock", { state: "stopped" }, { state: "abandoned", pid: PID }],
  ["changed abandoned pid", { state: "abandoned", pid: PID }, { state: "abandoned", pid: 54321 }],
  ["changed live port", { state: "abandoned", pid: PID }, { state: "running", pid: PID, port: 3176 }],
]) {
  test(`a fresh ${name} prevents deletion`, (t) => {
    const root = scratch(t);
    staleDevTypes(root);
    const result = pruneStaleNextTypes(root, { devServer, recheckDevServer: () => fresh });
    assert.equal(result.state, "in-use");
    assert.deepEqual(result.devServer, fresh);
    assert.deepEqual(result.removedDirectories, []);
    assert.deepEqual(result.keptDirectories, [DEV_TYPES]);
    assert.equal(readFileSync(join(root, `${DEV_TYPES}/validator.ts`), "utf8"), 'const handler = {} as typeof import("../../../app/removed/page.js");');
  });
}

test("a lock acquired while checking the second directory leaves both directories intact", (t) => {
  const root = scratch(t);
  staleDevTypes(root);
  write(root, `${BUILD_TYPES}/validator.ts`, 'import "../../app/gone/page.js";');
  let checks = 0;
  const result = pruneStaleNextTypes(root, {
    devServer: { state: "stopped" },
    recheckDevServer: () => {
      if (++checks === 2) lock(root, { pid: process.pid, port: 3101 });
      return devServerState(root);
    },
  });
  assert.equal(result.state, "in-use");
  assert.deepEqual(result.removedDirectories, []);
  assert.deepEqual(result.keptDirectories, [DEV_TYPES, BUILD_TYPES]);
  assert.equal(readFileSync(join(root, `${DEV_TYPES}/validator.ts`), "utf8"), 'const handler = {} as typeof import("../../../app/removed/page.js");');
  assert.equal(readFileSync(join(root, `${BUILD_TYPES}/validator.ts`), "utf8"), 'import "../../app/gone/page.js";');
});

test("a lock acquired immediately before deletion prevents removal after the pre-check", (t) => {
  const root = scratch(t);
  staleDevTypes(root);
  let checks = 0;
  const result = pruneStaleNextTypes(root, {
    devServer: { state: "stopped" },
    recheckDevServer: () => {
      if (++checks === 2) lock(root, { pid: process.pid, port: 3101 });
      return devServerState(root);
    },
  });
  assert.equal(result.state, "in-use");
  assert.deepEqual(result.removedDirectories, []);
  assert.deepEqual(result.keptDirectories, [DEV_TYPES]);
  assert.equal(readFileSync(join(root, `${DEV_TYPES}/validator.ts`), "utf8"), 'const handler = {} as typeof import("../../../app/removed/page.js");');
});

test("a late lock stops further deletion and reports removed and kept directories", (t) => {
  const root = scratch(t);
  staleDevTypes(root);
  write(root, `${BUILD_TYPES}/validator.ts`, 'import "../../app/gone/page.js";');
  let checks = 0;
  const result = pruneStaleNextTypes(root, {
    devServer: { state: "stopped" },
    recheckDevServer: () => {
      if (++checks === 4) lock(root, { pid: process.pid, port: 3101 });
      return devServerState(root);
    },
  });
  // Lock checks and directory removals are not atomic; an earlier removal cannot be undone.
  assert.equal(result.state, "in-use");
  assert.deepEqual(result.removedDirectories, [DEV_TYPES]);
  assert.deepEqual(result.keptDirectories, [BUILD_TYPES]);
  assert.equal(existsSync(join(root, DEV_TYPES)), false);
  assert.equal(readFileSync(join(root, `${BUILD_TYPES}/validator.ts`), "utf8"), 'import "../../app/gone/page.js";');
});

test("absent locks are stopped, but unreadable or invalid locks protect generated files", (t) => {
  const root = scratch(t);
  staleDevTypes(root);
  assert.deepEqual(devServerState(root), { state: "stopped" });
  for (const content of ["invalid JSON", "null", "{}", '{"pid":-1,"port":3101}', '{"pid":12345}']) {
    write(root, LOCK, content);
    assert.deepEqual(devServerState(root), { state: "unknown" });
    const result = pruneStaleNextTypes(root);
    assert.equal(result.state, "in-use");
    assert.equal(result.devServer.state, "unknown");
    assert.ok(existsSync(join(root, `${DEV_TYPES}/validator.ts`)));
  }
  rmSync(join(root, LOCK));
  mkdirSync(join(root, LOCK));
  assert.deepEqual(devServerState(root), { state: "unknown" });
});

test("preflight names stale generated state and bootstrap without deleting anything", (t) => {
  const root = scratch(t);
  assert.deepEqual(preflightGeneratedTypeLines(root), []);
  staleDevTypes(root);
  assert.deepEqual(preflightGeneratedTypeLines(root), [
    "Home's generated Next type output is stale in this worktree:",
    `  - ${DEV_TYPES}/validator.ts references apps/web/app/removed/page, which no longer exists`,
    "Run `bun run worktree:bootstrap`, then rerun this command.",
  ]);
  for (const state of ["running", "unknown"]) {
    const lines = preflightGeneratedTypeLines(root, { devServer: { state } });
    assert.match(lines.join("\n"), /Stop the dev server first.*apps\/web\/\.next\/dev\/lock/);
    assert.equal(lines.at(-1), "Run `bun run worktree:bootstrap`, then rerun this command.");
  }
  assert.ok(existsSync(join(root, `${DEV_TYPES}/validator.ts`)));
});
