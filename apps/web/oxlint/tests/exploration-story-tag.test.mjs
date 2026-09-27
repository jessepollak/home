import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-exploration-tag-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
await writeFile(path.join(mirror, ".oxlintrc.jsonc"), JSON.stringify({
  plugins: [], categories: { correctness: "off" },
  jsPlugins: ["./oxlint/home-plugin.mjs"],
  rules: { "home/exploration-story-tag": "error" },
}));
afterAll(() => rm(mirror, { recursive: true, force: true }));

let fixtureIndex = 0;
async function diagnostics(code) {
  const file = `stories/explorations/fixture-${++fixtureIndex}.stories.tsx`;
  await mkdir(path.dirname(path.join(mirror, file)), { recursive: true });
  await writeFile(path.join(mirror, file), code);
  const result = spawnSync(path.join(appsWebDir, "node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "-f", "json", file],
    { cwd: mirror, encoding: "utf8" });
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  return JSON.parse(result.stdout).diagnostics.filter((diagnostic) => diagnostic.code === "home(exploration-story-tag)");
}

describe("home/exploration-story-tag", () => {
  it("requires an explicit exploration tag on the default meta", async () => {
    expect(await diagnostics('const meta = { id: "x" }; export default meta;')).toHaveLength(1);
    expect(await diagnostics('export default { id: "x", tags: ["other"] };')).toHaveLength(1);
    expect(await diagnostics('const meta = { id: "x" }; export default meta; export const One = { tags: ["exploration"] };')).toHaveLength(1);
    expect(await diagnostics('export const One = { tags: ["exploration"] };')).toHaveLength(1);
  });

  it("accepts a default meta with the tag even alongside other tags", async () => {
    expect(await diagnostics('const meta = { id: "x", tags: ["exploration"] } satisfies object; export default meta;')).toHaveLength(0);
    expect(await diagnostics('export default { id: "x", tags: ["test", "exploration"] };')).toHaveLength(0);
  });
});
