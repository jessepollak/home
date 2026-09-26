import { useEffect, useRef, type Ref } from "react";
import { frameLabel, type Positioned } from "./layout";
import { changeLabel } from "./manifest";
import type { Metric } from "./use-frame-loading";
import { isPreviewUpdated, PREVIEW_UPDATED, watchStoryRender } from "./render-watcher";
import { storyCanvasUrl } from "./url-state";
import styles from "./board.module.css";

type LiveFrameProps = {
  position: Positioned;
  metric?: Metric;
  loaded: boolean;
  active: boolean;
  frameSource: "story" | "blank";
  scale?: number;
  frameRef?: Ref<HTMLIFrameElement>;
  onActiveLoad?: () => void;
  onMark: (id: string, patch: Partial<Metric>) => void;
  onFinish: (id: string, status: "rendered" | "errored", error?: string) => void;
  onCancel: (id: string) => void;
  onSelect: () => void;
  onFocusSelect?: () => void;
  onFit?: () => void;
  onInteract: () => void;
};

export function LiveFrame({
  position, metric, loaded, active, frameSource, scale = 1, frameRef, onActiveLoad,
  onMark, onFinish, onCancel, onSelect, onFocusSelect = onSelect, onFit = onSelect, onInteract,
}: LiveFrameProps) {
  const { id, story, frame, rect, before } = position;
  const status = useRef(metric?.status);
  useEffect(() => { status.current = metric?.status; }, [metric?.status]);
  useEffect(() => {
    if (!loaded) return;
    return () => {
      if (status.current !== "rendered" && status.current !== "errored") onCancel(id);
    };
  }, [loaded, id, onCancel]);
  const handleLoad = (iframe: HTMLIFrameElement) => {
    if (active) onActiveLoad?.();
    onMark(id, { status: "loaded", loadedAt: performance.now() });
    if (frameSource === "blank") { onFinish(id, "rendered"); return; }
    try {
      const child = iframe.contentWindow;
      const preview = child?.__STORYBOOK_PREVIEW__?.currentRender;
      if (preview?.id === story && preview.phase === "finished") {
        onFinish(id, "rendered");
        return;
      }
      if (isPreviewUpdated(iframe.contentDocument)) { onFinish(id, "errored", PREVIEW_UPDATED); return; }
      watchStoryRender(iframe, story, (status, error) => {
        if (status === "cancelled") onCancel(id);
        else onFinish(id, status, error);
      });
      const channel = child?.__STORYBOOK_ADDONS_CHANNEL__;
      if (!channel) return;
      const listeners: Array<[string, (payload: { storyId?: string }) => void]> = [];
      for (const [name, status] of [
        ["storyRendered", "rendered"],
        ["storyErrored", "errored"],
        ["storyThrewException", "errored"],
        ["playFunctionThrewException", "errored"],
      ] as const) {
        const listener = (payload: { storyId?: string }) => {
          if (payload.storyId !== story) return;
          for (const [eventName, fn] of listeners) channel.off(eventName, fn);
          onFinish(id, status, status === "errored" && isPreviewUpdated(iframe.contentDocument)
            ? PREVIEW_UPDATED : undefined);
        };
        channel.on(name, listener);
        listeners.push([name, listener]);
      }
    } catch { if (iframe.isConnected) onFinish(id, "errored"); else onCancel(id); }
  };
  return <div className={styles.frameScreen}
    style={{ width: rect.width * scale, height: rect.height * scale }}>
    <div className={styles.frameInner}
      style={{ width: rect.width, height: rect.height, transform: `scale(${scale})` }}>
      {metric?.status === "errored" && <div className={styles.message} role="alert">
        {metric.error ?? `Story failed to render: ${story}`}
      </div>}
      {metric?.status !== "rendered" && metric?.status !== "errored" &&
        <div className={styles.skeleton} role="status">Loading {frame.label}…</div>}
      {loaded && metric?.status !== "errored" && <iframe
        ref={frameRef}
        title={`${position.section} · ${frame.label}${before ? " · Before" : ""}`}
        src={frameSource === "blank" ? "about:blank" : storyCanvasUrl(story)}
        width={rect.width}
        height={rect.height}
        inert={!active}
        onLoad={(event) => handleLoad(event.currentTarget)}
        onError={() => onFinish(id, "errored")}
      />}
      {!active && <div
        role="button"
        tabIndex={0}
        className={styles.frameOverlay}
        data-review-frame={id}
        data-review-story={story}
        aria-label={`${position.section} · ${frameLabel(position)} · ${
          changeLabel(frame.change)} · ${rect.width} × ${rect.height}`}
        onFocus={onFocusSelect}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); onInteract(); }
          if (event.key === " ") { event.preventDefault(); onFit(); }
        }}
      />}
    </div>
  </div>;
}
