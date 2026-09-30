import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Positioned } from "../board/layout";
import { LiveFrame } from "../board/live-frame";
import type { Metric } from "../board/use-frame-loading";
import { startRenderDeadline } from "../board/render-deadline";
import { watchStoryRender } from "../board/render-watcher";

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

export function FrameSection({ target, theme, args, annotating, frameSource, viewport, onSettled, onRendered,
  onActivate, onEscape, onExitAnnotate }: {
  target: FrameSectionTarget;
  theme: string;
  args: Record<string, unknown>;
  annotating: boolean;
  frameSource: "story" | "blank";
  viewport: { width: number; height: number };
  onSettled: () => void;
  onRendered?: (frame: HTMLIFrameElement) => void;
  onActivate?: () => void;
  onEscape?: () => void;
  onExitAnnotate: () => void;
}) {
  const item = useMemo(() => ({ id: target.story, story: target.story }), [target.story]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [metric, setMetric] = useState<Metric>({ id: item.id, story: item.story, status: "loading" });
  const ready = metric.status === "rendered";
  const applied = useRef<string | null>(null);
  const appliedTheme = useRef<string | null>(null);
  const preparing = useRef(false);
  const generation = useRef(0);
  const loads = useRef(0);
  const animation = useRef<number | null>(null);
  const stopRender = useRef<(() => void) | null>(null);
  const stopDeadline = useRef<(() => void) | null>(null);
  const stopInteractions = useRef<(() => void) | null>(null);
  const interaction = useRef({ annotating, onActivate, onEscape });
  const themeRef = useRef(theme);
  const argsRef = useRef(args);
  const settled = useRef(onSettled);
  const rendered = useRef(onRendered);
  useLayoutEffect(() => {
    themeRef.current = theme;
    argsRef.current = args;
    settled.current = onSettled;
    rendered.current = onRendered;
    interaction.current = { annotating, onActivate, onEscape };
  });
  useEffect(() => {
    if (metric.status === "rendered" && frame.current) rendered.current?.(frame.current);
    if (metric.status === "rendered" || metric.status === "errored") settled.current();
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
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
    stopRender.current?.();
    stopRender.current = null;
    stopDeadline.current?.();
    stopDeadline.current = null;
    stopInteractions.current?.();
    stopInteractions.current = null;
    preparing.current = false;
    applied.current = null;
    appliedTheme.current = null;
  }, []);
  const fail = useCallback((error?: string) => {
    cancel();
    setMetric((current) => ({ ...current, status: "errored", error }));
  }, [cancel]);
  const begin = useCallback(() => {
    cancel();
    setMetric({ id: item.id, story: item.story, status: "loading" });
    const load = generation.current;
    stopDeadline.current = startRenderDeadline((error) => {
      if (generation.current === load) fail(error);
    });
  }, [cancel, fail, item.id, item.story]);
  useLayoutEffect(() => {
    const load = generation.current;
    stopDeadline.current = startRenderDeadline((error) => {
      if (generation.current === load) fail(error);
    });
    return cancel;
  }, [cancel, fail]);
  const mark = useCallback((_: string, patch: Partial<Metric>) => {
    if (patch.status === "loaded" && loads.current++ > 0) begin();
    if (patch.status === "loaded") {
      stopInteractions.current?.();
      const doc = frame.current?.contentDocument;
      if (doc) {
        const load = generation.current;
        const activate = (event: PointerEvent) => {
          if (event.isTrusted && generation.current === load && !interaction.current.annotating) interaction.current.onActivate?.();
        };
        const escape = (event: KeyboardEvent) => {
          if (event.key !== "Escape") return;
          queueMicrotask(() => {
            if (generation.current === load && !interaction.current.annotating && !event.defaultPrevented) {
              interaction.current.onEscape?.();
            }
          });
        };
        doc.addEventListener("pointerdown", activate, true);
        doc.addEventListener("keydown", escape);
        stopInteractions.current = () => {
          doc.removeEventListener("pointerdown", activate, true);
          doc.removeEventListener("keydown", escape);
        };
      }
    }
    if (patch.status !== "rendered") setMetric((current) => ({ ...current, ...patch }));
  }, [begin]);
  const finish = useCallback((_: string, status: "rendered" | "errored", error?: string) => {
    if (status === "errored") { fail(error); return; }
    if (preparing.current) return;
    preparing.current = true;
    const load = generation.current;
    const poll = () => {
      if (generation.current !== load) return;
      const iframe = frame.current;
      if (!iframe?.isConnected) return;
      const api = previewApi(iframe);
      if (!api || api.currentRender?.story?.id !== item.story || api.currentRender?.phase !== "finished") {
        animation.current = requestAnimationFrame(poll);
        return;
      }
      try {
        if (!api.onUpdateGlobals || !api.onUpdateArgs) throw new Error("Preview props API unavailable");
        const reconcile = () => {
          if (generation.current !== load) return;
          const latestArgs = argsRef.current;
          const serialized = JSON.stringify(latestArgs);
          const latestTheme = themeRef.current;
          const complete = (next: "rendered" | "errored" | "cancelled", renderError?: string) => {
            if (generation.current !== load) return;
            if (next !== "rendered") { fail(renderError); return; }
            reconcile();
          };
          if (appliedTheme.current !== latestTheme) {
            stopRender.current = watchStoryRender(iframe, item.story, (next, renderError) => {
              if (generation.current !== load) return;
              if (next === "rendered") appliedTheme.current = latestTheme;
              complete(next, renderError);
            }, () => api.onUpdateGlobals!({ globals: { theme: latestTheme } }));
          } else if (applied.current !== serialized) {
            stopRender.current = watchStoryRender(iframe, item.story, (next, renderError) => {
              if (generation.current !== load) return;
              if (next === "rendered") applied.current = serialized;
              complete(next, renderError);
            }, () => api.onUpdateArgs!({ storyId: item.story, updatedArgs: latestArgs }));
          } else {
            stopDeadline.current?.();
            stopDeadline.current = null;
            setMetric((current) => ({ ...current, status: "rendered", renderedAt: performance.now() }));
          }
        };
        reconcile();
      } catch (cause) {
        if (generation.current === load) fail(cause instanceof Error ? cause.message : String(cause));
      }
    };
    animation.current = requestAnimationFrame(poll);
  }, [fail, item.story]);
  useEffect(() => {
    if (!ready || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    const load = generation.current;
    void Promise.resolve().then(() => {
      if (generation.current === load) return previewApi(frame.current)?.onUpdateGlobals?.({ globals: { theme } });
    }).catch((error: unknown) => {
      if (generation.current === load) fail(error instanceof Error ? error.message : String(error));
    });
  }, [ready, theme, fail]);
  useEffect(() => {
    if (!ready) return;
    const serialized = JSON.stringify(args);
    if (serialized === applied.current) return;
    applied.current = serialized;
    const load = generation.current;
    void Promise.resolve().then(() => {
      if (generation.current === load) return previewApi(frame.current)?.onUpdateArgs?.({ storyId: item.story, updatedArgs: args });
    }).catch((error: unknown) => {
      if (generation.current === load) fail(error instanceof Error ? error.message : String(error));
    });
  }, [ready, args, item.story, fail]);
  const noop = useCallback(() => {}, []);
  return <LiveFrame position={position} metric={metric} loaded active={!annotating} frameSource={frameSource}
    frameRef={frame} onMark={mark} onFinish={finish} onCancel={cancel}
    onSelect={noop} onFit={noop} onInteract={onExitAnnotate} />;
}
