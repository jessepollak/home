import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Positioned } from "../board/layout";
import { LiveFrame } from "../board/live-frame";
import type { Metric } from "../board/use-frame-loading";
import { startRenderDeadline } from "../board/render-deadline";
import { storyCanvasUrl } from "../board/url-state";
import { isFrameLoaded, watchFrameFailure, watchFrameLoaded } from "./frame-loading";

export type FrameSectionTarget = { story: string; component: string; label: string; changed: boolean };

type PreviewApi = {
  currentRender?: { id?: string; phase?: string; story?: { id?: string } };
  onUpdateArgs?: (payload: { storyId: string; updatedArgs: Record<string, unknown> }) => unknown;
  onUpdateGlobals?: (payload: { globals: Record<string, unknown> }) => unknown;
};

function previewApi(frame: HTMLIFrameElement | null): PreviewApi | undefined {
  try {
    return (frame?.contentWindow as { __STORYBOOK_PREVIEW__?: PreviewApi } | null | undefined)?.__STORYBOOK_PREVIEW__;
  } catch {
    return undefined;
  }
}

function scheduleUpdate(iframe: HTMLIFrameElement, story: string, immediate: boolean,
  update: (api: PreviewApi) => unknown, failed: (error: unknown) => void): () => void {
  let cancelled = false;
  let animation: number | undefined;
  const reject = (error: unknown) => { if (!cancelled) failed(error); };
  const apply = () => {
    if (cancelled) return;
    const api = previewApi(iframe);
    if (!api) throw new Error("Preview props API unavailable");
    const render = api.currentRender;
    if ((render?.story?.id ?? render?.id) !== story ||
      (!immediate && !["finished", "completed", "played"].includes(render?.phase ?? ""))) {
      animation = requestAnimationFrame(() => { void Promise.resolve().then(apply).catch(reject); });
      return;
    }
    return update(api);
  };
  void Promise.resolve().then(apply).catch(reject);
  return () => { cancelled = true; if (animation !== undefined) cancelAnimationFrame(animation); };
}

export function FrameSection({ target, theme, args, initialArgs = {}, annotating, frameSource, viewport, scale = 1, onSettled, onRendered,
  onUserInput, onEscape, onExitAnnotate }: {
  target: FrameSectionTarget;
  theme: string;
  args: Record<string, unknown>;
  initialArgs?: Record<string, unknown>;
  annotating: boolean;
  frameSource: "story" | "blank";
  viewport: { width: number; height: number };
  scale?: number;
  onSettled: () => void;
  onRendered?: (frame: HTMLIFrameElement) => void;
  onUserInput?: () => void;
  onEscape?: () => void;
  onExitAnnotate: () => void;
}) {
  const item = useMemo(() => ({ id: target.story, story: target.story }), [target.story]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [metric, setMetric] = useState<Metric>({ id: item.id, story: item.story, status: "loading" });
  const ready = metric.status === "rendered";
  const [initial] = useState(() => ({ theme, args: JSON.stringify(initialArgs),
    src: `${storyCanvasUrl(item.story)}&globals=${encodeURIComponent(`theme:${theme}`)}` }));
  const applied = useRef(initial.args);
  const appliedTheme = useRef(initial.theme);
  const wanted = useRef({ args: JSON.stringify(args), theme });
  const edited = useRef({ args: false, theme: false });
  const generation = useRef(0);
  const playback = useRef({ started: false });
  const loads = useRef(0);
  const stopRender = useRef<(() => void) | null>(null);
  const stopFailure = useRef<(() => void) | null>(null);
  const released = useRef(false);
  const stopDeadline = useRef<(() => void) | null>(null);
  const stopInteractions = useRef<(() => void) | null>(null);
  const interaction = useRef({ annotating, onUserInput, onEscape });
  const settled = useRef(onSettled);
  const rendered = useRef(onRendered);
  useLayoutEffect(() => {
    settled.current = onSettled;
    rendered.current = onRendered;
    interaction.current = { annotating, onUserInput, onEscape };
    const serialized = JSON.stringify(args);
    if (wanted.current.args !== serialized) edited.current.args = true;
    if (wanted.current.theme !== theme) edited.current.theme = true;
    wanted.current = { args: serialized, theme };
  });
  useEffect(() => {
    if (metric.status === "rendered" && frame.current) rendered.current?.(frame.current);
    if ((metric.status === "rendered" || metric.status === "errored") && !released.current) {
      released.current = true;
      settled.current();
    }
  }, [metric.status]);
  const position = useMemo<Positioned>(() => ({
    id: item.id,
    story: item.story,
    section: target.component,
    before: false,
    frame: {
      id: item.id, story: item.story, label: target.label,
      viewport, change: target.changed ? "changed" : "unchanged",
    },
    rect: { x: 0, y: 0, ...viewport },
  }), [item, target.component, target.label, target.changed, viewport]);
  const cancel = useCallback(() => {
    generation.current += 1;
    playback.current = { started: false };
    stopRender.current?.();
    stopRender.current = null;
    stopFailure.current?.();
    stopFailure.current = null;
    stopDeadline.current?.();
    stopDeadline.current = null;
    stopInteractions.current?.();
    stopInteractions.current = null;
    applied.current = initial.args;
    appliedTheme.current = initial.theme;
    edited.current = { args: false, theme: false };
  }, [initial]);
  const fail = useCallback((error?: string) => {
    cancel();
    setMetric((current) => current.status === "errored" ? current : { ...current, status: "errored", error });
  }, [cancel]);
  const startDeadline = useCallback(() => {
    if (stopDeadline.current) return;
    const load = generation.current;
    stopDeadline.current = startRenderDeadline((error) => {
      if (generation.current === load) fail(error);
    });
  }, [fail]);
  const begin = useCallback(() => {
    cancel();
    released.current = false;
    setMetric({ id: item.id, story: item.story, status: "loading" });
    startDeadline();
  }, [cancel, startDeadline, item.id, item.story]);
  useLayoutEffect(() => {
    startDeadline();
    return cancel;
  }, [cancel, startDeadline]);
  const mark = useCallback((_: string, patch: Partial<Metric>) => {
    if (patch.status === "loaded" && loads.current++ > 0) begin();
    if (patch.status === "loaded") {
      stopInteractions.current?.();
      const doc = frame.current?.contentDocument;
      if (doc) {
        const load = generation.current;
        const user = (event: Event) => {
          if (event.isTrusted && generation.current === load && !interaction.current.annotating) interaction.current.onUserInput?.();
        };
        const escape = (event: KeyboardEvent) => {
          if (event.key !== "Escape") return;
          queueMicrotask(() => {
            if (generation.current === load && !interaction.current.annotating && !event.defaultPrevented) {
              interaction.current.onEscape?.();
            }
          });
        };
        doc.addEventListener("pointerdown", user, true);
        doc.addEventListener("keydown", user, true);
        doc.addEventListener("keydown", escape);
        stopInteractions.current = () => {
          doc.removeEventListener("pointerdown", user, true);
          doc.removeEventListener("keydown", user, true);
          doc.removeEventListener("keydown", escape);
        };
      }
    }
    if (patch.status === "loaded") {
      stopRender.current?.();
      const load = generation.current;
      stopFailure.current = watchFrameFailure(frame.current!, item.story, (error) => {
        if (generation.current === load) fail(error);
      }, playback.current);
      stopRender.current = watchFrameLoaded(frame.current!, item.story, (status, error) => {
        if (generation.current !== load) return;
        if (status !== "rendered") { fail(error); return; }
        stopDeadline.current?.();
        stopDeadline.current = null;
        setMetric((current) => ({ ...current, status: "rendered", renderedAt: performance.now() }));
      }, playback.current);
    }
    if (patch.status !== "rendered") setMetric((current) => ({ ...current, ...patch }));
  }, [begin, fail, item.story]);
  const finish = useCallback((_: string, status: "rendered" | "errored", error?: string) => {
    if (isFrameLoaded(previewApi(frame.current)?.currentRender, item.story)) playback.current.started = true;
    if (status === "errored" && (!playback.current.started || error)) fail(error);
  }, [fail, item.story]);
  useEffect(() => {
    if (!ready || appliedTheme.current === theme) return;
    const load = generation.current;
    return scheduleUpdate(frame.current!, item.story, edited.current.theme, (api) => {
      if (generation.current !== load) return;
      if (!api.onUpdateGlobals) throw new Error("Preview props API unavailable");
      appliedTheme.current = theme;
      return api.onUpdateGlobals({ globals: { theme } });
    }, (error) => {
      if (generation.current === load) fail(error instanceof Error ? error.message : String(error));
    });
  }, [ready, theme, item.story, fail]);
  useEffect(() => {
    if (!ready) return;
    const serialized = JSON.stringify(args);
    if (serialized === applied.current) return;
    const load = generation.current;
    return scheduleUpdate(frame.current!, item.story, edited.current.args, (api) => {
      if (generation.current !== load) return;
      if (!api.onUpdateArgs) throw new Error("Preview props API unavailable");
      applied.current = serialized;
      return api.onUpdateArgs({ storyId: item.story, updatedArgs: args });
    }, (error) => {
      if (generation.current === load) fail(error instanceof Error ? error.message : String(error));
    });
  }, [ready, args, item.story, fail]);
  const noop = useCallback(() => {}, []);
  return <LiveFrame position={position} metric={metric} loaded active={!annotating} frameSource={frameSource} scale={scale}
    src={initial.src} frameRef={frame} onMark={mark} onFinish={finish} onCancel={cancel}
    onSelect={noop} onFit={onExitAnnotate} onInteract={onExitAnnotate} />;
}
