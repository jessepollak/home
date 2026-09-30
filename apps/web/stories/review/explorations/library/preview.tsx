import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Positioned } from "../board/layout";
import { LiveFrame } from "../board/live-frame";
import { viewports } from "../board/manifest";
import type { Metric } from "../board/use-frame-loading";
import type { LibraryItem } from "./catalog";
import type { ArgType } from "./controls";
import styles from "./library.module.css";

export type PreparedPreview = { argTypes: Record<string, ArgType>; initialArgs: Record<string, unknown> };

type PreviewApi = {
  currentRender?: { id?: string; story?: { id?: string; argTypes?: Record<string, ArgType>; initialArgs?: Record<string, unknown> } };
  onUpdateArgs?: (payload: { storyId: string; updatedArgs: Record<string, unknown> }) => unknown;
  onUpdateGlobals?: (payload: { globals: Record<string, unknown> }) => unknown;
};

const PREPARE_TIMEOUT_FRAMES = 600;

function previewApi(frame: HTMLIFrameElement | null): PreviewApi | undefined {
  try {
    return (frame?.contentWindow as { __STORYBOOK_PREVIEW__?: PreviewApi } | null | undefined)?.__STORYBOOK_PREVIEW__;
  } catch {
    return undefined;
  }
}

export function LibraryPreview({ item, theme, args, annotating, frameSource, scale, onPrepared, onExitAnnotate }: {
  item: LibraryItem;
  theme: string;
  args: Record<string, unknown> | null;
  annotating: boolean;
  frameSource: "story" | "blank";
  scale: number;
  onPrepared: (prepared: PreparedPreview) => Record<string, unknown>;
  onExitAnnotate: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [metric, setMetric] = useState<Metric>({ id: item.id, story: item.story, status: "loading" });
  const ready = metric.status === "rendered";
  const applied = useRef<string | null>(null);
  const appliedTheme = useRef<string | null>(null);
  const preparing = useRef(false);
  const themeRef = useRef(theme);
  const prepare = useRef(onPrepared);
  useLayoutEffect(() => {
    themeRef.current = theme;
    prepare.current = onPrepared;
  });
  const position = useMemo<Positioned>(() => ({
    id: item.id,
    story: item.story,
    section: item.name,
    before: false,
    frame: {
      id: item.id, story: item.story, label: item.storyName,
      viewport: viewports.mobile, change: item.changed ? "changed" : "unchanged",
    },
    rect: { x: 0, y: 0, ...viewports.mobile },
  }), [item]);
  const mark = useCallback((_: string, patch: Partial<Metric>) => {
    setMetric((current) => patch.status === "rendered" ? current : { ...current, ...patch });
  }, []);
  const cancel = useCallback(() => {
    preparing.current = false;
    setMetric((current) => ({ ...current, status: "loading" }));
  }, []);
  const finish = useCallback((_: string, status: "rendered" | "errored", error?: string) => {
    if (status === "errored") {
      setMetric((current) => ({ ...current, status, error }));
      return;
    }
    let frames = 0;
    if (preparing.current) return;
    preparing.current = true;
    const poll = () => {
      const iframe = frame.current;
      if (!iframe?.isConnected) return;
      const api = previewApi(iframe);
      const story = api?.currentRender?.story;
      if (!api || story?.id !== item.story) {
        frames += 1;
        if (frames > PREPARE_TIMEOUT_FRAMES) setMetric((current) => ({ ...current, status: "errored",
          error: `Couldn't read props for ${item.story}` }));
        else requestAnimationFrame(poll);
        return;
      }
      const initial = prepare.current({ argTypes: story.argTypes ?? {}, initialArgs: story.initialArgs ?? {} });
      applied.current = JSON.stringify(initial);
      appliedTheme.current = themeRef.current;
      void Promise.all([
        api.onUpdateGlobals?.({ globals: { theme: themeRef.current } }),
        api.onUpdateArgs?.({ storyId: item.story, updatedArgs: initial }),
      ]).catch(() => undefined).then(() => {
        if (iframe.isConnected) setMetric((current) => ({ ...current, status: "rendered", renderedAt: performance.now() }));
      });
    };
    requestAnimationFrame(poll);
  }, [item.story]);
  useEffect(() => {
    if (!ready || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    void previewApi(frame.current)?.onUpdateGlobals?.({ globals: { theme } });
  }, [ready, theme]);
  useEffect(() => {
    if (!ready || !args) return;
    const serialized = JSON.stringify(args);
    if (serialized === applied.current) return;
    applied.current = serialized;
    void previewApi(frame.current)?.onUpdateArgs?.({ storyId: item.story, updatedArgs: args });
  }, [ready, args, item.story]);
  const noop = useCallback(() => {}, []);
  return <div className={styles.device} data-review-frame={item.id} data-review-story={item.story}
    data-annotating={annotating || undefined}>
    <LiveFrame position={position} metric={metric} loaded active={!annotating} frameSource={frameSource}
      scale={scale} frameRef={frame} onMark={mark} onFinish={finish} onCancel={cancel}
      onSelect={noop} onFit={noop} onInteract={onExitAnnotate} />
  </div>;
}
