import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Positioned } from "../board/layout";
import { LiveFrame } from "../board/live-frame";
import type { Metric } from "../board/use-frame-loading";
import { startRenderDeadline } from "../board/render-deadline";
import { watchFrameLoaded } from "./frame-loading";

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

export function FrameSection({ target, theme, args, annotating, frameSource, viewport, scale = 1, onSettled, onRendered,
  onUserInput, onEscape, onExitAnnotate }: {
  target: FrameSectionTarget;
  theme: string;
  args: Record<string, unknown>;
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
  const applied = useRef<string | null>(null);
  const appliedTheme = useRef<string | null>(null);
  const generation = useRef(0);
  const loads = useRef(0);
  const stopRender = useRef<(() => void) | null>(null);
  const stopDeadline = useRef<(() => void) | null>(null);
  const stopInteractions = useRef<(() => void) | null>(null);
  const interaction = useRef({ annotating, onUserInput, onEscape });
  const settled = useRef(onSettled);
  const rendered = useRef(onRendered);
  useLayoutEffect(() => {
    settled.current = onSettled;
    rendered.current = onRendered;
    interaction.current = { annotating, onUserInput, onEscape };
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
    stopRender.current?.();
    stopRender.current = null;
    stopDeadline.current?.();
    stopDeadline.current = null;
    stopInteractions.current?.();
    stopInteractions.current = null;
    applied.current = null;
    appliedTheme.current = null;
  }, []);
  const fail = useCallback((error?: string) => {
    cancel();
    setMetric((current) => ({ ...current, status: "errored", error }));
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
      stopRender.current = watchFrameLoaded(frame.current!, item.story, (status, error) => {
        if (generation.current !== load) return;
        if (status !== "rendered") { fail(error); return; }
        stopDeadline.current?.();
        stopDeadline.current = null;
        setMetric((current) => ({ ...current, status: "rendered", renderedAt: performance.now() }));
      });
    }
    if (patch.status !== "rendered") setMetric((current) => ({ ...current, ...patch }));
  }, [begin, fail, item.story]);
  const finish = useCallback((_: string, status: "rendered" | "errored", error?: string) => {
    if (status === "errored") fail(error);
  }, [fail]);
  useEffect(() => {
    if (!ready || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    const load = generation.current;
    void Promise.resolve().then(() => {
      if (generation.current !== load) return;
      const api = previewApi(frame.current);
      if (!api?.onUpdateGlobals) throw new Error("Preview props API unavailable");
      return api.onUpdateGlobals({ globals: { theme } });
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
      if (generation.current !== load) return;
      const api = previewApi(frame.current);
      if (!api?.onUpdateArgs) throw new Error("Preview props API unavailable");
      return api.onUpdateArgs({ storyId: item.story, updatedArgs: args });
    }).catch((error: unknown) => {
      if (generation.current === load) fail(error instanceof Error ? error.message : String(error));
    });
  }, [ready, args, item.story, fail]);
  const noop = useCallback(() => {}, []);
  return <LiveFrame position={position} metric={metric} loaded active={!annotating} frameSource={frameSource} scale={scale}
    frameRef={frame} onMark={mark} onFinish={finish} onCancel={cancel}
    onSelect={noop} onFit={onExitAnnotate} onInteract={onExitAnnotate} />;
}
