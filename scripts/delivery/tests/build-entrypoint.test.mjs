import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluateBuildEntrypoints } from "../build-entrypoint.mjs";

// The production build entrypoint contract (#418): migrations are attached to
// the Vercel-facing apps/web build, and the root build only delegates.

async function readBuildScript(manifestUrl) {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  return manifest.scripts?.build ?? "";
}

test("current manifests satisfy the build entrypoint contract", async () => {
  const rootBuild = await readBuildScript(new URL("../../../package.json", import.meta.url));
  const appBuild = await readBuildScript(new URL("../../../apps/web/package.json", import.meta.url));
  assert.deepEqual(evaluateBuildEntrypoints({ rootBuild, appBuild }), []);
});

test("synthetic passing control delegates and migrates before building", () => {
  assert.deepEqual(
    evaluateBuildEntrypoints({
      rootBuild: "bun run --cwd apps/web build",
      appBuild: "bun run db:migrate && next build",
    }),
    [],
  );
});

test("synthetic broken controls fail the contract", () => {
  const rootBuildsOwnBuild = evaluateBuildEntrypoints({
    rootBuild: "next build",
    appBuild: "bun run db:migrate && next build",
  });
  assert.equal(rootBuildsOwnBuild.length, 1);
  assert.match(rootBuildsOwnBuild[0], /root build must delegate/);

  const buildWithoutMigration = evaluateBuildEntrypoints({
    rootBuild: "bun run --cwd apps/web build",
    appBuild: "next build",
  });
  assert.equal(buildWithoutMigration.length, 1);
  assert.match(buildWithoutMigration[0], /db:migrate before next build/);

  const migrationAfterBuild = evaluateBuildEntrypoints({
    rootBuild: "bun run --cwd apps/web build",
    appBuild: "next build && bun run db:migrate",
  });
  assert.equal(migrationAfterBuild.length, 1);
  assert.match(migrationAfterBuild[0], /before next build, not after/);
});
