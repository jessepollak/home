import { isPreviewUpdated, PREVIEW_UPDATED } from "../board/render-watcher";

type Render = { id?: string; story?: { id?: string }; phase?: string };

export function isFrameLoaded(render: Render | undefined, story: string): boolean {
  return (render?.story?.id ?? render?.id) === story &&
    ["playing", "played", "completing", "completed", "afterEach", "finished"].includes(render?.phase ?? "");
}

export function watchFrameLoaded(
  iframe: HTMLIFrameElement,
  story: string,
  done: (status: "rendered" | "errored" | "cancelled", error?: string) => void,
): () => void {
  let cancelled = false;
  let animation: number;
  const cancel = () => {
    cancelled = true;
    cancelAnimationFrame(animation);
  };
  const finish: typeof done = (status, error) => {
    if (cancelled) return;
    cancel();
    done(status, error);
  };
  const check = () => {
    if (cancelled) return;
    if (!iframe.isConnected) { finish("cancelled"); return; }
    try {
      const render = (iframe.contentWindow as { __STORYBOOK_PREVIEW__?: { currentRender?: Render } } | null)
        ?.__STORYBOOK_PREVIEW__?.currentRender;
      if (isPreviewUpdated(iframe.contentDocument)) { finish("errored", PREVIEW_UPDATED); return; }
      if ((render?.story?.id ?? render?.id) === story && (render?.phase === "errored" || render?.phase === "aborted")) {
        finish("errored"); return;
      }
      if (isFrameLoaded(render, story)) { finish("rendered"); return; }
    } catch { finish(iframe.isConnected ? "errored" : "cancelled"); return; }
    animation = requestAnimationFrame(check);
  };
  animation = requestAnimationFrame(check);
  return cancel;
}
