import { expect, test } from "bun:test";
import { isPreviewUpdated, PREVIEW_UPDATED, watchStoryRender } from "../../stories/review/explorations/board/render-watcher";

const documentWithText = (text: string) => ({ body: { textContent: text } }) as Document;

test("identifies a replaced dynamic import only when its error appears in the frame", () => {
  expect(isPreviewUpdated(documentWithText("Failed to fetch dynamically imported module: /assets/react-18-old.js")))
    .toBe(true);
  expect(isPreviewUpdated(documentWithText("Failed to load a story"))).toBe(false);
  expect(isPreviewUpdated(null)).toBe(false);
});

test("reports an updated preview instead of a generic story error", () => {
  const original = globalThis.requestAnimationFrame;
  const callbacks: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = (callback) => callbacks.push(callback);
  try {
    const iframe = {
      isConnected: true,
      contentDocument: documentWithText("Failed to fetch dynamically imported module: /assets/react-18-old.js"),
      contentWindow: { __STORYBOOK_PREVIEW__: { currentRender: { id: "story", phase: "errored" } } },
    } as unknown as HTMLIFrameElement;
    const results: Array<{ status: string; error?: string }> = [];
    watchStoryRender(iframe, "story", (status, error) => results.push({ status, error }));
    callbacks.shift()?.(0);
    expect(results).toEqual([{ status: "errored", error: PREVIEW_UPDATED }]);
    expect(callbacks).toHaveLength(0);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});
