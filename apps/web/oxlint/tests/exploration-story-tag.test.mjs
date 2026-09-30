import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

// Every case spawns an oxlint child and cleanup deletes its temporary mirror, so each phase gets its own
// budget instead of sharing bun's 5 s default budget under concurrent load.

const { lint: diagnostics } = await createOxlintWorkspace("home-exploration-tag-", {
  path: (name) => `stories/explorations/${name}.stories.tsx`,
  rules: ["exploration-story-tag"],
});

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
