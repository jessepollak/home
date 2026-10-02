export const gateIds = ["mounted-rows", "dom-nodes", "warm-requests", "initial-js", "resource-growth", "history-writes", "balances-painted"] as const;
export type GateId = typeof gateIds[number];

export const routes = ["/home", "/activity", "/cash", "/invest", "/borrow", "/investments"] as const;
export const balancesPaintRoutes = ["/home", "/cash"] as const;
export const balancesPaintKinds = ["cold", "persisted"] as const;
export type PaintKind = typeof balancesPaintKinds[number];
export const navigationPaths = ["/invest", "/cash", "/borrow", "/investments"] as const;
export const feedSizes = [20, 100, 300, 2000] as const;
export const repetitions = 3;
// Structural failures first, then timing breaches. Seeded runs take a reduced sample and record no traces.
export const maxTracedScenarios = 3;
export const navigationCycles = 10;
export const navigationAttributionRows = 300;
export const navigationTraceCategories = "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing,benchmark,cc,viz,gpu,renderer.scheduler";
export const modalCycles = 10;
export const flingDistance = 6000;
export const navigationSettleMs = 75;
export const cpuThrottle = 4;
export const resourceLimits = { nodes: 65, listeners: 12, heapBytes: 2_500_000 } as const;
export const relativeCeiling = 1.5;
// Compare each paint kind against its baseline ratio using this document's shell paint.
export const balancesPaintCeiling = 1.5;
// fling-dropped is recorded without ceilings until its headless variance is known.
export const timingCeilings: Record<"fling-p95" | "fling-over33" | "fling-dropped" | "fling-loaf-blocking" | "detail-open" | "nav-p50" | "nav-p95" | "modal-open", number | null> = {
  "fling-p95": 65, "fling-over33": 5, "fling-dropped": null, "fling-loaf-blocking": 650,
  "detail-open": 300, "nav-p50": 350, "nav-p95": 500, "modal-open": 350,
};
// Share and sum metrics are near zero on short feeds, so their relative ceiling is an
// additive margin over the 20-row calibration rather than a ratio.
export const relativeDeltas: Partial<Record<keyof typeof timingCeilings, number>> = {
  "fling-over33": 2, "fling-loaf-blocking": 50,
};
export type TimingId = keyof typeof timingCeilings;

// The shared shell offers no Home→Activity control, so Activity stays a cold-route-only scenario.
// Warm round trips use only real Home controls: Invest, Cash, Borrow, Investments.
// Pending actions and orders are excluded: their 15 s refetch intervals are navigation-independent.
// The priced fixture prevents the 15 s unpriced-valuation retry; no action/order is pending.
// Savings vaults can poll every 60 s even when hidden. Fresh contexts keep each navigation
// measurement below that interval, and page.clock holds query freshness fixed after warm-up.
// The fixed fixture asset SVG is embedded as a data URL so its max-age=0 responses do not
// revalidate on every navigation. All started requests, including /api, remain counted.
// No request allowlist hides navigation-triggered fetches; the fixture build sets
// NEXT_PUBLIC_HOME_INTERACTION_SAMPLE_RATE=0 so sampled navigation beacons cannot appear.
