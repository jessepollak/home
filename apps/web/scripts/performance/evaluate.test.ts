import { expect, test } from "bun:test";
import { balancesPaintLimit, evaluateStructural, evaluateTiming, exitCode, limitFor, median, medianPaintSample, observedPaintSample, percentile, type StructuralInput } from "./evaluate";
import { balancesPaintKinds, gateIds } from "./config";

test("each structural gate accepts its limit and fails immediately over it", () => {
  for (const id of gateIds) {
    const limit = limitFor(id, id === "dom-nodes" ? 100 : id === "initial-js" ? 1000 : undefined, id === "resource-growth" ? "nodes" : undefined,
      id === "balances-painted" ? { baseline: { paintedMs: 2500, shellMs: 2000 }, shellMs: 2000 } : undefined);
    const row = (value: number): StructuralInput => ({ id, value, limit, label: id, unit: "count", detail: {} });
    expect(evaluateStructural([row(Math.max(0, limit - 1)), row(limit), row(limit + 1)]).map(({ pass }) => pass)).toEqual([true, true, false]);
  }
  expect(limitFor("dom-nodes", 101)).toBe(112);
  expect(limitFor("dom-nodes", 340)).toBe(374);
  expect(limitFor("initial-js", 101)).toBe(106);
  expect(limitFor("initial-js", 200)).toBe(210);
});

test("balances paint limit scales the baseline mark-to-shell relationship by this run's shell paint", () => {
  const baseline = { paintedMs: 2500, shellMs: 2000 };
  expect(balancesPaintLimit(baseline, 2000)).toBe(3750);
  expect(balancesPaintLimit(baseline, 4000)).toBe(7500);
  expect(balancesPaintLimit(baseline, 1000)).toBe(1875);
  expect(balancesPaintLimit({ paintedMs: 2379, shellMs: 1942 }, 1942)).toBe(3569);
});

test("balances paint accepts its limit and rejects larger marks including a 2x regression", () => {
  const baseline = { paintedMs: 2500, shellMs: 2000 };
  for (const shellMs of [1000, 2000, 4000]) {
    const limit = balancesPaintLimit(baseline, shellMs);
    const row = (value: number): StructuralInput => ({ id: "balances-painted", label: "/home", value, limit, unit: "ms", detail: {} });
    const expected = shellMs * baseline.paintedMs / baseline.shellMs;
    const results = evaluateStructural([row(limit), row(limit + 1), row(Math.floor(expected * 1.4)), row(2 * expected)]);
    expect(results.map(({ pass }) => pass)).toEqual([true, false, true, false]);
    expect(exitCode(results)).toBe(1);
  }
});

test("balances paint requires a positive finite baseline and shell paint", () => {
  const baseline = { paintedMs: 2500, shellMs: 2000 };
  expect(() => balancesPaintLimit(undefined, 2000)).toThrow("balances-painted baseline");
  expect(() => limitFor("balances-painted")).toThrow("balances-painted baseline");
  expect(() => balancesPaintLimit(baseline, undefined)).toThrow("balances-painted shell paint");
  for (const invalid of [0, -1, NaN, Infinity]) {
    expect(() => balancesPaintLimit({ ...baseline, paintedMs: invalid }, 2000)).toThrow("balances-painted baseline");
    expect(() => balancesPaintLimit({ ...baseline, shellMs: invalid }, 2000)).toThrow("balances-painted baseline");
    expect(() => balancesPaintLimit(baseline, invalid)).toThrow("balances-painted shell paint");
  }
});

test("observed paint marks reject missing, non-finite and non-positive values for both kinds", () => {
  for (const kind of balancesPaintKinds) {
    const valid = { paintedMs: 250, shellMs: 200 };
    expect(observedPaintSample(valid, "/home", kind)).toEqual(valid);
    for (const invalid of [undefined, 0, -1, NaN, Infinity, -Infinity]) {
      expect(() => observedPaintSample({ ...valid, paintedMs: invalid }, "/home", kind)).toThrow(`/home ${kind} recorded invalid balances:painted`);
      expect(() => observedPaintSample({ ...valid, shellMs: invalid }, "/cash", kind)).toThrow(`/cash ${kind} recorded invalid shell:paint`);
    }
  }
});

test("same-run shell-based 2x seed fails both kinds even when natural paint precedes shell", () => {
  const baseline = { cold: { paintedMs: 1158, shellMs: 866 }, persisted: { paintedMs: 580, shellMs: 565 } };
  const seedRatio = Math.max(...balancesPaintKinds.map((kind) => baseline[kind].paintedMs / baseline[kind].shellMs));
  for (const kind of balancesPaintKinds) {
    for (const shellMs of [100, 1000, 10_000]) {
      const seeded = { paintedMs: 2 * seedRatio * shellMs, shellMs };
      const results = evaluateStructural([{ id: "balances-painted", label: `/cash ${kind}`, value: seeded.paintedMs,
        limit: balancesPaintLimit(baseline[kind], shellMs), unit: "ms", detail: {} }]);
      expect(results[0]?.pass).toBe(false);
      expect(exitCode(results)).toBe(1);
    }
  }
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

test("median paint sample selects the middle ratio without mutating input", () => {
  const samples = [{ paintedMs: 140, shellMs: 100 }, { paintedMs: 1200, shellMs: 1000 }, { paintedMs: 26, shellMs: 20 }];
  const original = [...samples];
  const [, , third] = samples;
  expect(medianPaintSample(samples)).toBe(third);
  expect(samples).toEqual(original);
});

test("median paint sample selects the lower middle ratio for even counts", () => {
  const samples = [{ paintedMs: 280, shellMs: 200 }, { paintedMs: 1200, shellMs: 1000 }, { paintedMs: 13, shellMs: 10 }, { paintedMs: 110, shellMs: 100 }];
  const [, second] = samples;
  expect(medianPaintSample(samples)).toBe(second);
});

test("median paint sample returns an input pair rather than averaging marks", () => {
  const samples = [{ paintedMs: 140, shellMs: 100 }, { paintedMs: 1200, shellMs: 1000 }];
  const [, second] = samples;
  expect(medianPaintSample(samples)).toBe(second);
});

test("median paint sample rejects empty input", () => {
  expect(() => medianPaintSample([])).toThrow("No paint samples");
});

test("median and nearest-rank percentile use all samples without mutating input", () => {
  const samples = [4, 1, 2, 3];
  expect(median(samples)).toBe(2.5);
  expect(percentile(samples, 0.95)).toBe(4);
  expect(samples).toEqual([4, 1, 2, 3]);
});
