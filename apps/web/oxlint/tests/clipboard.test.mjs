import { applyRuleCheckTimeout } from "./rule-check-timeout.mjs";
import { describe, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { budgetMs, createOxlintWorkspace } from "./helpers/oxlint-workspace.mjs";
applyRuleCheckTimeout();

const rule = "no-raw-clipboard-write";
const { directory, lint, lintWithConfig } = await createOxlintWorkspace("home-oxlint-clipboard-", {
  rules: [rule],
});
const message = "Use CopyableValue / AddressText instead of raw clipboard writes in product code.";

async function checkCases(cases, count) {
  const findings = await lint(cases);
  for (const [name, diagnostics] of Object.entries(findings)) {
    expect(diagnostics, name).toHaveLength(count);
    for (const diagnostic of diagnostics) expect(diagnostic.message, name).toBe(message);
  }
}

describe(rule, () => {
  it("rejects method access, not just calls, including optional, computed and window access", async () => {
    await checkCases({
      text: 'navigator.clipboard.writeText("value");',
      items: "navigator.clipboard.write(items);",
      reference: "const copy = navigator.clipboard.writeText;",
      availability: "if (navigator.clipboard?.writeText) copy();",
      optionalClipboard: 'navigator.clipboard?.writeText("value");',
      optionalNavigator: 'navigator?.clipboard?.writeText?.("value");',
      optionalWrite: "navigator.clipboard.write?.(items);",
      window: 'window.navigator.clipboard.writeText("value");',
      optionalWindow: "window?.navigator?.clipboard?.write?.(items);",
      computed: 'window["navigator"]["clipboard"]["writeText"]("value");',
      template: 'navigator.clipboard[`write`](items);',
      global: 'globalThis.navigator.clipboard.writeText("value");',
      assertion: '(navigator.clipboard as Clipboard).writeText("value");',
      nonnull: 'navigator.clipboard!.writeText("value");',
      parenthesizedChain: '(navigator.clipboard?.writeText)("value");',
    }, 1);
  }, budgetMs);

  it("follows scoped aliases, destructuring, nested patterns and assignments", async () => {
    await checkCases({
      alias: 'const clipboard = navigator.clipboard; clipboard.writeText("value");',
      destructured: 'const { clipboard } = navigator; clipboard.writeText("value");',
      renamed: 'const { clipboard: copyTarget } = navigator; copyTarget.write(items);',
      aliasChain: 'const nav = window.navigator; const clipboard = nav.clipboard; const target = clipboard; target?.writeText("value");',
      windowPattern: 'const { navigator: { clipboard: target } } = window; target.write(items);',
      navigatorPattern: 'const { navigator: nav } = window; const { clipboard: target } = nav; target.writeText("value");',
      defaultPattern: 'const { clipboard: target = fallback } = navigator; target.writeText("value");',
      assigned: 'let target; target = navigator.clipboard; target.write(items);',
      assignedPattern: 'let target; ({ clipboard: target } = navigator); target.write(items);',
      lateDeclaration: 'function copy() { return target.writeText("value"); } const target = navigator.clipboard;',
      outerScope: 'const target = navigator.clipboard; function copy() { return target.writeText("value"); }',
      computedPattern: 'const { ["clipboard"]: target } = navigator; target["write"](items);',
    }, 1);
  }, budgetMs);

  it("rejects destructured writer methods even without invoking them", async () => {
    await checkCases({
      text: "const { writeText } = navigator.clipboard;",
      renamed: "const { write: copy } = window.navigator.clipboard;",
      nested: "const { clipboard: { writeText: copy } } = navigator;",
      computed: 'const { ["writeText"]: copy } = navigator.clipboard;',
      aliased: "const target = navigator.clipboard; const { write: copy } = target;",
      assigned: "let copy; ({ writeText: copy } = navigator.clipboard);",
    }, 1);
  }, budgetMs);

  it("permits paste reads, shared controls and unrelated or shadowed objects", async () => {
    await checkCases({
      read: "navigator.clipboard.readText(); navigator.clipboard?.read();",
      aliasRead: "const { clipboard: target } = window.navigator; target.readText();",
      destructuredRead: "const { readText: paste } = navigator.clipboard;",
      controls: 'import { CopyableValue } from "@/components/copyable-value"; const control = <CopyableValue value="value" />;',
      unrelated: "other.clipboard.writeText(value); clipboard.write(value);",
      navigatorParameter: "function copy(navigator) { navigator.clipboard.writeText(value); }",
      windowParameter: "function copy(window) { window.navigator.clipboard.write(value); }",
      imported: 'import navigator from "./navigator"; navigator.clipboard.writeText(value);',
      shadowedAlias: "const target = navigator.clipboard; function copy(target) { target.writeText(value); }",
      siblingScope: "function first() { const target = navigator.clipboard; } function second() { const target = other; target.write(value); }",
      cyclicAlias: "const target = alias; const alias = target; target.writeText(value);",
    }, 0);
  }, budgetMs);

  it("uses the repository override to exclude only the owner and non-product files", async () => {
    const source = await readFile(new URL("../../.oxlintrc.jsonc", import.meta.url), "utf8");
    const parsed = ts.parseConfigFileTextToJson(".oxlintrc.jsonc", source);
    expect(parsed.error).toBeUndefined();
    const overrides = parsed.config.overrides.filter((override) => override.rules?.[`home/${rule}`]);
    expect(overrides).toHaveLength(1);
    const config = ".oxlintrc-clipboard-scope.json";
    await writeFile(path.join(directory, config), JSON.stringify({
      plugins: [], categories: { correctness: "off" },
      env: { browser: true }, jsPlugins: ["./oxlint/home-plugin.mjs"], overrides,
    }));
    const code = 'navigator.clipboard.writeText("value");';
    const included = [
      "app/page.tsx", "client/funding/add-money-dialog.tsx", "components/other.tsx",
      "components/nested/copyable-value.tsx", "components/ui/other.tsx",
    ];
    const excluded = [
      "components/copyable-value.tsx", "client/copy.test.tsx", "components/copy.stories.tsx",
      "client/explorations/copy.tsx", "client/testing/copy.tsx", "components/tests/copy.tsx",
      "server/copy.ts", "shared/copy.ts", "stories/copy.tsx",
    ];
    const fixtures = Object.fromEntries([...included, ...excluded].map((file) => [file, { path: file, code }]));
    const findings = await lintWithConfig(fixtures, { config });
    for (const file of included) expect(findings[file], file).toHaveLength(1);
    for (const file of excluded) expect(findings[file], file).toHaveLength(0);
  }, budgetMs);
});
