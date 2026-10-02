import { median } from "./evaluate";

export type ReactCommit = {
  atMs: number; renderMs: number; commitMs: number; passiveMs: number;
  panels: { id: string; renderMs: number; hidden: boolean }[]; profiling: boolean;
};
export type ReactCommitCollector = { commits: ReactCommit[]; injects: number };
export type ReactWindowSummary = {
  count: number; renderMs: number; commitMs: number; passiveMs: number; maxRenderMs: number;
  panels: Record<string, { renderMs: number; commitMs: number; commits: number }>;
  hiddenRenderMs: number; hiddenSharePct: number | null;
};
export type ReactSample = { path: string; react: ReactWindowSummary | null; reactReason: string | null };
export type ReactAttributionReport = {
  url: string | null; samples: ReactSample[]; paths: ReturnType<typeof aggregateReact>[];
  hooks: { path: string; injected: boolean; reason: string | null }[]; reason: string | null;
};

export function sliceCommits(commits: ReactCommit[], window: { startMs: number; endMs: number }) {
  return commits.filter((commit) => commit.atMs >= window.startMs && commit.atMs < window.endMs);
}

export function summarizeCommits(commits: ReactCommit[]): ReactWindowSummary {
  const summary: ReactWindowSummary = { count: commits.length, renderMs: 0, commitMs: 0, passiveMs: 0, maxRenderMs: 0,
    panels: Object.create(null), hiddenRenderMs: 0, hiddenSharePct: null };
  let panelRenderMs = 0;
  for (const commit of commits) {
    summary.renderMs += commit.renderMs; summary.commitMs += commit.commitMs; summary.passiveMs += commit.passiveMs;
    summary.maxRenderMs = Math.max(summary.maxRenderMs, commit.renderMs);
    const seen = new Set<string>();
    for (const panel of commit.panels) {
      const total = summary.panels[panel.id] ??= { renderMs: 0, commitMs: 0, commits: 0 };
      total.renderMs += panel.renderMs;
      if (!seen.has(panel.id)) { total.commits++; seen.add(panel.id); }
      panelRenderMs += panel.renderMs;
      if (panel.hidden) summary.hiddenRenderMs += panel.renderMs;
    }
    const owner = [...commit.panels].sort((a, b) => b.renderMs - a.renderMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    if (owner) summary.panels[owner.id]!.commitMs += commit.commitMs;
  }
  summary.hiddenSharePct = panelRenderMs > 0 ? 100 * summary.hiddenRenderMs / panelRenderMs : null;
  return summary;
}

export function reactAvailability(collector: ReactCommitCollector | null): { injected: boolean; reason: string | null } {
  if (!collector || collector.injects === 0) return { injected: false, reason: "React profiling hook did not inject" };
  if (!collector.commits.some((commit) => commit.profiling)) return { injected: true, reason: "React profiling timings are unavailable in this build" };
  return { injected: true, reason: null };
}

export function summarizeReactWindow(collector: ReactCommitCollector | null, window: { startMs: number; endMs: number }) {
  const availability = reactAvailability(collector);
  return { hookInjected: availability.injected,
    react: availability.reason === null ? summarizeCommits(sliceCommits(collector!.commits, window)) : null,
    reactReason: availability.reason };
}

export function aggregateReact(path: string, samples: ReactSample[]) {
  const selected = samples.filter((sample) => sample.path === path);
  const windows = selected.flatMap((sample) => sample.react ? [sample.react] : []);
  const p50 = (values: number[]) => values.length ? median(values) : null;
  const ids = [...new Set(windows.flatMap((window) => Object.keys(window.panels)))].sort();
  const panels = Object.fromEntries(ids.map((id) => [id, { renderMs: p50(windows.map((window) => window.panels[id]?.renderMs ?? 0)),
    commitMs: p50(windows.map((window) => window.panels[id]?.commitMs ?? 0)),
    commits: p50(windows.map((window) => window.panels[id]?.commits ?? 0)) }]));
  const destination = ids.filter((id) => id !== "home").sort((a, b) => (panels[b]!.renderMs ?? 0) - (panels[a]!.renderMs ?? 0) || a.localeCompare(b))[0];
  return { path, samples: windows.length, count: p50(windows.map((window) => window.count)),
    renderMs: p50(windows.map((window) => window.renderMs)), commitMs: p50(windows.map((window) => window.commitMs)),
    passiveMs: p50(windows.map((window) => window.passiveMs)), panels,
    hiddenSharePct: p50(windows.flatMap((window) => window.hiddenSharePct === null ? [] : [window.hiddenSharePct])),
    topPanel: destination ? { id: destination, renderMs: panels[destination]!.renderMs, commitMs: panels[destination]!.commitMs } : null,
    reason: windows.length ? null : selected.find((sample) => sample.reactReason)?.reactReason ?? "No React commit windows collected" };
}

export const reactCommitCollectorSource: string = `(() => {
  try {
    if (globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
    const perf = globalThis.performance;
    const now = perf.now.bind(perf);
    const collector = { commits: [], injects: 0 };
    const previousPanels = new WeakMap();
    const pending = new Map();
    const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
    // React hides a retained page by setting display:none on every host node in its
    // subtree, so a panel counts as hidden when it or an ancestor is hidden that way.
    const isHidden = (element) => {
      for (let node = element; node; node = node.parentElement) {
        if (node.hidden === true || node.style?.display === "none") return true;
      }
      return false;
    };
    globalThis.__homeReactCommits = collector;
    globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer) {
        try {
          const id = ++collector.injects;
          this.renderers.set(id, renderer);
          return id;
        } catch { return 0; }
      },
      onCommitFiberRoot(rendererId, root) {
        try {
          const current = root?.current;
          if (!current) return;
          const atMs = now(), panels = [], stack = [current], seen = new Set();
          while (stack.length && seen.size < 100000) {
            const fiber = stack.pop();
            if (!fiber || seen.has(fiber)) continue;
            seen.add(fiber);
            const element = fiber.stateNode;
            if (element?.nodeType === 1 && typeof element.getAttribute === "function") {
              const id = element.getAttribute("data-shell-panel-id");
              if (id !== null) {
                // The real fixture retains the same host fiber with stale positive actualDuration on a bailout.
                const reused = previousPanels.get(element) === fiber;
                previousPanels.set(element, fiber);
                const renderMs = number(fiber.actualDuration);
                if (!reused && renderMs > 0) panels.push({ id, renderMs, hidden: isHidden(element) });
              }
            }
            if (fiber.sibling) stack.push(fiber.sibling);
            if (fiber.child) stack.push(fiber.child);
          }
          const state = current.stateNode;
          const commit = { atMs, renderMs: number(current.actualDuration), commitMs: number(state?.effectDuration),
            passiveMs: 0, panels, profiling: typeof current.actualDuration === "number" };
          collector.commits.push(commit);
          pending.set(rendererId, { root, commit });
        } catch {}
      },
      onPostCommitFiberRoot(rendererId) {
        try {
          const entry = pending.get(rendererId);
          if (entry) entry.commit.passiveMs = number(entry.root.current?.stateNode?.passiveEffectDuration);
          pending.delete(rendererId);
        } catch {}
      },
      onCommitFiberUnmount() {}
    };
  } catch {}
})()`;
