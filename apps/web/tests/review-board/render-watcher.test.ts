import { expect, test } from "bun:test";
import { watchStoryRender } from "../../stories/review/explorations/board/render-watcher";

for (const phase of ["finished", "errored", "aborted"]) {
  test(`stops polling when the story render is ${phase}`, () => {
    const original = globalThis.requestAnimationFrame;
    const callbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (callback) => callbacks.push(callback);
    try {
      const iframe = {
        isConnected: true,
        contentWindow: { __STORYBOOK_PREVIEW__: { currentRender: { id: "story", phase } } },
      } as unknown as HTMLIFrameElement;
      const statuses: string[] = [];
      watchStoryRender(iframe, "story", (status) => statuses.push(status));
      callbacks.shift()?.(0);
      expect(statuses).toEqual([phase === "finished" ? "rendered" : "errored"]);
      expect(callbacks).toHaveLength(0);
    } finally {
      globalThis.requestAnimationFrame = original;
    }
  });
}

test("reports access failures instead of leaving frames loading indefinitely", () => {
  const original = globalThis.requestAnimationFrame;
  const callbacks: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = (callback) => callbacks.push(callback);
  try {
    const iframe = {
      isConnected: true,
      get contentWindow() { throw new Error("Frame detached"); },
    } as unknown as HTMLIFrameElement;
    const statuses: string[] = [];
    watchStoryRender(iframe, "story", (status) => statuses.push(status));
    callbacks.shift()?.(0);
    expect(statuses).toEqual(["errored"]);
    expect(callbacks).toHaveLength(0);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});

test("cancels when frame access disconnects it", () => {
  const original = globalThis.requestAnimationFrame;
  const callbacks: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = (callback) => callbacks.push(callback);
  try {
    let connected = true;
    const iframe = {
      get isConnected() { return connected; },
      get contentWindow() { connected = false; throw new Error("Frame detached"); },
    } as unknown as HTMLIFrameElement;
    const statuses: string[] = [];
    watchStoryRender(iframe, "story", (status) => statuses.push(status));
    callbacks.shift()?.(0);
    expect(statuses).toEqual(["cancelled"]);
    expect(callbacks).toHaveLength(0);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});

test("stops polling when the iframe disconnects", () => {
  const original = globalThis.requestAnimationFrame;
  const callbacks: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = (callback) => callbacks.push(callback);
  try {
    const iframe = { isConnected: false } as HTMLIFrameElement;
    const statuses: string[] = [];
    watchStoryRender(iframe, "story", (status) => statuses.push(status));
    callbacks.shift()?.(0);
    expect(statuses).toEqual(["cancelled"]);
    expect(callbacks).toHaveLength(0);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});
