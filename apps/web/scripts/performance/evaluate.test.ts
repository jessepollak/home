import { expect, test } from "bun:test";
import { evaluateStructural, evaluateTiming, exitCode, limitFor, median, percentile, type StructuralInput } from "./evaluate";
import { gateIds } from "./config";

test("each structural gate accepts its limit and fails immediately over it", () => {
  for (const id of gateIds) {
    const limit = limitFor(id, id === "dom-nodes" ? 100 : id === "initial-js" ? 1000 : undefined, id === "resource-growth" ? "nodes" : undefined);
    const row = (value: number): StructuralInput => ({ id, value, limit, label: id, unit: "count", detail: {} });
    expect(evaluateStructural([row(Math.max(0, limit - 1)), row(limit), row(limit + 1)]).map(({ pass }) => pass)).toEqual([true, true, false]);
  }
  expect(limitFor("dom-nodes", 101)).toBe(112);
  expect(limitFor("dom-nodes", 340)).toBe(374);
  expect(limitFor("initial-js", 101)).toBe(106);
  expect(limitFor("initial-js", 200)).toBe(210);
});

test("timing calibrates ratios, flags both ceilings, and never affects the exit status", () => {
  const rows = evaluateTiming([
    { id: "nav-p95", scenario: "nav-300", value: 30, calibration: 20, unit: "ms", samples: 10 },
    { id: "nav-p95", scenario: "nav-300", value: 31, calibration: 20, unit: "ms", samples: 10 },
    { id: "nav-p95", scenario: "nav-300", value: 501, calibration: 500, unit: "ms", samples: 10 },
    { id: "detail-open", scenario: "feed-300", value: 1, calibration: 0, unit: "ms", samples: 9 },
    { id: "fling-loaf-blocking", scenario: "feed-300", value: 50, calibration: 0, unit: "ms", samples: 3 },
    { id: "fling-loaf-blocking", scenario: "feed-300", value: 51, calibration: 0, unit: "ms", samples: 3 },
    { id: "fling-over33", scenario: "feed-300", value: 4, calibration: 2, unit: "%", samples: 3 },
    { id: "fling-over33", scenario: "feed-300", value: 4.5, calibration: 2, unit: "%", samples: 3 },
    { id: "fling-dropped", scenario: "feed-300", value: 90, calibration: 1, unit: "%", samples: 3 },
  ]);
  expect(rows.map((row) => row.breach)).toEqual([false, true, true, true, false, true, false, true, false]);
  expect(rows[8]!.absoluteCeiling).toBeNull();
  expect(rows[0]!.ratio).toBe(1.5);
  expect(rows[3]!.ratio).toBeNull();
  expect(rows[4]!.relativeMode).toBe("delta");
  expect(exitCode([])).toBe(0);
  expect(exitCode([{ id: "dom-nodes", label: "Home", value: 1, limit: 0, unit: "nodes", detail: {}, pass: false }])).toBe(1);
});

test("median and nearest-rank percentile use all samples without mutating input", () => {
  const samples = [4, 1, 2, 3];
  expect(median(samples)).toBe(2.5);
  expect(percentile(samples, 0.95)).toBe(4);
  expect(samples).toEqual([4, 1, 2, 3]);
});
