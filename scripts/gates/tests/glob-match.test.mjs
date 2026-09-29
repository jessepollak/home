import assert from "node:assert/strict";
import test from "node:test";
import { knipGlob } from "../knip-source.mjs";

// Pinned Picomatch outcomes for the dialect Knip matches with (`{ dot: true }`).
// They differ from Node's path.matchesGlob on dotfiles and on `[!...]` classes,
// which is exactly the divergence that must not let an exemption match nothing.
const cases = [
  ["components/ui/a.tsx", "components/ui/a.tsx", true],
  ["components/ui/A.tsx", "components/ui/a.tsx", false],
  ["components/ui/a.tsx.extra", "components/ui/a.tsx", false],
  ["components/ui/a.tsx", "ui/a.tsx", false],
  ["client/a.ts", "client/*.ts", true],
  ["client/.ts", "client/*.ts", true],
  ["components/ui/.candidate.tsx", "components/ui/*.tsx", true],
  ["", "*", false],
  ["client/", "client/*", false],
  ["client/a/b.ts", "client/*.ts", false],
  ["client/a.ts", "client/?.ts", true],
  ["client/ab.ts", "client/?.ts", false],
  ["client/a/b.ts", "client/?.ts", false],
  ["client/a.ts", "client/[ab].ts", true],
  ["client/c.ts", "client/[ab].ts", false],
  ["components/ui/dialog.tsx", "components/ui/[!d]ialog.tsx", true],
  ["components/ui/bialog.tsx", "components/ui/[!d]ialog.tsx", false],
  ["components/ui/bialog.tsx", "components/ui/[^d]ialog.tsx", true],
  ["components/ui/dialog.tsx", "components/ui/[^d]ialog.tsx", false],
  [".x", "[.]x", true],
  ["client/a.ts", "client/{a,b}.ts", true],
  ["client/b.ts", "client/{a,b}.ts", true],
  ["client/c.ts", "client/{a,b}.ts", false],
  ["client/c.ts", "client/{a,{b,c}}.ts", true],
  ["components/ui/dialog.tsx", "components/ui/@(dialog|kbd).tsx", true],
  ["components/ui/kbd.tsx", "components/ui/@(dialog|kbd).tsx", true],
  ["components/ui/progress.tsx", "components/ui/@(dialog|kbd).tsx", false],
  ["components/ui/dialog.tsx", "components/ui/[[:alpha:]]ialog.tsx", true],
  ["components/ui/dialog2.tsx", "components/ui/dialog{1..3}.tsx", true],
  ["components/ui/dialog4.tsx", "components/ui/dialog{1..3}.tsx", false],
  ["components/ui/dialog?.tsx", "components/ui/dialog\\?.tsx", true],
  ["x.ts", "**/x.ts", true],
  ["a/b/x.ts", "**/x.ts", true],
  ["a/x.ts", "a/**/x.ts", true],
  ["a/b/x.ts", "a/**/x.ts", true],
  ["a/b.ts", "**", true],
  ["a/", "**", true],
  ["client/home/x.ts", "client/home/**", true],
  ["client/home/a/b.ts", "client/home/**", true],
  ["client/home", "client/home/**", true],
  [".storybook/main.ts", "*/*.ts", true],
  ["a/.hidden.ts", "a/*", true],
  ["a/b/x.ts", "**/**/**/**/**/**/x.ts", true],
  ["a/b/y.ts", "**/**/**/**/**/**/x.ts", false],
  ["a/b/x.ts", "a/**/**/x.ts", true],
  ["a/b/x.ts", "a/**/**", true],
  ["scripts/a.mjs", "./scripts/*", true],
  ["./scripts/a.mjs", "./scripts/*", false],
];

test("knipGlob retains Knip's Picomatch outcomes", () => {
  assert.ok(cases.length > 0, "pinned glob outcomes must not be empty");
  for (const [file, pattern, expected] of cases) {
    assert.equal(knipGlob(file, pattern), expected, `${JSON.stringify(file)} against ${JSON.stringify(pattern)}`);
  }
});

test("adjacent globstars handle a deep non-match without pathological backtracking", { timeout: 2000 }, () => {
  const deepPath = `${"segment/".repeat(40)}y`;
  assert.equal(knipGlob(deepPath, "**/**/**/**/**/**/x"), false);
  assert.equal(knipGlob(`${"segment/".repeat(40)}x`, "**/**/**/**/**/**/x"), true);
});
