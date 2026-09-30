import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
applyRuleCheckTimeout();

// Every case spawns an oxlint child and cleanup deletes its temporary mirror, so each phase gets its own
// budget instead of sharing bun's 5 s default budget under concurrent load.
const budgetMs = 20_000;

const appsWebDir = fileURLToPath(new URL("../..", import.meta.url));
const mirror = await mkdtemp(path.join(tmpdir(), "home-exploration-tag-"));
await cp(path.join(appsWebDir, "oxlint"), path.join(mirror, "oxlint"), { recursive: true });
await symlink(path.join(appsWebDir, "node_modules"), path.join(mirror, "node_modules"), "dir");
await writeFile(path.join(mirror, ".oxlintrc.jsonc"), JSON.stringify({
  plugins: [], categories: { correctness: "off" },
  jsPlugins: ["./oxlint/home-plugin.mjs"],
  rules: { "home/exploration-story-tag": "error" },
}));
afterAll(() => rm(mirror, { recursive: true, force: true }), budgetMs);

async function diagnostics(fixtures) {
  const directory = path.join(mirror, "stories/explorations");
  await mkdir(directory, { recursive: true });
  const files = await Promise.all(Object.entries(fixtures).map(async ([name, code]) => {
    const file = `stories/explorations/${name}.stories.tsx`;
    await writeFile(path.join(mirror, file), code);
    return file;
  }));
  const result = spawnSync(path.join(appsWebDir, "node_modules/.bin/oxlint"),
    ["-c", ".oxlintrc.jsonc", "--disable-nested-config", "-f", "json", ...files],
    { cwd: mirror, encoding: "utf8" });
  expect(result.signal).toBeNull();
  expect([0, 1]).toContain(result.status);
  const findings = Object.fromEntries(Object.keys(fixtures).map((name) => [name, []]));
  for (const diagnostic of JSON.parse(result.stdout).diagnostics.filter((item) => item.code === "home(exploration-story-tag)")) {
    findings[path.basename(diagnostic.filename, ".stories.tsx")].push(diagnostic);
  }
  return findings;
}

describe("home/exploration-story-tag", () => {
  it("requires an explicit exploration tag on the default meta", async () => {
    const fixtures = {
      "missing-meta-tag": 'const meta = { id: "x" }; export default meta;',
      "other-meta-tag": 'export default { id: "x", tags: ["other"] };',
      "story-only-tag": 'const meta = { id: "x" }; export default meta; export const One = { tags: ["exploration"] };',
      "no-default-meta": 'export const One = { tags: ["exploration"] };',
    };
    const findings = await diagnostics(fixtures);
    for (const name of Object.keys(fixtures)) {
      expect(findings[name]).toHaveLength(1);
    }
  }, budgetMs);

  it("rejects mutable or indirect meta and tags", async () => {
    const invalid = [
      'let meta = { tags: ["exploration"] }; meta = { id: "y" }; export default meta;',
      'var meta = { tags: ["exploration"] }; export default meta;',
      'const meta = { tags: ["exploration"], ...{ tags: ["other"] } }; export default meta;',
      'const tags = ["exploration"]; export default { tags };',
      'const tags = ["exploration"]; export default { tags: tags };',
      'const meta = { tags: ["exploration"] }; export default { ...meta };',
      'export default { tags: ["exploration", ...["other"]] };',
      'export default { tags: ["exploration"], tags: ["other"] };',
      'export default Object.assign({}, { tags: ["exploration"] });',
      'export default { ["tags"]: ["exploration"] };',
      'const meta = true ? { tags: ["exploration"] } : { tags: ["other"] }; export default meta;',
    ];
    const fixtures = Object.fromEntries(invalid.map((code, index) => [`invalid-${index + 1}`, code]));
    const findings = await diagnostics(fixtures);
    for (const [name, code] of Object.entries(fixtures)) {
      expect(findings[name], code).toHaveLength(1);
      expect(findings[name][0].message, code).toContain("Use inline exploration meta");
    }
  }, budgetMs);

  it("accepts direct inline and const meta with literal tags and type wrappers", async () => {
    const fixtures = {
      "direct-inline": 'export default { id: "x", tags: ["test", "exploration"] };',
      "inline-as": 'export default { tags: ["exploration"] } as object;',
      "inline-satisfies": 'export default { tags: ["exploration"] } satisfies object;',
      "const-satisfies": 'const meta = { id: "x", tags: ["exploration"] } satisfies object; export default meta;',
      "const-as": 'const meta = { tags: ["exploration"] } as object; export default meta;',
      "exported-const": 'export const meta = { tags: ["exploration"] }; export default meta as object;',
    };
    const findings = await diagnostics(fixtures);
    for (const name of Object.keys(fixtures)) {
      expect(findings[name]).toHaveLength(0);
    }
  }, budgetMs);
});
