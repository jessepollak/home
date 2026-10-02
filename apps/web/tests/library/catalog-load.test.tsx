import "@/client/account/dom-test-harness";

import { afterEach, expect, test } from "bun:test";
import type { ReviewBuild } from "@/stories/review/explorations/board/review-build";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { LibraryView } = await import("@/stories/review/explorations/library/library");
const { FoundationsSurface } = await import("@/stories/review/explorations/library/foundations/foundations");
const { componentCandidateSet, loadCandidateSet } = await import("@/stories/review/explorations/library/foundations/sources");
const { foundationPages } = await import("@/stories/review/explorations/library/foundations/model");
const originalFetch = globalThis.fetch;
const originalUrl = location.href;
const build: ReviewBuild = { revision: "fixture", deployment: "", branch: "", repo: null, pr: null, changedFiles: null };

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  history.replaceState(history.state, "", originalUrl);
  document.documentElement.classList.remove("dark");
});

for (const data of [{ v: 5 }, { entries: [] }, { entries: null }]) {
  test(`the library renders unavailable for ${JSON.stringify(data)}`, async () => {
    globalThis.fetch = Object.assign(async () => new Response(JSON.stringify(data)), { preconnect: originalFetch.preconnect });
    const view = render(<LibraryView build={build} frameSource="blank" />);
    expect(view.getByRole("status").textContent).toBe("Loading library…");
    await act(async () => {});
    expect(view.getByRole("status").textContent).toBe("Couldn't load this build's story list. Reload to try again.");
  });
}

test("a fetched valid index renders the component library", async () => {
  const entry = { id: "ui-button--default", title: "UI/Button", name: "Default", type: "story",
    importPath: "./components/ui/button.stories.tsx" };
  globalThis.fetch = Object.assign(async () => new Response(JSON.stringify({ v: 5, entries: { [entry.id]: entry } })), { preconnect: originalFetch.preconnect });
  const view = render(<LibraryView build={build} frameSource="blank" />);
  await act(async () => {});
  expect(view.getByRole("listbox", { name: "Components" })).not.toBeNull();
  expect(view.getByRole("option", { name: "Button, 1 story" })).not.toBeNull();
  expect(view.getByRole("main", { name: "Library overview" })).not.toBeNull();
  expect(view.getByRole("option", { name: "Overview, 1 component" }).getAttribute("aria-selected")).toBe("true");
  expect(new URL(location.href).searchParams.has("component")).toBe(false);
  expect(view.queryByText("Loading library…")).toBeNull();
});

test("unmounting the library aborts its pending index request", async () => {
  const pending = Promise.withResolvers<Response>();
  let signal: AbortSignal | undefined;
  globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, options?: RequestInit) => {
    signal = options?.signal ?? undefined;
    return pending.promise;
  }, { preconnect: originalFetch.preconnect });
  const view = render(<LibraryView build={build} frameSource="blank" />);
  expect(view.getByRole("status").textContent).toBe("Loading library…");
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(new Response(JSON.stringify({ entries: {} }))); });
  expect(view.container.textContent).toBe("");
});

test("one theme picker persists across foundations, components and a reopened library", async () => {
  const entry = { id: "ui-button--default", title: "UI/Button", name: "Default", type: "story",
    importPath: "./components/ui/button.stories.tsx" };
  const storyIndex = { [entry.id]: entry };
  const url = new URL(location.href);
  url.searchParams.set("component", "foundations/type");
  history.replaceState(history.state, "", url);
  const view = render(<LibraryView build={build} storyIndex={storyIndex} frameSource="blank" />);
  expect(view.getAllByRole("button", { name: "Dark" })).toHaveLength(1);
  fireEvent.click(view.getByRole("button", { name: "Dark" }));
  expect(view.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
  expect(view.container.querySelector("[data-foundation-theme]")?.getAttribute("data-foundation-theme")).toBe("dark");
  expect(new URL(location.href).searchParams.get("theme")).toBe("dark");
  fireEvent.click(view.getByRole("option", { name: "Button, 1 story" }));
  expect(view.getByRole("main", { name: "Button preview" })).not.toBeNull();
  expect(view.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
  expect(new URL(location.href).searchParams.get("theme")).toBe("dark");
  fireEvent.click(view.getByRole("option", { name: /^Color, / }));
  expect(view.container.querySelector("[data-foundation-theme]")?.getAttribute("data-foundation-theme")).toBe("dark");
  view.unmount();
  const reopened = render(<LibraryView build={build} storyIndex={storyIndex} frameSource="blank" />);
  expect(reopened.getByRole("main", { name: "Color foundations" })).not.toBeNull();
  expect(reopened.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(reopened.getByRole("button", { name: "Light" }));
  expect(reopened.container.querySelector("[data-foundation-theme]")?.getAttribute("data-foundation-theme")).toBe("light");
  expect(new URL(location.href).searchParams.get("theme")).toBe("light");
  await act(async () => {});
});

test("an unavailable candidates payload maps to unavailable foundations rather than zero counts", async () => {
  const snapshot = await loadCandidateSet(async () => ({
    default: { status: "unavailable", reason: "Tailwind candidate scanner unavailable." },
  }));
  expect(snapshot).toEqual({ status: "unavailable", files: [] });
  expect(componentCandidateSet).toEqual(snapshot);
  const pages = foundationPages.filter(({ id }) => id !== "foundations/color");
  expect(pages).toHaveLength(3);
  for (const { id, kind } of pages) {
    expect(kind).toBe("Counts unavailable");
    const view = render(<FoundationsSurface page={id} theme="light" />);
    expect(view.getByRole("status").textContent).toBe("Component sources unavailable. Candidate counts cannot be read.");
    expect(view.queryByRole("table")).toBeNull();
    cleanup();
  }
});
