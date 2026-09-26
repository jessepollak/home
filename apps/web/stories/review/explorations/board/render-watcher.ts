export function watchStoryRender(
  iframe: HTMLIFrameElement,
  story: string,
  done: (status: "rendered" | "errored" | "cancelled") => void,
): void {
  const check = () => {
    if (!iframe.isConnected) { done("cancelled"); return; }
    try {
      const render = iframe.contentWindow?.__STORYBOOK_PREVIEW__?.currentRender;
      if (render?.id === story) {
        if (render.phase === "finished") { done("rendered"); return; }
        if (render.phase === "errored" || render.phase === "aborted") { done("errored"); return; }
      }
    } catch { done(iframe.isConnected ? "errored" : "cancelled"); return; }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}
