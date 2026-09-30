export const PREVIEW_UPDATED = "This preview was updated";

export function isPreviewUpdated(doc: Document | null | undefined): boolean {
  return doc?.body?.textContent?.includes("Failed to fetch dynamically imported module") ?? false;
}

export function watchStoryRender(
  iframe: HTMLIFrameElement,
  story: string,
  done: (status: "rendered" | "errored" | "cancelled", error?: string) => void,
  start?: () => unknown,
): () => void {
  let cancelled = false;
  let started = !start;
  let failure: string | undefined;
  let failed = false;
  let animation: number;
  const listeners: Array<[string, (payload: { storyId?: string } | string) => void]> = [];
  let channel: Window["__STORYBOOK_ADDONS_CHANNEL__"];
  try { channel = iframe.contentWindow?.__STORYBOOK_ADDONS_CHANNEL__; } catch { channel = undefined; }
  const cancel = () => {
    cancelled = true;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(animation);
    for (const [event, listener] of listeners) channel?.off(event, listener);
  };
  const finish: typeof done = (status, error) => {
    if (cancelled) return;
    cancel();
    done(status, error);
  };
  if (start && channel) {
    for (const event of ["storyRenderPhaseChanged", "storyRendered", "storyErrored", "storyThrewException", "playFunctionThrewException", "storyFinished"]) {
      const listener = (payload: { storyId?: string; newPhase?: string; status?: string } | string) => {
        if ((typeof payload === "string" ? payload : payload.storyId) !== story) return;
        if (event === "storyRenderPhaseChanged" && typeof payload !== "string" && payload.newPhase !== "finished") started = true;
        if (event === "storyRendered") started = true;
        if (["storyErrored", "storyThrewException", "playFunctionThrewException"].includes(event) ||
          (event === "storyFinished" && typeof payload !== "string" && payload.status === "error")) failed = true;
      };
      channel.on(event, listener);
      listeners.push([event, listener]);
    }
  }
  const check = () => {
    if (cancelled) return;
    if (!iframe.isConnected) { finish("cancelled"); return; }
    try {
      const render = iframe.contentWindow?.__STORYBOOK_PREVIEW__?.currentRender;
      if (failed) { finish("errored", failure); return; }
      if (render?.id === story && render.phase !== "finished") started = true;
      if (render?.id === story && render.phase === "finished" && started) { finish("rendered"); return; }
      if (isPreviewUpdated(iframe.contentDocument)) { finish("errored", PREVIEW_UPDATED); return; }
      if (render?.id === story) {
        if (render.phase === "errored" || render.phase === "aborted") { finish("errored"); return; }
      }
    } catch { finish(iframe.isConnected ? "errored" : "cancelled"); return; }
    animation = requestAnimationFrame(check);
  };
  animation = requestAnimationFrame(check);
  if (start) {
    try {
      void Promise.resolve(start()).catch((error: unknown) => {
        if (cancelled) return;
        failed = true;
        failure = error instanceof Error ? error.message : String(error);
      });
    } catch (error) {
      finish("errored", error instanceof Error ? error.message : String(error));
    }
  }
  return cancel;
}
