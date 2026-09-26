export const PREVIEW_UPDATED = "This preview was updated";

export function isPreviewUpdated(doc: Document | null | undefined): boolean {
  return doc?.body?.textContent?.includes("Failed to fetch dynamically imported module") ?? false;
}

export function watchStoryRender(
  iframe: HTMLIFrameElement,
  story: string,
  done: (status: "rendered" | "errored" | "cancelled", error?: string) => void,
): void {
  const check = () => {
    if (!iframe.isConnected) { done("cancelled"); return; }
    try {
      const render = iframe.contentWindow?.__STORYBOOK_PREVIEW__?.currentRender;
      if (render?.id === story && render.phase === "finished") { done("rendered"); return; }
      if (isPreviewUpdated(iframe.contentDocument)) { done("errored", PREVIEW_UPDATED); return; }
      if (render?.id === story) {
        if (render.phase === "errored" || render.phase === "aborted") { done("errored"); return; }
      }
    } catch { done(iframe.isConnected ? "errored" : "cancelled"); return; }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}
