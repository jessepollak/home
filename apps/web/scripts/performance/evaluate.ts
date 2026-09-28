import { relativeCeiling, relativeDeltas, resourceLimits, timingCeilings, type GateId, type TimingId } from "./config";

export type Baseline = { version: 1; domNodes: Record<string, number>; initialJs: Record<string, number> };
export type StructuralInput = { id: GateId; label: string; value: number; limit: number; unit: string; detail: Record<string, unknown> };
export type StructuralResult = StructuralInput & { pass: boolean };
export type TimingInput = { id: TimingId; scenario: string; unit: string; value: number; calibration: number; samples: number };
export type TimingResult = TimingInput & { ratio: number | null; absoluteCeiling: number | null; relativeCeiling: number | null; relativeMode: "ratio" | "delta"; breach: boolean };

export function limitFor(id: GateId, baseline?: number, metric?: keyof typeof resourceLimits): number {
  switch (id) {
    case "mounted-rows": return 25;
    case "history-writes": return 5;
    case "warm-requests": return 0;
    case "resource-growth": {
      if (!metric) throw new Error("Resource metric required");
      return resourceLimits[metric];
    }
    case "dom-nodes":
    case "initial-js": {
      if (baseline === undefined || baseline <= 0) throw new Error(`Missing ${id} baseline`);
      return id === "dom-nodes" ? Math.ceil(baseline * 110 / 100) : Math.floor(baseline * 105 / 100);
    }
  }
}

export function evaluateStructural(input: StructuralInput[]): StructuralResult[] {
  return input.map((row) => ({ ...row, pass: row.value <= row.limit }));
}

export function evaluateTiming(input: TimingInput[]): TimingResult[] {
  return input.map((row) => {
    const ratio = row.calibration === 0 ? (row.value === 0 ? 1 : null) : row.value / row.calibration;
    const absoluteCeiling = timingCeilings[row.id];
    if (absoluteCeiling === null) return { ...row, ratio, absoluteCeiling, relativeCeiling: null, relativeMode: "ratio", breach: false };
    const delta = relativeDeltas[row.id];
    const relativeBreach = delta === undefined ? ratio === null || ratio > relativeCeiling : row.value - row.calibration > delta;
    return { ...row, ratio, absoluteCeiling, relativeCeiling: delta ?? relativeCeiling, relativeMode: delta === undefined ? "ratio" : "delta",
      breach: row.value > absoluteCeiling || relativeBreach };
  });
}

export function exitCode(structural: StructuralResult[]): 0 | 1 {
  return structural.some((row) => !row.pass) ? 1 : 0;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2;
}

export function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1]! : 0;
}
