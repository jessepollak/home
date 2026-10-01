import { isPreviewUpdated, PREVIEW_UPDATED } from "../board/render-watcher";

type Render = { id?: string; story?: { id?: string }; phase?: string };
type FailurePayload = { storyId?: string; status?: string; message?: string; title?: string; description?: string };

export function watchFrameFailure(
  iframe: HTMLIFrameElement,
  story: string,
  failed: (error?: string) => void,
): () => void {
  const child = iframe.contentWindow;
  const channel = child?.__STORYBOOK_ADDONS_CHANNEL__;
  const render = () => (child as { __STORYBOOK_PREVIEW__?: { currentRender?: Render } } | null)
    ?.__STORYBOOK_PREVIEW__?.currentRender;
  let cancelled = false;
  let animation: number;
  const listeners: Array<[string, (payload: FailurePayload | string) => void]> = [];
  const cancel = () => {
    cancelled = true;
    cancelAnimationFrame(animation);
    for (const [event, listener] of listeners) channel?.off(event, listener);
  };
  const fail = (error?: string) => {
    if (cancelled) return;
    cancel();
    failed(error);
  };
  for (const event of ["storyErrored", "storyThrewException", "playFunctionThrewException", "storyFinished"]) {
    const listener = (payload: FailurePayload | string) => {
      if (cancelled) return;
      const current = render();
      const id = typeof payload === "string" ? payload : payload.storyId ?? current?.story?.id ?? current?.id;
      if (id !== story || (event === "storyFinished" && (typeof payload === "string" || payload.status !== "error"))) return;
      fail(typeof payload === "string" ? undefined : payload.message ?? payload.description ?? payload.title);
    };
    channel?.on(event, listener);
    listeners.push([event, listener]);
  }
  const check = () => {
    if (cancelled) return;
    if (!iframe.isConnected) { cancel(); return; }
    try {
      const current = render();
      if ((current?.story?.id ?? current?.id) === story && ["errored", "aborted"].includes(current?.phase ?? "")) {
        fail(); return;
      }
    } catch { fail(); return; }
    animation = requestAnimationFrame(check);
  };
  animation = requestAnimationFrame(check);
  return cancel;
}

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
