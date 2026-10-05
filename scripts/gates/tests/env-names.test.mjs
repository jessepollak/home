import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkEnvNames, parseEnvNames, REGENERATE_COMMAND, renderEnvNames } from "../env-names.mjs";

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "home-env-names-"));
  try {
    await mkdir(path.join(root, "apps/web/server/config"), { recursive: true });
    await writeFile(path.join(root, ".env.example"), "HOME_Z=\n# HOME_A=\n");
    await run(root, path.join(root, "apps/web/server/config/env-names.ts"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("documented env names include commented declarations and are unique and sorted", () => {
  assert.deepEqual(parseEnvNames(" HOME_Z=\n# HOME_A=\n #HOME_B=\nHOME_A=value\n# prose HOME_C=\nlowercase=\nHOME_NO_EQUALS\n"), ["HOME_A", "HOME_B", "HOME_Z"]);
  assert.throws(() => renderEnvNames("# no declarations"), /at least one/);
});

test("generated env names match .env.example", async () => {
  await checkEnvNames();
});

test("missing or stale generated names fail with the exact regeneration command", async () => {
  await fixture(async (root, generatedPath) => {
    for (const content of [undefined, renderEnvNames("HOME_A=\n"), "stale"]) {
      if (content !== undefined) await writeFile(generatedPath, content);
      await assert.rejects(checkEnvNames(root), (error) => error.message.endsWith(REGENERATE_COMMAND));
    }
    await checkEnvNames(root, { write: true });
    await checkEnvNames(root);
    await writeFile(path.join(root, ".env.example"), "HOME_Z=\n# HOME_A=\nHOME_NEW=\n");
    await assert.rejects(checkEnvNames(root), /missing or stale/);
  });
});
