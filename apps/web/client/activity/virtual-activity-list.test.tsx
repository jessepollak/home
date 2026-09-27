import "@/client/account/dom-test-harness";

import { afterEach, expect, mock, test } from "bun:test";
import { ShellPanelActiveContext } from "@/client/home/panel-shared";
import type { ActivityLedgerItem } from "./activity-ledger";
import type { ComponentProps } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { VirtualActivityList } = await import("./virtual-activity-list");

type RowProps = ComponentProps<typeof VirtualActivityList>["Row"] extends React.ComponentType<infer P> ? P : never;
const Row = ({ item, onOpen, liProps }: RowProps) => (
  <li {...liProps}><button type="button" onClick={(event) => onOpen(item, event.currentTarget)}>{item.title}</button></li>
);
const onOpen = () => {};
const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
afterEach(() => {
  cleanup();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalHeight);
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  if (originalResizeObserver) Object.defineProperty(globalThis, "ResizeObserver", originalResizeObserver);
  else Reflect.deleteProperty(globalThis, "ResizeObserver");
});

function mockHeights(rowHeight: (index: number) => number = () => 64) {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() { return this.tagName === "LI" ? rowHeight(Number((this as HTMLElement).dataset.index)) : this.tagName === "MAIN" ? 800 : 0; },
  });
}

function mockListOffset(offset: { current: number }) {
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === "MAIN") return { top: 0 } as DOMRect;
    if (this.tagName === "UL") return { top: offset.current - this.closest("main")!.scrollTop } as DOMRect;
    return originalRect.call(this);
  };
}

function mockListResize() {
  const observers: { callback: ResizeObserverCallback; observed: Set<Element> }[] = [];
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      private record: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, observed: new Set() };
        observers.push(this.record);
      }
      observe(node: Element) { this.record.observed.add(node); }
      unobserve(node: Element) { this.record.observed.delete(node); }
      disconnect() { this.record.observed.clear(); }
    },
  });
  return (list: HTMLUListElement) => act(() => {
    for (const observer of observers.filter(({ observed }) => observed.has(list))) {
      observer.callback([], {} as ResizeObserver);
    }
  });
}

function item(id: string): ActivityLedgerItem {
  return {
    family: "onchain-transfer", id, title: id, status: "confirmed", timestamp: "2026-09-15T12:00:00.000Z",
    dateLabel: "Today", amount: "$1.00", direction: "in",
    detail: { family: "onchain-transfer", counterpartyLabel: "From", counterparty: "Other", network: "Base" },
  };
}

const props = { attentionLabel: "Action needed", onOpen, Row };

function list(items: ActivityLedgerItem[], exhausted = false) {
  return <main data-app-main-authenticated=""><section tabIndex={-1} aria-label="Activity">
    <VirtualActivityList {...props} items={items} exhausted={exhausted} labelledBy="recent-title" />
  </section></main>;
}

test("keeps the same activity row at the viewport offset when an item is inserted before it", async () => {
  mockHeights();
  mockListOffset({ current: 0 });
  const rows = Array.from({ length: 80 }, (_, index) => item(`row-${index}`));
  const view = render(list(rows));
  const main = view.container.querySelector("main")!;
  main.scrollTop = 960;
  fireEvent.scroll(main);
  await waitFor(() => expect(view.container.querySelector('li[data-index="15"]')).not.toBeNull());
  view.rerender(list([item("new"), ...rows]));
  expect(main.scrollTop).toBe(1024);
  expect(view.container.querySelector('li[data-index="16"]')?.getAttribute("aria-posinset")).toBe("17");
});

test("lets new rows appear at the top when the list has not been scrolled past", () => {
  mockHeights();
  const rows = Array.from({ length: 80 }, (_, index) => item(`row-${index}`));
  const view = render(list(rows));
  const main = view.container.querySelector("main")!;
  view.rerender(list([item("new"), ...rows]));
  expect(main.scrollTop).toBe(0);
  expect(view.container.querySelector('li[aria-posinset="1"]')?.textContent).toBe("new");
});

test("uses the current host offset when rows change before a scroll event", () => {
  mockHeights();
  mockListOffset({ current: 0 });
  const rows = Array.from({ length: 80 }, (_, index) => item(`row-${index}`));
  const view = render(list(rows));
  const main = view.container.querySelector("main")!;
  main.scrollTop = 960;
  view.rerender(list([item("new"), ...rows]));
  expect(main.scrollTop).toBe(1024);
  fireEvent.scroll(main);
  expect(view.container.querySelector('li[aria-posinset="1"]')).toBeNull();
});

test("keeps the visible row fixed when content above shrinks as a row is inserted", async () => {
  mockHeights();
  const offset = { current: 180 };
  mockListOffset(offset);
  const resize = mockListResize();
  const rows = Array.from({ length: 80 }, (_, index) => item(`row-${index}`));
  const view = render(list(rows));
  const main = view.container.querySelector("main")!;
  main.scrollTop = 960;
  fireEvent.scroll(main);
  const anchored = () => view.getByRole("button", { name: "row-12" }).closest("li")!;
  await waitFor(() => expect(anchored()).not.toBeNull());
  const position = () => offset.current + Number(anchored().dataset.index) * 64 - main.scrollTop;
  const before = position();
  offset.current -= 60;
  view.rerender(list([item("new"), ...rows]));
  expect(position()).toBe(before);
  resize(view.container.querySelector("ul")!);
  expect(position()).toBe(before);
  expect(main.scrollTop).toBe(964);
});

test("compensates a list offset change observed without any item change", () => {
  mockHeights();
  const offset = { current: 180 };
  mockListOffset(offset);
  const resize = mockListResize();
  const view = render(list(Array.from({ length: 80 }, (_, index) => item(`row-${index}`))));
  const main = view.container.querySelector("main")!;
  const ul = view.container.querySelector("ul")!;
  main.scrollTop = 960;
  fireEvent.scroll(main);
  const before = offset.current + 12 * 64 - main.scrollTop;
  offset.current -= 60;
  resize(ul);
  expect(offset.current + 12 * 64 - main.scrollTop).toBe(before);
  expect(main.scrollTop).toBe(900);
});

test("does not write scroll when the viewport was above the previous list top", () => {
  mockHeights();
  const offset = { current: 120 };
  mockListOffset(offset);
  const rows = Array.from({ length: 80 }, (_, index) => item(`row-${index}`));
  const view = render(list(rows));
  const main = view.container.querySelector("main")!;
  let current = 100;
  const writes = mock((value: number) => { current = value; });
  Object.defineProperty(main, "scrollTop", { configurable: true, get: () => current, set: writes });
  offset.current += 60;
  view.rerender(list([item("new"), ...rows]));
  expect(main.scrollTop).toBe(100);
  expect(writes).not.toHaveBeenCalled();
});

test("keeps the visible row fixed when content above pushes the list top below the viewport", async () => {
  mockHeights();
  const offset = { current: 120 };
  mockListOffset(offset);
  const resize = mockListResize();
  const rows = Array.from({ length: 80 }, (_, index) => item(`row-${index}`));
  const view = render(list(rows));
  const main = view.container.querySelector("main")!;
  main.scrollTop = 150;
  fireEvent.scroll(main);
  const anchored = () => view.getByRole("button", { name: "row-0" }).closest("li")!;
  const position = () => offset.current + Number(anchored().dataset.index) * 64 - main.scrollTop;
  await waitFor(() => expect(anchored()).not.toBeNull());
  const before = position();
  offset.current += 60;
  view.rerender(list([item("new"), ...rows]));
  expect(position()).toBe(before);
  resize(view.container.querySelector("ul")!);
  expect(position()).toBe(before);
  expect(main.scrollTop).toBe(274);
});

test("pauses rows while hidden and restores measured positions on resume", async () => {
  mockHeights((index) => index < 6 || index % 2 === 0 ? 116 : 36);
  const rows = Array.from({ length: 80 }, (_, index) => item(`row-${index}`));
  const show = (active: boolean) => <ShellPanelActiveContext value={active}>{list(rows, true)}</ShellPanelActiveContext>;
  const view = render(show(true));
  const ul = view.container.querySelector("ul")!;
  expect(ul.getAttribute("aria-labelledby")).toBe("recent-title");
  expect(ul.querySelector('li[aria-posinset="1"]')?.getAttribute("aria-setsize")).toBe("80");
  expect(ul.querySelectorAll("li").length).toBeLessThan(40);
  const main = view.container.querySelector("main")!;
  ul.getBoundingClientRect = () => ({ top: -main.scrollTop }) as DOMRect;
  main.scrollTop = 1120;
  fireEvent.scroll(main);
  await waitFor(() => expect(ul.querySelector('li[data-index="15"]')).not.toBeNull());
  const firstVisible = () => {
    const row = [...ul.querySelectorAll<HTMLElement>("li")].find((node) =>
      Number.parseFloat(node.style.transform.slice(11)) + node.offsetHeight > main.scrollTop);
    return row && { index: row.dataset.index, position: row.style.transform };
  };
  const height = ul.style.height;
  const visible = firstVisible();
  expect(visible).toBeDefined();
  expect(Number.parseFloat(height)).toBeGreaterThan(80 * 64);
  view.rerender(show(false));
  expect(ul.querySelectorAll("li")).toHaveLength(0);
  expect(ul.style.height).toBe(height);
  view.rerender(show(true));
  expect(Number.parseFloat(ul.style.height)).toBeGreaterThan(80 * 64);
  expect(firstVisible()).toEqual(visible);
});

test("scroll margin positions the rows without reducing the list's content height", () => {
  mockHeights(() => 60);
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === "UL") return { top: 136 } as DOMRect;
    return originalRect.call(this);
  };
  const view = render(list(Array.from({ length: 14 }, (_, index) => item(`row-${index}`))));
  const ul = view.container.querySelector("ul")!;
  expect(ul.style.height).toBe("840px");
  expect(ul.querySelector<HTMLElement>('li[data-index="13"]')?.style.transform).toBe("translateY(780px)");
});

test("never writes the shell's restored scroll when attaching or resuming", () => {
  mockHeights();
  const rows = Array.from({ length: 80 }, (_, index) => item(`row-${index}`));
  const view = render(<main data-app-main-authenticated="" />);
  const main = view.container.querySelector("main")!;
  const write = mock((options?: ScrollToOptions | number, y?: number) => {
    main.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0;
  });
  main.scrollTo = write;
  main.scrollTop = 100;
  view.rerender(list(rows));
  expect(main.scrollTop).toBe(100);
  expect(write).not.toHaveBeenCalled();
  view.rerender(<ShellPanelActiveContext value={false}>{list(rows)}</ShellPanelActiveContext>);
  main.scrollTop = 200;
  view.rerender(<ShellPanelActiveContext value={true}>{list(rows)}</ShellPanelActiveContext>);
  expect(main.scrollTop).toBe(200);
  expect(write).not.toHaveBeenCalled();
});
