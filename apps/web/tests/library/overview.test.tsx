import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { ReviewBuild, StoryIndexEntry } from "@/stories/review/explorations/board/review-build";
import { libraryCatalog } from "@/stories/review/explorations/library/catalog";

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { LibraryView } = await import("@/stories/review/explorations/library/library");
const { specimens } = await import("@/stories/review/explorations/library/overview/specimens");
const originalUrl = location.href;
const build: ReviewBuild = { revision: "fixture", deployment: "", branch: "", repo: null, pr: null, changedFiles: null };
const storyFiles = [...new Bun.Glob("components/ui/*.stories.tsx").scanSync({ cwd: `${import.meta.dir}/../..` })].sort();
const storyMetas = await Promise.all(storyFiles.map(async (file) => {
  const meta: { id?: string; title: string } = (await import(`@/${file}`)).default;
  return { file, id: meta.id ?? meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: meta.title };
}));

function sourceIndex(): Record<string, StoryIndexEntry> {
  return Object.fromEntries(storyMetas.map(({ file, id, title }) =>
    [`${id}--default`, { id: `${id}--default`, title, name: "Default", type: "story", importPath: `./${file}` }]));
}

afterEach(() => {
  cleanup();
  history.replaceState(history.state, "", originalUrl);
  document.documentElement.classList.remove("dark");
});

describe("library overview specimens", () => {
  test("cover every catalog component and nothing else", () => {
    const catalog = libraryCatalog(sourceIndex(), build).items.map((item) => item.id);
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.filter((id) => !(id in specimens))).toEqual([]);
    expect(Object.keys(specimens).filter((id) => !catalog.includes(id))).toEqual([]);
  });

  test("render live specimens without opening overlays and open a sheet from a card name", async () => {
    const before = document.body.children.length;
    const view = render(<LibraryView build={build} storyIndex={sourceIndex()} frameSource="blank" />);
    await act(async () => {});
    const surface = () => view.container.querySelector("main")?.getAttribute("aria-label");
    expect(surface()).toBe("Library overview");
    expect(document.body.children.length).toBe(before + 1);
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.queryByRole("alertdialog")).toBeNull();
    expect(view.queryByRole("tooltip")).toBeNull();
    expect(view.queryByRole("region", { name: "Notifications" })).toBeNull();
    const navigation = view.getByRole("navigation", { name: "Library" });
    expect(within(navigation).getAllByRole("option")[0].getAttribute("aria-label")).toMatch(/^Overview, /);
    const card = (id: string) => within(view.container.querySelector<HTMLElement>(`[data-library-specimen="${id}"]`)!);
    const cards = [...view.container.querySelectorAll("[data-library-specimen]")];
    expect(cards.map((node) => node.getAttribute("data-library-specimen")).sort()).toEqual(Object.keys(specimens).sort());
    expect(cards.filter((node) => /Couldn't render|No specimen yet/.test(node.textContent ?? ""))).toEqual([]);

    for (const [id, name] of [["ui-dialog", "Keyboard shortcuts"], ["ui-drawer", "Review deposit"],
      ["ui-popover", "Balance details"], ["ui-toast", "Show toast"]]) {
      expect(card(id).getByRole("button", { name })).not.toBeNull();
    }
    expect(card("ui-combobox").getByRole("combobox", { name: "Currency" }).getAttribute("aria-expanded")).toBe("false");
    expect(card("ui-select").getByRole("combobox", { name: "Asset" }).getAttribute("aria-expanded")).toBe("false");
    const toggle = card("ui-switch").getByRole("switch", { name: "Show small balances" });
    const checked = toggle.getAttribute("aria-checked");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).not.toBe(checked);
    fireEvent.click(card("ui-input-group").getByRole("button", { name: "Max" }));
    expect(card("ui-input-group").getByRole<HTMLInputElement>("textbox", { name: "Amount" }).value).toBe("1111.11");
    fireEvent.click(card("ui-button-group").getByRole("button", { name: "Next" }));
    expect(card("ui-button-group").getByText("4 of 12")).not.toBeNull();
    expect(surface()).toBe("Library overview");

    fireEvent.click(card("ui-switch").getByRole("button", { name: "Switch" }));
    expect(surface()).toBe("Switch preview");
    expect(new URL(location.href).searchParams.get("component")).toBe("ui-switch");
    fireEvent.click(within(view.container.querySelector<HTMLElement>("nav")!).getByRole("option", { name: /^Overview, / }));
    expect(surface()).toBe("Library overview");
    expect(new URL(location.href).searchParams.has("component")).toBe(false);

    fireEvent.click(within(view.container.querySelector<HTMLElement>("[data-library-overview]")!).getByRole("button", { name: /^Motion/ }));
    expect(surface()).toBe("Motion foundations");
    await act(async () => {});
  });

  test("each card name opens its own component sheet", async () => {
    const index = sourceIndex();
    const view = render(<LibraryView build={build} storyIndex={index} frameSource="blank" />);
    for (const item of libraryCatalog(index, build).items) {
      const card = within(view.container.querySelector<HTMLElement>(`[data-library-specimen="${item.id}"]`)!);
      fireEvent.click(card.getByRole("button", { name: item.name }));
      expect(view.getByRole("main", { name: `${item.name} preview` })).not.toBeNull();
      expect(new URL(location.href).searchParams.get("component")).toBe(item.id);
      fireEvent.click(view.getByRole("option", { name: /^Overview, / }));
    }
    await act(async () => {});
  });

  test("an overview URL restores the view and theme without restoring stale sheet state", async () => {
    const url = new URL(location.href);
    url.searchParams.delete("component");
    url.searchParams.set("theme", "dark");
    url.searchParams.set("story", "ui-button--default");
    url.searchParams.set("props", JSON.stringify({ children: "Stale" }));
    history.replaceState(history.state, "", url);
    const view = render(<LibraryView build={build} storyIndex={sourceIndex()} frameSource="blank" />);
    await act(async () => {});
    expect(view.getByRole("main", { name: "Library overview" })).not.toBeNull();
    expect(view.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
    expect(new URL(location.href).searchParams.has("component")).toBe(false);
    expect(new URL(location.href).searchParams.has("story")).toBe(false);
    expect(new URL(location.href).searchParams.has("props")).toBe(false);
  });

  test("an unknown component link falls back to the overview", async () => {
    const url = new URL(location.href);
    url.searchParams.set("component", "ui-missing");
    url.searchParams.set("story", "ui-missing--default");
    history.replaceState(history.state, "", url);
    const view = render(<LibraryView build={build} storyIndex={sourceIndex()} frameSource="blank" />);
    await act(async () => {});
    expect(view.container.querySelector("main")?.getAttribute("aria-label")).toBe("Library overview");
    expect(new URL(location.href).searchParams.has("component")).toBe(false);
    expect(new URL(location.href).searchParams.has("story")).toBe(false);
  });
});
