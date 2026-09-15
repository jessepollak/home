import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collectCustomProperties, evaluateCustomPropertyResolution } from "../css-custom-properties.mjs";
import { loadSourceFiles } from "../source-files.mjs";

// Every var(--name) use in app CSS must resolve to a declaration in CSS, an
// inline TS/TSX provider, or a framework/runtime-injected exception below.
// The allowlist fails stale: once a property is declared in the repository, the
// exception must be removed.

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
    { path: "app/globals.css", content: ":root { --global-token: red; }\n.x { color: var(--global-token); }\n" },
    { path: "components/ui/local.module.css", content: ".y { color: var(--local-token); --local-token: blue; }\n" },
    { path: "client/fixture.tsx", content: "export const A = () => <div style={{ \"--inline-token\": \"1px\" }} />;\n" },
    { path: "client/probe.ts", content: "el.style.setProperty(\"--setproperty-token\", v);\n" },
    { path: "client/tailwind.tsx", content: "const cls = \"[--tailwind-token:0px]\";\n" },
  ]);

  assert.ok(defined.has("global-token"));
  assert.ok(defined.has("local-token"));
  assert.ok(defined.has("inline-token"));
  assert.ok(defined.has("setproperty-token"));
  assert.ok(defined.has("tailwind-token"));
  assert.deepEqual([...usedInCss.keys()].sort(), ["global-token", "local-token"]);
});

test("evaluation reports missing, allowed, and stale-allowlist cases", () => {
  const { defined, usedInCss } = collectCustomProperties([
    { path: "app/a.css", content: ":root { --defined-token: red; --gone-token: blue; }\n.x { color: var(--defined-token); }\n" },
    { path: "app/b.css", content: ".y { color: var(--missing-token); }\n" },
    { path: "app/c.css", content: ".z { color: var(--runtime-token); }\n" },
  ]);

  const result = evaluateCustomPropertyResolution({
    defined,
    usedInCss,
    runtimeAllowed: ["runtime-token", "gone-token"],
  });
  assert.deepEqual(result, {
    unresolved: [{ name: "missing-token", files: ["app/b.css"] }],
    // gone-token became declared in the repository, so its runtime exception is stale.
    staleAllowlist: ["gone-token"],
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
    { unresolved: [], staleAllowlist: [] },
    "app CSS must not reference unresolved custom properties; update the documented runtime allowlist only for framework-injected variables",
  );
});
