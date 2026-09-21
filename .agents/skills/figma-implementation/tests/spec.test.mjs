import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  SpecError,
  compareAll,
  compareElement,
  frameComparison,
  frameMatched,
  normalizeColor,
  normalizeStyleValue,
  parseAuditSpec,
  storyCanvasUrl,
} from "../scripts/lib/spec.mjs";
import { resolveRepoRoot } from "../scripts/lib/repo.mjs";

const baseSpec = () => ({
  story: "pilot-financial-row--normal",
  viewport: "390x844",
  frame: { nodeId: "5:165", fileKey: "ixgttt6IurKynsvMJpLYDC", width: 326, height: 56 },
  frameSelector: "[data-balance-list] > li > [data-slot=item]",
  frameBox: "content",
  elements: [
    { name: "label", selector: "[data-slot=item-title]", rect: { left: 44 }, styles: { fontSize: "16px" } },
  ],
});

describe("normalizeColor", () => {
  test("normalizes hex to rgb()/rgba()", () => {
    assert.equal(normalizeColor("#fff"), "rgb(255, 255, 255)");
    assert.equal(normalizeColor("#171717"), "rgb(23, 23, 23)");
    assert.equal(normalizeColor("#0A0A0A80"), "rgba(10, 10, 10, 0.502)");
  });

  test("leaves rgb()/oklch() alone apart from case and spacing", () => {
    assert.equal(normalizeColor("  RGB(1,  2, 3) "), "rgb(1, 2, 3)");
    assert.equal(normalizeColor("oklch(0.145 0 0)"), "oklch(0.145 0 0)");
  });

  test("normalizeStyleValue collapses whitespace and lowercases", () => {
    assert.equal(normalizeStyleValue("  SF  Pro Text "), "sf pro text");
    assert.equal(normalizeStyleValue("#FFFFFF"), "rgb(255, 255, 255)");
    assert.equal(normalizeStyleValue(undefined), "");
  });
});

describe("storyCanvasUrl", () => {
  test("builds the documented Storybook canvas URL", () => {
    assert.equal(
      storyCanvasUrl({ base: "http://127.0.0.1:6006", story: "pilot-financial-row--normal" }),
      "http://127.0.0.1:6006/iframe.html?id=pilot-financial-row--normal&viewMode=story",
    );
  });

  test("tolerates a trailing slash and a custom base path", () => {
    assert.equal(
      storyCanvasUrl({ base: "http://localhost:6007/", story: "x--y" }),
      "http://localhost:6007/iframe.html?id=x--y&viewMode=story",
    );
  });

  test("requires a story id", () => {
    assert.throws(() => storyCanvasUrl({ story: "" }), SpecError);
  });
});

describe("parseAuditSpec", () => {
  test("accepts a complete spec", () => {
    const spec = parseAuditSpec(JSON.stringify(baseSpec()));
    assert.equal(spec.elements.length, 1);
    assert.equal(spec.frame.width, 326);
  });

  test("rejects invalid JSON, a missing story and an empty element list", () => {
    assert.throws(() => parseAuditSpec("{oops"), /not valid JSON/);
    assert.throws(() => parseAuditSpec({ elements: [{ name: "a", selector: "a" }] }), /needs "story"/);
    assert.throws(() => parseAuditSpec({ story: "x", elements: [] }), /non-empty "elements"/);
  });

  test("rejects unsupported element keys and rect fields", () => {
    assert.throws(
      () => parseAuditSpec({ story: "x", elements: [{ name: "a", selector: "a", width: 2 }] }),
      /unsupported key\(s\): width/,
    );
    assert.throws(
      () => parseAuditSpec({ story: "x", elements: [{ name: "a", selector: "a", rect: { gap: 4 } }] }),
      /unsupported or non-numeric key\(s\): gap/,
    );
  });

  test("accepts the box ladder keys in rect", () => {
    const spec = parseAuditSpec({
      story: "x",
      elements: [
        {
          name: "frame",
          selector: "a",
          rect: { contentWidth: 326, paddingHeight: 56, paddingWidth: 348, contentHeight: 32 },
        },
      ],
    });
    assert.deepEqual(spec.elements[0].rect, {
      contentWidth: 326,
      paddingHeight: 56,
      paddingWidth: 348,
      contentHeight: 32,
    });
  });

  test("rejects duplicate names, bad direction and bad frameBox", () => {
    assert.throws(
      () =>
        parseAuditSpec({
          story: "x",
          elements: [
            { name: "a", selector: "a" },
            { name: "a", selector: "b" },
          ],
        }),
      /reuses the name/,
    );
    assert.throws(
      () => parseAuditSpec({ story: "x", elements: [{ name: "a", selector: "a", direction: "diag" }] }),
      /direction must be/,
    );
    assert.throws(
      () => parseAuditSpec({ story: "x", frameBox: "margin", elements: [{ name: "a", selector: "a" }] }),
      /frameBox/,
    );
  });
});

describe("compareElement", () => {
  test("reports a missing selector", () => {
    const rows = compareElement({ name: "label", selector: ".missing" }, { missing: true });
    assert.deepEqual(rows, [{ prop: "selector", expected: ".missing", actual: "NOT FOUND" }]);
  });

  test("compares rect numbers inside a 1px default tolerance", () => {
    const element = { name: "mark", selector: ".m", rect: { width: 32, height: 32, top: 12 } };
    assert.deepEqual(compareElement(element, { rect: { width: 32, height: 31.4, top: 12.5 } }), []);
    const rows = compareElement(element, { rect: { width: 30, height: 32, top: 12 } });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { prop: "width", expected: 32, actual: 30 });
  });

  test("honours a custom tolerance", () => {
    const element = { name: "x", selector: ".x", rect: { width: 10 }, tolerance: 2.5 };
    assert.deepEqual(compareElement(element, { rect: { width: 12.4 } }), []);
    assert.equal(compareElement(element, { rect: { width: 13 } }).length, 1);
  });

  test("compares gaps, including a measured null", () => {
    const element = { name: "mark", selector: ".m", gapToNext: 12 };
    assert.deepEqual(compareElement(element, { gapToNext: 10 }).map((row) => row.prop), ["gapToNext"]);
    assert.equal(compareElement(element, { gapToNext: 12.4 }).length, 0);
    assert.deepEqual(compareElement(element, { gapToNext: null }), [
      { prop: "gapToNext", expected: 12, actual: "NOT MEASURED" },
    ]);
  });

  test("compares styles with color normalization and px tolerance", () => {
    const element = {
      name: "label",
      selector: ".l",
      styles: { color: "#171717", fontSize: "16px", fontWeight: "400" },
    };
    assert.deepEqual(
      compareElement(element, { styles: { color: "rgb(23, 23, 23)", fontSize: "16.4px", fontWeight: "400" } }),
      [],
    );
    const rows = compareElement(element, {
      styles: { color: "rgb(10, 10, 10)", fontSize: "14px", fontWeight: "500" },
    });
    assert.deepEqual(rows.map((row) => row.prop), ["color", "fontSize", "fontWeight"]);
    assert.equal(rows[0].actual, "rgb(10, 10, 10)");
  });

  test("a numeric style with a px expectation is compared numerically", () => {
    const element = { name: "x", selector: ".x", styles: { lineHeight: "20px" }, tolerance: 1 };
    assert.deepEqual(compareElement(element, { styles: { lineHeight: "19.25px" } }), []);
    assert.equal(compareElement(element, { styles: { lineHeight: "18px" } }).length, 1);
  });
});

describe("compareAll", () => {
  test("aggregates element failures and the frame delta", () => {
    const spec = parseAuditSpec(baseSpec());
    const result = compareAll(spec, {
      frame: { width: 324, height: 56 },
      elements: [{ rect: { left: 42 }, styles: { fontSize: "14px" } }],
    });
    assert.equal(result.pass, false);
    assert.equal(result.failures, 2);
    assert.deepEqual(result.report[0].failures.map((row) => row.prop), ["left", "fontSize"]);
    assert.deepEqual(result.frame.delta, { width: -2, height: 0 });
  });

  test("passes when everything matches", () => {
    const spec = parseAuditSpec(baseSpec());
    const result = compareAll(spec, {
      frame: { width: 326, height: 56 },
      elements: [{ rect: { left: 44 }, styles: { fontSize: "16px" } }],
    });
    assert.equal(result.pass, true);
    assert.deepEqual(result.frame.delta, { width: 0, height: 0 });
  });

  test("reports a measurement that never ran as a failure, not a crash", () => {
    const spec = parseAuditSpec(baseSpec());
    const result = compareAll(spec, { frame: null, elements: [] });
    assert.equal(result.pass, false);
    assert.equal(result.report[0].failures[0].actual, "NOT FOUND");
  });
});

describe("frame comparison", () => {
  test("tolerates no delta of its own", () => {
    const spec = parseAuditSpec(baseSpec());
    assert.equal(frameMatched(spec, { width: 326, height: 56 }), true);
    assert.equal(frameMatched(spec, { width: 324, height: 56 }), false);
    assert.equal(frameMatched(spec, null), null);
    assert.equal(frameComparison({}, null).expected, null);
  });

  test("frameSize maps each axis to a measured box of the frame element", () => {
    const spec = parseAuditSpec({
      ...baseSpec(),
      frameSize: { width: "contentWidth", height: "paddingHeight" },
    });
    const comparison = frameComparison(spec, {
      width: 350,
      height: 58,
      contentWidth: 324,
      contentHeight: 32,
      paddingWidth: 348,
      paddingHeight: 56,
    });
    assert.deepEqual(comparison.keys, { width: "contentWidth", height: "paddingHeight" });
    assert.deepEqual(comparison.actual, { width: 324, height: 56 });
    assert.deepEqual(comparison.delta, { width: -2, height: 0 });
  });

  test("frameSize rejects an unknown box key", () => {
    assert.throws(
      () => parseAuditSpec({ ...baseSpec(), frameSize: { width: "outerWidth" } }),
      /frameSize has unsupported entries/,
    );
    assert.throws(
      () => parseAuditSpec({ ...baseSpec(), frameSize: { depth: "width" } }),
      /frameSize has unsupported entries/,
    );
  });
});

describe("resolveRepoRoot", () => {
  test("finds the worktree root from the skill's own directory", () => {
    const root = resolveRepoRoot();
    assert.ok(existsSync(join(root, "package.json")));
    assert.ok(existsSync(join(root, "apps", "web", "package.json")));
    assert.equal(resolveRepoRoot(root), root);
  });

  test("walks up from a nested directory", () => {
    const root = resolveRepoRoot();
    assert.equal(resolveRepoRoot(join(root, "apps", "web", "client")), root);
  });

  test("throws with a useful message when no root exists above", () => {
    const dir = mkdtempSync(join(tmpdir(), "figma-skill-root-"));
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(join(dir, "nested", "package.json"), "{}");
    assert.throws(() => resolveRepoRoot(join(dir, "nested")), /Could not locate the Home repo root/);
  });
});
