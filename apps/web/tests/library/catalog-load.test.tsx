import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import type { ReviewBuild } from "@/stories/review/explorations/board/review-build";

const { act, cleanup, render } = await import("@testing-library/react");
const { LibraryView } = await import("@/stories/review/explorations/library/library");
const originalFetch = globalThis.fetch;
const build: ReviewBuild = { revision: "fixture", deployment: "", branch: "", repo: null, pr: null, changedFiles: null };

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

for (const data of [{ v: 5 }, { entries: [] }, { entries: null }]) {
  test(`the library renders unavailable for ${JSON.stringify(data)}`, async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(data))) as unknown as typeof fetch;
    const view = render(<LibraryView build={build} frameSource="blank" />);
    expect(view.getByRole("status").textContent).toBe("Loading library…");
    await act(async () => {});
    expect(view.getByRole("status").textContent).toBe("Couldn't load this build's story list. Reload to try again.");
  });
}

test("a fetched valid index renders the component library", async () => {
  const entry = { id: "ui-button--default", title: "UI/Button", name: "Default", type: "story",
    importPath: "./components/ui/button.stories.tsx" };
  globalThis.fetch = (async () => new Response(JSON.stringify({ v: 5, entries: { [entry.id]: entry } }))) as unknown as typeof fetch;
  const view = render(<LibraryView build={build} frameSource="blank" />);
  await act(async () => {});
  expect(view.getByRole("listbox", { name: "Components" })).not.toBeNull();
  expect(view.getByRole("option", { name: "Button, 1 story" })).not.toBeNull();
  expect(view.getByRole("main", { name: "Button preview" })).not.toBeNull();
  expect(view.queryByText("Loading library…")).toBeNull();
});

test("unmounting the library aborts its pending index request", async () => {
  let resolve!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_input, options) => {
    signal = options?.signal ?? undefined;
    return new Promise<Response>((done) => { resolve = done; });
  }) as typeof fetch;
  const view = render(<LibraryView build={build} frameSource="blank" />);
  expect(view.getByRole("status").textContent).toBe("Loading library…");
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { resolve(new Response(JSON.stringify({ entries: {} }))); });
  expect(view.container.textContent).toBe("");
});
