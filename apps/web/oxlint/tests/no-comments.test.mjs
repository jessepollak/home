import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const { lint } = await createOxlintWorkspace("home-oxlint-comments-", {
  path: (name) => `client/${name}.ts`,
  rules: ["no-comments"],
});

describe("home/no-comments", () => {
  it("rejects line, block, JSDoc, and JSX comments", async () => {
    const found = await lint({
      comments: { path: "client/comments.tsx", code: `
// line
/* block */
/** JSDoc */
export function Example() { return <div>{/* JSX */}</div>; }
` },
    });
    expect(found.comments).toHaveLength(4);
  }, budgetMs);

  it("allows only one-line @public JSDoc with a reason on an export", async () => {
    const found = await lint({
      explained: "/** @public Shared contract consumed by external clones. */\nexport const shared = true;",
      unexplained: "/** @public */\nexport const unexplained = true;",
      multiline: "/** @public Reason.\n * More detail. */\nexport const multiline = true;",
      privateValue: "/** @public Not an export. */\nconst privateValue = true;",
      misplaced: "/** @public Misplaced export annotation. */\nconst privateValue = true;\nexport const shared = privateValue;",
    });
    expect(found.explained).toHaveLength(0);
    expect(found.unexplained).toHaveLength(1);
    expect(found.multiline).toHaveLength(1);
    expect(found.privateValue).toHaveLength(1);
    expect(found.misplaced).toHaveLength(1);
  }, budgetMs);

  it("allows oxlint disable directives only when they carry a reason", async () => {
    const found = await lint({
      reasoned: "// oxlint-disable-next-line no-console -- console output is the fixture contract.\nconsole.log('ok');",
      unreasoned: "// oxlint-disable-next-line no-console\nconsole.log('no reason');",
      notADirective: "// oxlint-disable-note -- not a directive\nexport {};",
      jsxReasoned: { path: "client/jsx-reasoned.tsx", code: "export const node = <div>{/* oxlint-disable-next-line react/jsx-key -- upstream nodes have stable identity. */}</div>;" },
    });
    expect(found.reasoned).toHaveLength(0);
    expect(found.unreasoned).toHaveLength(1);
    expect(found.notADirective).toHaveLength(1);
    expect(found.jsxReasoned).toHaveLength(0);
  }, budgetMs);

  it("allows triple-slash references", async () => {
    const found = await lint({ reference: '/// <reference types="bun-types" />\nexport {};' });
    expect(found.reference).toHaveLength(0);
  }, budgetMs);

  it("allows a third-party licence or notice only as a file header", async () => {
    const found = await lint({
      header: "/* SPDX-License-Identifier: MIT */\nexport {};",
      trailing: "export {};\n/* SPDX-License-Identifier: MIT */",
    });
    expect(found.header).toHaveLength(0);
    expect(found.trailing).toHaveLength(1);
  }, budgetMs);
});
