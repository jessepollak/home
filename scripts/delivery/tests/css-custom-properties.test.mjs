import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collectCustomProperties, evaluateCustomPropertyResolution } from "../css-custom-properties.mjs";
import { loadSourceFiles } from "../source-files.mjs";

// Every var(--name) use in app CSS must resolve to a declaration in CSS, an
// inline TS/TSX provider, or a framework/runtime-injected exception below.
// The allowlist fails stale in both directions: once a property is declared in
// the repository, or once no CSS var() uses it anymore, the exception must be
// removed.

// Injected at runtime by @base-ui/react positioner and popup primitives, or by
// Tailwind's default theme scale. Never declared in app sources.
const RUNTIME_ALLOWED = [
  "available-height", // @base-ui/react positioner
  "available-width", // @base-ui/react positioner
  "popup-width", // @base-ui/react popover popup
  "shadow-lg", // Tailwind v4 default theme token
  "transform-origin", // @base-ui/react positioner
];

test("collection resolves local, global, and inline TS/TSX providers", () => {
  const { defined, usedInCss } = collectCustomProperties([
    { path: "app/globals.css", content: ":root { --global-token: red; --1px-token: 1px; --_private-token: 2px; }\n.x { color: var(--global-token); border: var(--1px-token); gap: var(--_private-token); }\n" },
    { path: "components/ui/local.module.css", content: ".y { color: var(--local-token); --local-token: blue; }\n" },
    { path: "client/fixture.tsx", content: "export const A = () => <div style={{ \"--inline-token\": \"1px\" }} />;\n" },
    { path: "client/probe.ts", content: "el.style.setProperty(\"--setproperty-token\", v);\n" },
    { path: "client/chain.tsx", content: "popoverRef.current?.style.setProperty(\n  \"--multiline-token\",\n  value,\n);\n" },
  ]);

  assert.ok(defined.has("global-token"));
  assert.ok(defined.has("local-token"));
  assert.ok(defined.has("inline-token"));
  assert.ok(defined.has("setproperty-token"));
  assert.ok(defined.has("multiline-token"));
  // Valid names may contain underscores and start with a digit.
  assert.ok(defined.has("1px-token"));
  assert.ok(defined.has("_private-token"));
  assert.deepEqual([...usedInCss.keys()].sort(), ["1px-token", "_private-token", "global-token", "local-token"]);
});

test("quoted lookups, constants, comments, and test files are not providers", () => {
  const { defined } = collectCustomProperties([
    // A quoted "--name" alone does not define a property: constants,
    // getPropertyValue, and removeProperty are consumers, not providers.
    { path: "client/probe.ts", content: "const KEY = \"--const-token\";\nel.style.getPropertyValue(\"--read-token\");\nel.style.removeProperty(\"--removed-token\");\n" },
    // Commented-out provider code is not a definition.
    { path: "client/commented.tsx", content: "// el.style.setProperty(\"--commented-set\", v);\n/* { \"--commented-key\": 1 } */\n" },
    // Tailwind arbitrary properties in class strings are not counted as providers.
    { path: "client/tailwind.tsx", content: "const cls = \"[--tailwind-token:0px]\";\n" },
    // Test files, tests directories, and .d.ts never define a property at runtime.
    { path: "client/fixture.test.tsx", content: "const x = { \"--test-file-key\": \"1px\" };\nel.style.setProperty(\"--test-file-set\", v);\n" },
    { path: "client/__tests__/probe.tsx", content: "el.style.setProperty(\"--tests-dir-set\", v);\n" },
    { path: "client/types.d.ts", content: "interface Fixture { \"--declared-key\": string; }\n" },
  ]);

  assert.deepEqual([...defined.keys()], []);
});

test("evaluation reports missing, allowed, and stale-allowlist cases", () => {
  const { defined, usedInCss } = collectCustomProperties([
    { path: "app/a.css", content: ":root { --defined-token: red; --gone-token: blue; }\n.x { color: var(--defined-token); border: var(--gone-token); }\n" },
    { path: "app/b.css", content: ".y { color: var(--missing-token); }\n" },
    { path: "app/c.css", content: ".z { color: var(--runtime-token); }\n" },
  ]);

  const result = evaluateCustomPropertyResolution({
    defined,
    usedInCss,
    runtimeAllowed: ["runtime-token", "gone-token", "unused-token"],
  });
  assert.deepEqual(result, {
    unresolved: [{ name: "missing-token", files: ["app/b.css"] }],
    // gone-token became declared in the repository, so its runtime exception is stale.
    staleAllowlist: ["gone-token"],
    // unused-token is no longer used by any CSS var(), so its exception is dead.
    unusedAllowlist: ["unused-token"],
  });
});

test("app CSS var() uses resolve or are narrowly runtime-allowlisted", async () => {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const files = await loadSourceFiles(`${repoRoot}/apps/web`, { extensions: [".css", ".ts", ".tsx"] });

  assert.ok(files.some((file) => file.path.endsWith(".css")), "CSS scan must find app stylesheets");
  const { defined, usedInCss } = collectCustomProperties(files);
  const result = evaluateCustomPropertyResolution({ defined, usedInCss, runtimeAllowed: RUNTIME_ALLOWED });
  assert.deepEqual(
    result,
    { unresolved: [], staleAllowlist: [], unusedAllowlist: [] },
    "app CSS must not reference unresolved custom properties; update the documented runtime allowlist only for framework-injected variables",
  );
});
