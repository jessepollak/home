import "@/client/account/dom-test-harness";

import { afterEach, expect, mock, test } from "bun:test";
import type { ActivityLedgerItem } from "./activity-ledger";
import { Activity, createRef, type ComponentProps } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { VirtualActivityList } = await import("./virtual-activity-list");

type RowProps = ComponentProps<typeof VirtualActivityList>["Row"] extends React.ComponentType<infer P> ? P : never;
const Row = ({ row, onOpen, liProps }: RowProps) => {
  if (!("item" in row)) throw new Error("Expected item row");
  return <li {...liProps}><button type="button" onClick={(event) => onOpen(row.item, event.currentTarget)}>{row.item.title}</button></li>;
};
const onOpen = () => {};
const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
afterEach(() => {
  cleanup();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalHeight);
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalWidth);
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
  return (node: Element, entry?: ResizeObserverEntry) => act(() => {
    for (const observer of observers.filter(({ observed }) => observed.has(node))) {
      observer.callback(entry ? [entry] : [], {} as ResizeObserver);
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

const props = { attentionLabel: "Action needed", onOpen, onToggle: () => {}, Row };

function list(items: ActivityLedgerItem[], exhausted = false) {
  return <main data-app-main-authenticated="" style={{ overflowY: "auto" }}><section tabIndex={-1} aria-label="Activity">
    <VirtualActivityList {...props} id="recent-list" items={items.map((entry) => ({ key: `${entry.family}:${entry.id}`, item: entry }))} exhausted={exhausted} labelledBy="recent-title" />
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

test("restores measured positions on resume", async () => {
  mockHeights((index) => index < 6 || index % 2 === 0 ? 116 : 36);
  const rows = Array.from({ length: 80 }, (_, index) => item(`row-${index}`));
  const show = (active: boolean) => <Activity mode={active ? "visible" : "hidden"}>{list(rows, true)}</Activity>;
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
  expect(ul.style.height).toBe(height);
  view.rerender(show(true));
  expect(Number.parseFloat(ul.style.height)).toBeGreaterThan(80 * 64);
  expect(firstVisible()).toEqual(visible);
});

test("resumes measured rows without synchronous geometry reads and updates after resize observations", () => {
  mockHeights(() => 60);
  const offset = { current: 40 };
  mockListOffset(offset);
  const rect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === "LI") return { height: 60.25 } as DOMRect;
    return rect.call(this);
  };
  const resize = mockListResize();
  const rows = Array.from({ length: 14 }, (_, index) => item(`row-${index}`));
  const items = rows.map((entry) => ({ key: `${entry.family}:${entry.id}`, item: entry }));
  const show = (active: boolean) => <Activity mode={active ? "visible" : "hidden"}><main data-app-main-authenticated="" style={{ overflowY: "auto" }}><section>
    <VirtualActivityList {...props} id="recent-list" items={items} exhausted={false} />
  </section></main></Activity>;
  const view = render(show(true));
  const ul = view.container.querySelector("ul")!;
  const main = view.container.querySelector("main")!;
  const row = (index: number) => ul.querySelector<HTMLElement>(`li[data-index="${index}"]`)!;
  expect(row(1).style.transform).toBe("translateY(60.25px)");
  view.rerender(show(false));
  const reads = { rowRect: 0, rowHeight: 0, hostWidth: 0, hostHeight: 0, listRect: 0, hostRect: 0 };
  const measuredRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === "LI") reads.rowRect++;
    if (this.tagName === "UL") reads.listRect++;
    if (this.tagName === "MAIN") reads.hostRect++;
    return measuredRect.call(this);
  };
  const measuredHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      if (this.tagName === "LI") reads.rowHeight++;
      if (this.tagName === "MAIN") reads.hostHeight++;
      return measuredHeight.get!.call(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      if (this.tagName === "MAIN") reads.hostWidth++;
      return originalWidth.get!.call(this);
    },
  });
  view.rerender(show(true));
  expect(reads).toEqual({ rowRect: 0, rowHeight: 0, hostWidth: 0, hostHeight: 0, listRect: 0, hostRect: 0 });
  expect(row(1).style.transform).toBe("translateY(60.25px)");
  resize(row(0), { target: row(0), borderBoxSize: [{ blockSize: 75.5, inlineSize: 400 }] } as unknown as ResizeObserverEntry);
  expect(row(1).style.transform).toBe("translateY(75.5px)");
  main.scrollTop = 200;
  offset.current = 56;
  resize(ul);
  expect(main.scrollTop).toBe(200);
  resize(main, { target: main, borderBoxSize: [{ blockSize: 200, inlineSize: 400 }] } as unknown as ResizeObserverEntry);
  expect(reads.hostWidth).toBe(0);
  expect(reads.hostHeight).toBe(0);
  offset.current = 72;
  resize(ul);
  expect(main.scrollTop).toBe(216);
});

test("resumes rows measured at the estimate without synchronous row geometry reads", () => {
  mockHeights();
  mockListOffset({ current: 40 });
  const rect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === "LI") return { height: 64 } as DOMRect;
    return rect.call(this);
  };
  mockListResize();
  const rows = Array.from({ length: 14 }, (_, index) => item(`row-${index}`));
  const items = rows.map((entry) => ({ key: `${entry.family}:${entry.id}`, item: entry }));
  const show = (active: boolean) => <Activity mode={active ? "visible" : "hidden"}><main data-app-main-authenticated="" style={{ overflowY: "auto" }}><section>
    <VirtualActivityList {...props} id="recent-list" items={items} exhausted={false} />
  </section></main></Activity>;
  const view = render(show(true));
  const ul = view.container.querySelector("ul")!;
  const row = (index: number) => ul.querySelector<HTMLElement>(`li[data-index="${index}"]`)!;
  const position = row(1).style.transform;
  const lastPosition = row(13).style.transform;
  const height = ul.style.height;
  expect(position).toBe("translateY(64px)");
  expect(lastPosition).toBe("translateY(832px)");
  expect(height).toBe("896px");
  view.rerender(show(false));
  const reads = { rowRect: 0, rowHeight: 0 };
  const measuredRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === "LI") reads.rowRect++;
    return measuredRect.call(this);
  };
  const measuredHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      if (this.tagName === "LI") reads.rowHeight++;
      return measuredHeight.get!.call(this);
    },
  });
  view.rerender(show(true));
  expect(reads).toEqual({ rowRect: 0, rowHeight: 0 });
  expect(row(1).style.transform).toBe(position);
  expect(row(13).style.transform).toBe(lastPosition);
  expect(ul.style.height).toBe(height);
});

test("reads a newly mounted row once on resume while reused rows stay unread", () => {
  mockHeights();
  mockListOffset({ current: 40 });
  let rowHeight = 64;
  const rect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === "LI") return { height: rowHeight } as DOMRect;
    return rect.call(this);
  };
  mockListResize();
  const rows = Array.from({ length: 14 }, (_, index) => item(`row-${index}`));
  const items = (entries: ActivityLedgerItem[]) => entries.map((entry) => ({ key: `${entry.family}:${entry.id}`, item: entry }));
  const show = (active: boolean, entries: ActivityLedgerItem[]) => <Activity mode={active ? "visible" : "hidden"}><main data-app-main-authenticated="" style={{ overflowY: "auto" }}><section>
    <VirtualActivityList {...props} id="recent-list" items={items(entries)} exhausted={false} />
  </section></main></Activity>;
  const view = render(show(true, rows));
  const ul = view.container.querySelector("ul")!;
  const row = (index: number) => ul.querySelector<HTMLElement>(`li[data-index="${index}"]`)!;
  expect(row(13).style.transform).toBe("translateY(832px)");
  view.rerender(show(false, rows));
  const reads = { rowRect: 0, rowHeight: 0 };
  const measuredRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === "LI") reads.rowRect++;
    return measuredRect.call(this);
  };
  const measuredHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      if (this.tagName === "LI") reads.rowHeight++;
      return measuredHeight.get!.call(this);
    },
  });
  rowHeight = 66.5;
  view.rerender(show(true, [...rows, item("row-new")]));
  expect(reads.rowRect + reads.rowHeight).toBe(1);
  expect(row(13).style.transform).toBe("translateY(832px)");
  expect(row(14).style.transform).toBe("translateY(896px)");
  expect(ul.style.height).toBe("962.5px");
});


test("keeps fractional row heights on initial measurement before a resize observation", () => {
  mockHeights(() => 60);
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === "LI") return { height: 60.25 } as DOMRect;
    return originalRect.call(this);
  };
  const view = render(list(Array.from({ length: 14 }, (_, index) => item(`row-${index}`))));
  const ul = view.container.querySelector("ul")!;
  expect(ul.style.height).toBe("843.5px");
  expect(ul.querySelector<HTMLElement>('li[data-index="13"]')?.style.transform).toBe("translateY(783.25px)");
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
  const view = render(<main data-app-main-authenticated="" style={{ overflowY: "auto" }} />);
  const main = view.container.querySelector("main")!;
  const write = mock((options?: ScrollToOptions | number, y?: number) => {
    main.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0;
  });
  main.scrollTo = write;
  main.scrollTop = 100;
  view.rerender(list(rows));
  expect(main.scrollTop).toBe(100);
  expect(write).not.toHaveBeenCalled();
  view.rerender(<></>);
  main.scrollTop = 200;
  view.rerender(list(rows));
  expect(main.scrollTop).toBe(200);
  expect(write).not.toHaveBeenCalled();
});

test("remeasures a far jump but skips redundant measurements during a fling", () => {
  mockHeights();
  mockListOffset({ current: 0 });
  const rows = Array.from({ length: 300 }, (_, index) => item(`row-${index}`));
  const handle = createRef<{ restore: (key: string) => boolean }>();
  const view = render(<main data-app-main-authenticated="" style={{ overflowY: "auto" }}><section>
    <VirtualActivityList {...props} ref={handle} id="recent-list" items={rows.map((entry) => ({ key: `${entry.family}:${entry.id}`, item: entry }))} exhausted />
  </section></main>);
  const main = view.container.querySelector("main")!;
  const ul = view.container.querySelector("ul")!;
  Object.defineProperty(main, "clientHeight", { configurable: true, value: 800 });
  const query = mock(ul.querySelectorAll.bind(ul));
  ul.querySelectorAll = query as typeof ul.querySelectorAll;
  main.scrollTop = 1000;
  fireEvent.scroll(main);
  expect(query).toHaveBeenCalledWith("li[data-index]");
  query.mockClear();
  main.scrollTop = 2200;
  fireEvent.scroll(main);
  expect(query).not.toHaveBeenCalledWith("li[data-index]");
  main.scrollTo = ((options: ScrollToOptions) => {
    main.scrollTop = options.top ?? 0;
    fireEvent.scroll(main);
  }) as typeof main.scrollTo;
  act(() => expect(handle.current?.restore("onchain-transfer:row-170")).toBe(true));
  expect(query).toHaveBeenCalledWith("li[data-index]");
});

test("a no-op jump does not remeasure rows on the next fling scroll", () => {
  mockHeights();
  mockListOffset({ current: 0 });
  const rows = Array.from({ length: 300 }, (_, index) => item(`row-${index}`));
  const handle = createRef<{ restore: (key: string) => boolean }>();
  const view = render(<main data-app-main-authenticated="" style={{ overflowY: "auto" }}><section>
    <VirtualActivityList {...props} ref={handle} id="recent-list" items={rows.map((entry) => ({ key: `${entry.family}:${entry.id}`, item: entry }))} exhausted />
  </section></main>);
  const main = view.container.querySelector("main")!;
  const ul = view.container.querySelector("ul")!;
  Object.defineProperty(main, "clientHeight", { configurable: true, value: 800 });
  Object.defineProperty(main, "scrollHeight", { configurable: true, value: 300 * 64 });
  const query = mock(ul.querySelectorAll.bind(ul));
  ul.querySelectorAll = query as typeof ul.querySelectorAll;
  main.scrollTop = 1040;
  fireEvent.scroll(main);
  expect(query).toHaveBeenCalledWith("li[data-index]");
  query.mockClear();
  const scrollTo = mock((options: ScrollToOptions) => {
    expect(options.top).toBe(1040);
  });
  main.scrollTo = scrollTo as typeof main.scrollTo;
  act(() => expect(handle.current?.restore("onchain-transfer:row-22")).toBe(true));
  expect(scrollTo).toHaveBeenCalled();
  query.mockClear();
  main.scrollTop = 2300;
  fireEvent.scroll(main);
  expect(query).not.toHaveBeenCalledWith("li[data-index]");
});

test("reads the viewport size only when the list mounts", () => {
  mockHeights();
  const rows = Array.from({ length: 20 }, (_, index) => item(`row-${index}`));
  const reads = { width: 0, height: 0 };
  const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const height = Object.getOwnPropertyDescriptor(window, "innerHeight");
  Object.defineProperty(window, "innerWidth", { configurable: true, get() { reads.width++; return 390; } });
  Object.defineProperty(window, "innerHeight", { configurable: true, get() { reads.height++; return 844; } });
  try {
    const view = render(list(rows));
    expect(reads).toEqual({ width: 1, height: 1 });
    view.rerender(<main data-app-main-authenticated=""><section tabIndex={-1} aria-label="Activity">
      <VirtualActivityList {...props} onOpen={() => {}} id="recent-list" items={rows.map((entry) => ({ key: `${entry.family}:${entry.id}`, item: entry }))} exhausted={false} labelledBy="recent-title" />
    </section></main>);
    view.rerender(list([item("row-new"), ...rows]));
    expect(view.container.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(reads).toEqual({ width: 1, height: 1 });
  } finally {
    if (width) Object.defineProperty(window, "innerWidth", width);
    else Reflect.deleteProperty(window, "innerWidth");
    if (height) Object.defineProperty(window, "innerHeight", height);
    else Reflect.deleteProperty(window, "innerHeight");
  }
});
