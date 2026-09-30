import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, jest, test } from "bun:test";
import { StrictMode, Suspense, startTransition, useLayoutEffect, useState, type ComponentType, type ReactNode } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { deferSheet } = await import("./deferred-sheet");
const { MoneyModal, MoneyModalHeader, MoneyModalStep, moneySheetLoading } = await import("./money-modal");

let restoreAnimations = () => {};
const baseUiAnimations = globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean };

afterEach(() => {
  restoreAnimations();
  cleanup();
  jest.restoreAllMocks();
});

function fakeSheet(outcomes: ("load" | "fail")[] = ["load"]) {
  const openStates: boolean[] = [];
  let loads = 0;
  function FakeSheet({ open = true, label = "Fake sheet" }: { open?: boolean; label?: string }) {
    openStates.push(open);
    return open ? <div role="dialog" aria-label={label} /> : null;
  }
  const Sheet = deferSheet<{ open?: boolean; label?: string }>(async () => {
    const outcome = outcomes[Math.min(loads, outcomes.length - 1)];
    loads += 1;
    if (outcome === "fail") throw new Error("chunk failed");
    return FakeSheet;
  });
  return { Sheet, openStates, loads: () => loads };
}

type LoadingProps = { open: boolean; opener?: HTMLElement | null; onCancel: () => void; onClosed: () => void };

function delayedSheet(load: () => Promise<ComponentType<LoadingProps>>) {
  return deferSheet(load, (props) => moneySheetLoading({
    title: "Add money", titleId: "add-money-title", closeLabel: "Close add money",
    onCancel: props.onCancel, onClosed: props.onClosed,
  }));
}

function LoadedSheet({ open }: LoadingProps) {
  return open ? <div role="dialog" aria-label="Loaded money sheet">Method list</div> : null;
}

function FocusSheet({ open, opener, onCancel, onClosed }: LoadingProps) {
  return <MoneyModal open={open} opener={opener} labelledBy="loaded-focus-title" onCancel={onCancel} onClose={onClosed}>
    <MoneyModalHeader title="Loaded money sheet" titleId="loaded-focus-title" closeLabel="Close loaded sheet" />
  </MoneyModal>;
}

function DetailSheet({ open, onCancel, onClosed }: LoadingProps) {
  return <MoneyModal open={open} labelledBy="loaded-detail-title" onCancel={onCancel} onClose={onClosed}>
    <MoneyModalStep step="detail">
      <MoneyModalHeader title="Loaded money sheet" titleId="loaded-detail-title" closeLabel="Close loaded sheet" />
    </MoneyModalStep>
  </MoneyModal>;
}

function NestedDetailSheet(props: LoadingProps) {
  return <>
    <MoneyModal open={false} labelledBy="inner-title" onCancel={() => {}} onClose={() => {}}>
      <MoneyModalHeader title="Inner sheet" titleId="inner-title" />
    </MoneyModal>
    <MoneyModal open={props.open} labelledBy="loaded-detail-title" onCancel={props.onCancel} onClose={props.onClosed}>
      <MoneyModalStep step="detail">
        <MoneyModalHeader title="Loaded money sheet" titleId="loaded-detail-title" closeLabel="Close loaded sheet" />
        <MoneyModal open={false} labelledBy="nested-title" onCancel={() => {}} onClose={() => {}}>
          <MoneyModalHeader title="Nested sheet" titleId="nested-title" />
        </MoneyModal>
      </MoneyModalStep>
    </MoneyModal>
  </>;
}

type PopupHeightAnimation = { frames: Keyframe[]; options: KeyframeAnimationOptions };

function recordPopupHeights(reduced: boolean, observe = true) {
  const records: PopupHeightAnimation[] = [];
  const restore = [
    [globalThis, "ResizeObserver"],
    [HTMLElement.prototype, "offsetHeight"],
    [HTMLElement.prototype, "animate"],
    [window, "matchMedia"],
  ] as const;
  const descriptors = restore.map(([target, name]) => [target, name, Object.getOwnPropertyDescriptor(target, name)] as const);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" && reduced, media: query, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute("data-slot") !== "drawer-popup") return 0;
      return this.querySelector("[data-money-step=detail]") ? 673 : 253;
    },
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        if (!observe || target.getAttribute("data-slot") !== "drawer-popup") return;
        queueMicrotask(() => this.callback([{ target, borderBoxSize: [{ blockSize: (target as HTMLElement).offsetHeight }] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver));
      }
      disconnect() {}
    },
  });
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
      if (this.getAttribute("data-slot") === "drawer-popup") records.push({ frames, options });
      return { cancel() {}, finished: Promise.resolve() } as unknown as Animation;
    },
  });
  restoreAnimations = () => {
    restoreAnimations = () => {};
    for (const [target, name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else Reflect.deleteProperty(target, name);
    }
  };
  return records;
}

function FocusJourney({ Sheet }: { Sheet: ReturnType<typeof delayedSheet> }) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  return <>
    <button type="button" onClick={(event) => { setOpener(event.currentTarget); setOpen(true); }}>Open add money</button>
    <Sheet open={open} opener={opener} onCancel={() => setOpen(false)} onClosed={() => {}} />
  </>;
}

function holdEntranceAnimation() {
  let finish = () => {};
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
  const animationsDisabled = baseUiAnimations.BASE_UI_ANIMATIONS_DISABLED;
  baseUiAnimations.BASE_UI_ANIMATIONS_DISABLED = false;
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [{ finished, pending: false, playState: "running" }],
  });
  restoreAnimations = () => {
    restoreAnimations = () => {};
    if (descriptor) Object.defineProperty(Element.prototype, "getAnimations", descriptor);
    else Reflect.deleteProperty(Element.prototype, "getAnimations");
    baseUiAnimations.BASE_UI_ANIMATIONS_DISABLED = animationsDisabled;
  };
  return {
    finish: async () => {
      restoreAnimations();
      await act(async () => { finish(); await finished; });
    },
  };
}

function visibleOpener(element: HTMLElement) {
  const rects = [new DOMRect(0, 0, 100, 44)];
  element.getClientRects = () => Object.assign(rects, { item: (index: number) => rects[index] ?? null });
  return element;
}

function FocusSessions({ sheets, onReady = () => {} }: { sheets: { id: string; Sheet: ReturnType<typeof delayedSheet> }[]; onReady?: (open: (index: number | null) => void) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { onReady((index) => { setOpener(null); setActive(index); }); }, [onReady]);
  return <>
    <button type="button">Unrelated</button>
    <main tabIndex={-1} />
    {sheets.map(({ id, Sheet }, index) => <div key={id}>
      <button type="button" onClick={(event) => { setOpener(event.currentTarget); setActive(index); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setOpener(event.currentTarget); setActive(index); } }}>Open sheet {index}</button>
      <Sheet open={active === index} opener={active === index ? opener : null} onCancel={() => setActive(null)} onClosed={() => {}} />
    </div>)}
  </>;
}
describe("deferSheet", () => {
  test("does not load a sheet that has never been opened", async () => {
    const { Sheet, loads } = fakeSheet();
    render(<Sheet open={false} />);
    await Promise.resolve();
    expect(loads()).toBe(0);
    expect(page().queryByRole("dialog")).toBeNull();
  });

  test("loads on first open and mounts closed before opening so the enter transition runs", async () => {
    const { Sheet, openStates, loads } = fakeSheet();
    const view = render(<Sheet open={false} />);
    view.rerender(<Sheet open />);

    expect(await page().findByRole("dialog", { name: "Fake sheet" })).toBeTruthy();
    expect(loads()).toBe(1);
    expect(openStates[0]).toBe(false);
    expect(openStates.at(-1)).toBe(true);
  });

  test("opens a preloaded sheet in the same render as the trigger", async () => {
    const { Sheet, openStates, loads } = fakeSheet();
    await Sheet.preload();
    const view = render(<Sheet open={false} />);
    view.rerender(<Sheet open />);

    expect(page().getByRole("dialog", { name: "Fake sheet" })).toBeTruthy();
    expect(openStates).toEqual([false, true]);
    expect(loads()).toBe(1);
  });

  test("stages a preloaded sheet that mounts already open on first and repeat visits", async () => {
    const { Sheet, openStates } = fakeSheet();
    await Sheet.preload();
    const view = render(<Sheet open />);

    expect(openStates).toEqual([false]);
    expect(await page().findByRole("dialog", { name: "Fake sheet" })).toBeTruthy();
    expect(openStates).toEqual([false, true]);

    view.unmount();
    render(<Sheet open />);
    expect(openStates).toEqual([false, true, false]);
    expect(await page().findByRole("dialog", { name: "Fake sheet" })).toBeTruthy();
    expect(openStates).toEqual([false, true, false, true]);
  });

  test("does not re-stage a mounted open sheet when its props change", async () => {
    const { Sheet, openStates } = fakeSheet();
    await Sheet.preload();
    const view = render(<Sheet open label="First" />);
    expect(await page().findByRole("dialog", { name: "First" })).toBeTruthy();

    view.rerender(<Sheet open label="Updated" />);
    expect(page().getByRole("dialog", { name: "Updated" })).toBeTruthy();
    expect(openStates).toEqual([false, true, true]);
  });

  test("keeps a keyed replacement of an open sheet open instead of replaying its entrance", async () => {
    const { Sheet, openStates } = fakeSheet();
    await Sheet.preload();
    const view = render(<Sheet key="first-owner" open label="First" />);
    expect(await page().findByRole("dialog", { name: "First" })).toBeTruthy();

    view.rerender(<Sheet key="second-owner" open label="Second" />);
    expect(page().getByRole("dialog", { name: "Second" })).toBeTruthy();
    expect(openStates).toEqual([false, true, true]);
  });

  test("retries a failed load when the trigger preloads again", async () => {
    const { Sheet, loads } = fakeSheet(["fail", "load"]);
    render(<Sheet open />);
    await waitFor(() => expect(loads()).toBe(1));
    expect(page().queryByRole("dialog")).toBeNull();

    await act(() => Sheet.preload());

    expect(await page().findByRole("dialog", { name: "Fake sheet" })).toBeTruthy();
    expect(loads()).toBe(2);
  });

  test("opens the loading shell on the next frame so its entrance runs, then hands off open without a closed render", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const openStates: boolean[] = [];
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    function RecordedSheet({ open }: LoadingProps) {
      openStates.push(open);
      return <LoadedSheet open={open} onCancel={() => {}} onClosed={() => {}} />;
    }
    render(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    expect(await page().findByRole("dialog", { name: "Add money" })).toBeTruthy();
    expect(page().getByRole("button", { name: "Close add money" })).toBeTruthy();
    expect(page().getByText("Loading")).toBeTruthy();

    await act(async () => { resolve(RecordedSheet); });
    expect(page().getByRole("dialog", { name: "Loaded money sheet" })).toBeTruthy();
    expect(page().queryByRole("dialog", { name: "Add money" })).toBeNull();
    expect(openStates.length).toBeGreaterThan(0);
    expect(openStates.every(Boolean)).toBe(true);
  });

  test("a chunk arriving during the loading shell entrance waits for the entrance to finish before handing off", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const openStates: boolean[] = [];
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    function RecordedSheet(props: LoadingProps) {
      openStates.push(props.open);
      return <LoadedSheet {...props} />;
    }
    const entrance = holdEntranceAnimation();
    render(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    await page().findByRole("button", { name: "Close add money" });

    await act(async () => { resolve(RecordedSheet); await Promise.resolve(); });
    expect(page().getByRole("dialog", { name: "Add money" })).toBeTruthy();
    expect(page().queryByRole("dialog", { name: "Loaded money sheet" })).toBeNull();

    await entrance.finish();
    expect(await page().findByRole("dialog", { name: "Loaded money sheet" })).toBeTruthy();
    expect(page().queryByRole("dialog", { name: "Add money" })).toBeNull();
    expect(openStates.length).toBeGreaterThan(0);
    expect(openStates.every(Boolean)).toBe(true);
  });

  test("disabled animations finish the loading shell even when an animation reports itself running", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    const entrance = holdEntranceAnimation();
    baseUiAnimations.BASE_UI_ANIMATIONS_DISABLED = true;
    render(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    await page().findByRole("dialog", { name: "Add money" });
    await act(async () => { resolve(LoadedSheet); await Promise.resolve(); });
    expect(page().getByRole("dialog", { name: "Loaded money sheet" })).toBeTruthy();
    await entrance.finish();
  });

  test("closing the loading shell during its entrance after the chunk arrives closes without handing off", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const openStates: boolean[] = [];
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    function RecordedSheet(props: LoadingProps) {
      openStates.push(props.open);
      return <LoadedSheet {...props} />;
    }
    let closed = 0;
    function Journey() {
      const [open, setOpen] = useState(true);
      return <Sheet open={open} onCancel={() => setOpen(false)} onClosed={() => { closed++; }} />;
    }
    const entrance = holdEntranceAnimation();
    render(<Journey />);
    await page().findByRole("button", { name: "Close add money" });
    await act(async () => { resolve(RecordedSheet); await Promise.resolve(); });
    fireEvent.click(page().getByRole("button", { name: "Close add money" }));
    await entrance.finish();

    await waitFor(() => expect(closed).toBe(1));
    expect(page().queryByRole("dialog")).toBeNull();
    expect(openStates.every((open) => !open)).toBe(true);
  });

  test.each(["deferred", "standalone"])("%s sheet retains its activation-bound opener when an opening transition suspends and retries", async (kind) => {
    let release!: () => void;
    let ready = false;
    const openingRenders: boolean[] = [];
    const pending = new Promise<void>((resolve) => { release = () => { ready = true; resolve(); }; });
    function Gate({ open }: { open: boolean }) {
      if (open && !ready) throw pending;
      return null;
    }
    function ConcurrentSheet(props: LoadingProps) {
      if (props.open) openingRenders.push(props.open);
      return <FocusSheet {...props} opener={kind === "standalone" ? props.opener : undefined} />;
    }
    const Sheet = deferSheet(async () => ConcurrentSheet);
    await Sheet.preload();
    const ControlledSheet = kind === "deferred" ? Sheet : ConcurrentSheet;
    function Journey() {
      const [session, setSession] = useState<{ open: boolean; opener: HTMLElement | null }>({ open: false, opener: null });
      return <>
        <button onClick={(event) => {
          const opener = event.currentTarget;
          startTransition(() => setSession({ open: true, opener }));
        }}>Launch</button>
        <button>Unrelated</button><main tabIndex={-1} />
        <Suspense fallback={<div>Suspended</div>}>
          <ControlledSheet {...session} onCancel={() => setSession((current) => ({ ...current, open: false }))} onClosed={() => {}} />
          <Gate open={session.open} />
        </Suspense>
      </>;
    }
    render(<StrictMode><Journey /></StrictMode>);
    const trigger = visibleOpener(page().getByRole("button", { name: "Launch" }));
    await act(async () => fireEvent.click(trigger));
    expect(openingRenders.length).toBeGreaterThan(0);
    const beforeRetry = openingRenders.length;
    expect(page().queryByRole("dialog")).toBeNull();
    await act(async () => { fireEvent.click(page().getByRole("button", { name: "Unrelated" })); });
    page().getByRole("main").focus();
    await act(async () => { release(); await pending; });
    const dialog = await page().findByRole("dialog", { name: "Loaded money sheet" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(openingRenders.length).toBeGreaterThan(beforeRetry);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  test("returns focus to the opener when the drawer mounts already open after focus moved outside", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = deferSheet<LoadingProps>(() => new Promise((done) => { resolve = done; }));
    function Journey() {
      const [open, setOpen] = useState(false);
      const [opener, setOpener] = useState<HTMLElement | null>(null);
      return <>
        <button type="button" onClick={(event) => { setOpener(event.currentTarget); setOpen(true); }}>Open add money</button>
        <main tabIndex={-1} />
        <Sheet open={open} opener={opener} onCancel={() => setOpen(false)} onClosed={() => {}} />
      </>;
    }
    render(<Journey />);
    const trigger = page().getByRole("button", { name: "Open add money" });
    const rects = [new DOMRect(0, 0, 100, 44)];
    trigger.getClientRects = () => Object.assign(rects, { item: (index: number) => rects[index] ?? null });
    trigger.focus();
    await act(async () => fireEvent.click(trigger));
    page().getByRole("main").focus();
    await act(async () => { resolve(FocusSheet); await Promise.resolve(); });
    const dialog = await page().findByRole("dialog", { name: "Loaded money sheet" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Loaded money sheet" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("returns focus to a clicked opener that never received focus", async () => {
    const Sheet = delayedSheet(async () => FocusSheet);
    await Sheet.preload();
    function Journey() {
      const [open, setOpen] = useState(false);
      const [opener, setOpener] = useState<HTMLElement | null>(null);
      return <>
        <button type="button" onClick={(event) => { setOpener(event.currentTarget); setOpen(true); }}>Open add money</button>
        <Sheet open={open} opener={opener} onCancel={() => setOpen(false)} onClosed={() => {}} />
      </>;
    }
    render(<Journey />);
    const trigger = page().getByRole("button", { name: "Open add money" });
    const rects = [new DOMRect(0, 0, 100, 44)];
    trigger.getClientRects = () => Object.assign(rects, { item: (index: number) => rects[index] ?? null });
    await act(async () => fireEvent.click(trigger));
    const dialog = await page().findByRole("dialog", { name: "Loaded money sheet" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Loaded money sheet" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("returns focus to a non-button opener when the drawer mounts already open", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = deferSheet<LoadingProps>(() => new Promise((done) => { resolve = done; }));
    function Journey() {
      const [open, setOpen] = useState(false);
      const [opener, setOpener] = useState<HTMLElement | null>(null);
      return <>
        <button type="button">Other</button>
        <a href="#add-money" onClick={(event) => { event.preventDefault(); setOpener(event.currentTarget); setOpen(true); }}>Open add money</a>
        <main tabIndex={-1} />
        <Sheet open={open} opener={opener} onCancel={() => setOpen(false)} onClosed={() => {}} />
      </>;
    }
    render(<Journey />);
    const opener = page().getByRole("link", { name: "Open add money" });
    const rects = [new DOMRect(0, 0, 100, 44)];
    opener.getClientRects = () => Object.assign(rects, { item: (index: number) => rects[index] ?? null });
    page().getByRole("button", { name: "Other" }).focus();
    opener.focus();
    await act(async () => fireEvent.click(opener));
    page().getByRole("main").focus();
    await act(async () => { resolve(FocusSheet); await Promise.resolve(); });
    const dialog = await page().findByRole("dialog", { name: "Loaded money sheet" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Loaded money sheet" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  test("keeps focus inside the loaded sheet during handoff and returns it to the trigger on close", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    render(<FocusJourney Sheet={Sheet} />);
    const trigger = page().getByRole("button", { name: "Open add money" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(page().queryByRole("dialog", { name: "Add money" })).toBeNull();
    const loadingDialog = await page().findByRole("dialog", { name: "Add money" });
    await waitFor(() => expect(loadingDialog.contains(document.activeElement)).toBe(true));

    await act(async () => { resolve(FocusSheet); await Promise.resolve(); });
    const loadedDialog = await page().findByRole("dialog", { name: "Loaded money sheet" });
    await act(async () => { await new Promise<void>((done) => requestAnimationFrame(() => done())); });
    expect(page().queryByRole("dialog", { name: "Add money" })).toBeNull();
    expect(loadedDialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(trigger);

    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Loaded money sheet" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("returns focus to the trigger after a normally preloaded sheet closes", async () => {
    const Sheet = delayedSheet(async () => FocusSheet);
    await Sheet.preload();
    render(<FocusJourney Sheet={Sheet} />);
    const trigger = page().getByRole("button", { name: "Open add money" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await act(async () => fireEvent.click(trigger));
    const dialog = await page().findByRole("dialog", { name: "Loaded money sheet" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Loaded money sheet" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  for (const source of ["explicit", "context"] as const) {
    for (const preloaded of [false, true]) {
      test(`${source} null opener survives ${preloaded ? "preloaded entry" : "lazy handoff"} without discarding height`, async () => {
        const heights = recordPopupHeights(false);
        const NullContext = deferSheet<{ open: boolean; children: ReactNode }>(async () => ({ children }) => children);
        await NullContext.preload();
        function NullSheet({ open, onCancel, onClosed }: LoadingProps) {
          const sheet = <MoneyModal open={open} {...(source === "explicit" ? { opener: null } : {})} labelledBy="null-title" onCancel={onCancel} onClose={onClosed}>
            <MoneyModalStep step="detail"><MoneyModalHeader title="Null opener" titleId="null-title" /></MoneyModalStep>
          </MoneyModal>;
          return source === "context" ? <NullContext open={false} opener={null}>{sheet}</NullContext> : sheet;
        }
        let resolve!: (component: ComponentType<LoadingProps>) => void;
        const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
        if (preloaded) {
          const pending = Sheet.preload();
          resolve(NullSheet);
          await pending;
        }
        function Journey() {
          const [session, setSession] = useState<{ open: boolean; opener: HTMLElement | null }>({ open: false, opener: null });
          return <>
            <button type="button" onClick={(event) => setSession({ open: true, opener: event.currentTarget })}>Launch</button>
            <main tabIndex={-1} />
            <Sheet {...session} onCancel={() => setSession((current) => ({ ...current, open: false }))} onClosed={() => {}} />
          </>;
        }
        render(<Journey />);
        const trigger = visibleOpener(page().getByRole("button", { name: "Launch" }));
        const main = page().getByRole("main");
        main.focus();
        await act(async () => fireEvent.click(trigger));
        if (!preloaded) {
          const loading = await page().findByRole("dialog", { name: "Add money" });
          await waitFor(() => expect(loading.contains(document.activeElement)).toBe(true));
          await act(async () => { resolve(NullSheet); });
        }
        const loaded = await page().findByRole("dialog", { name: "Null opener" });
        await waitFor(() => expect(loaded.contains(document.activeElement)).toBe(true));
        expect(heights).toEqual(preloaded ? [] : [{
          frames: [{ height: "253px" }, { height: "673px" }],
          options: { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        }]);
        await act(async () => fireEvent.click(page().getByRole("button", { name: "Close" })));
        await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
        expect(document.activeElement === trigger).toBe(false);
      });
    }
  }

  test.each([false, true])("carried focus remains a fallback and is consumed once, StrictMode=%s", async (strict) => {
    const heights = recordPopupHeights(false);
    const trigger = document.createElement("button");
    trigger.textContent = "Carried opener";
    document.body.append(trigger);
    visibleOpener(trigger);
    try {
      const loading = moneySheetLoading({ title: "Loading", closeLabel: "Close", onCancel: () => {} });
      let payload: { height: number; returnFocus: HTMLElement | null } = { height: 253, returnFocus: trigger };
      const take = jest.fn(() => {
        const received = payload;
        payload = { height: 0, returnFocus: null };
        return received;
      });
      const carry = { take, carryHeight: () => {}, carryReturnFocus: () => {} };
      const renderSheet = (open: boolean) => {
        const sheet = loading.renderLoaded(<DetailSheet open={open} onCancel={() => {}} onClosed={() => {}} />, carry);
        return strict ? <StrictMode>{sheet}</StrictMode> : sheet;
      };
      const view = render(renderSheet(true));
      await page().findByRole("dialog", { name: "Loaded money sheet" });
      expect(take).toHaveBeenCalledTimes(1);
      expect(heights).toEqual(Array.from({ length: strict ? 2 : 1 }, () => ({
        frames: [{ height: "253px" }, { height: "673px" }],
        options: { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      })));
      view.rerender(renderSheet(false));
      await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(trigger);
      expect(take).toHaveBeenCalledTimes(1);
    } finally {
      trigger.remove();
    }
  });

  test.each([false, true])("carried focus survives Suspense effect reattachment with one destructive take, StrictMode=%s", async (strict) => {
    const trigger = visibleOpener(document.createElement("button"));
    trigger.textContent = "Carried opener";
    document.body.append(trigger);
    let payload: { height: number; returnFocus: HTMLElement | null } = { height: 0, returnFocus: trigger };
    const take = jest.fn(() => {
      const received = payload;
      payload = { height: 0, returnFocus: null };
      return received;
    });
    let attachments = 0;
    let detachments = 0;
    let release!: () => void;
    let ready = false;
    const pending = new Promise<void>((resolve) => { release = () => { ready = true; resolve(); }; });
    function Gate({ suspend }: { suspend: boolean }) {
      useLayoutEffect(() => {
        attachments++;
        return () => { detachments++; };
      }, []);
      if (suspend && !ready) throw pending;
      return null;
    }
    const loading = moneySheetLoading({ title: "Loading", closeLabel: "Close", onCancel: () => {} });
    const carry = { take, carryHeight: () => {}, carryReturnFocus: () => {} };
    const tree = (open: boolean, suspend: boolean) => {
      const sheet = <Suspense fallback={<div>Suspended</div>}>
        {loading.renderLoaded(<FocusSheet open={open} onCancel={() => {}} onClosed={() => {}} />, carry)}
        <Gate suspend={suspend} />
      </Suspense>;
      return strict ? <StrictMode>{sheet}</StrictMode> : sheet;
    };
    try {
      const view = render(tree(true, false));
      const dialog = await page().findByRole("dialog", { name: "Loaded money sheet" });
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      expect(take).toHaveBeenCalledTimes(1);
      const before = { attachments, detachments };
      await act(async () => view.rerender(tree(true, true)));
      await page().findByText("Suspended");
      expect(detachments).toBeGreaterThan(before.detachments);
      await act(async () => { release(); await pending; });
      const revealed = await page().findByRole("dialog", { name: "Loaded money sheet" });
      await waitFor(() => expect(revealed.contains(document.activeElement)).toBe(true));
      expect(attachments).toBeGreaterThan(before.attachments);
      view.rerender(tree(false, false));
      await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(trigger);
      expect(take).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
      trigger.remove();
    }
  });

  test("same-task unrelated clicks do not become a programmatic sibling sheet's opener", async () => {
    const sheets = [delayedSheet(async () => FocusSheet), delayedSheet(async () => FocusSheet)];
    await Promise.all(sheets.map((Sheet) => Sheet.preload()));
    const control: { open?: (index: number | null) => void } = {};
    render(<FocusSessions sheets={sheets.map((Sheet, index) => ({ id: String(index), Sheet }))} onReady={(open) => { control.open = open; }} />);
    const unrelated = visibleOpener(page().getByRole("button", { name: "Unrelated" }));
    const main = page().getByRole("main");
    await act(async () => {
      unrelated.focus();
      fireEvent.click(unrelated);
      main.focus();
      control.open!(1);
    });
    const dialog = await page().findByRole("dialog", { name: "Loaded money sheet" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(unrelated);
  });

  test("programmatic reopen replaces the previous interactive session and sibling captures", async () => {
    const sheets = [delayedSheet(async () => FocusSheet), delayedSheet(async () => FocusSheet)];
    await Promise.all(sheets.map((Sheet) => Sheet.preload()));
    const control: { open?: (index: number | null) => void } = {};
    render(<FocusSessions sheets={sheets.map((Sheet, index) => ({ id: String(index), Sheet }))} onReady={(open) => { control.open = open; }} />);
    const trigger = visibleOpener(page().getByRole("button", { name: "Open sheet 0" }));
    await act(async () => fireEvent.click(trigger));
    await page().findByRole("dialog", { name: "Loaded money sheet" });
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    for (const index of [0, 1]) {
      page().getByRole("main").focus();
      await act(async () => control.open!(index));
      const dialog = await page().findByRole("dialog", { name: "Loaded money sheet" });
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
      await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
      expect(document.activeElement).not.toBe(trigger);
    }
  });

  test.each(["Enter", " "])("keyboard %s opening captures only the current session's control", async (key) => {
    const Sheet = delayedSheet(async () => FocusSheet);
    await Sheet.preload();
    render(<FocusSessions sheets={[{ id: "first", Sheet }, { id: "second", Sheet }]} />);
    for (const index of [0, 1, 0]) {
      const trigger = visibleOpener(page().getByRole("button", { name: `Open sheet ${index}` }));
      trigger.focus();
      await act(async () => fireEvent.keyDown(trigger, { key }));
      const dialog = await page().findByRole("dialog", { name: "Loaded money sheet" });
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }
  });

  test("loading cancellation and delayed handoff replace the opener on a later session", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    render(<FocusSessions sheets={[{ id: "first", Sheet }, { id: "second", Sheet }]} />);
    const first = visibleOpener(page().getByRole("button", { name: "Open sheet 0" }));
    await act(async () => fireEvent.click(first));
    await page().findByRole("dialog", { name: "Add money" });
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close add money" })));
    await waitFor(() => expect(document.activeElement).toBe(first));
    const second = visibleOpener(page().getByRole("button", { name: "Open sheet 1" }));
    await act(async () => fireEvent.click(second));
    const loading = await page().findByRole("dialog", { name: "Add money" });
    await waitFor(() => expect(loading.contains(document.activeElement)).toBe(true));
    await act(async () => { resolve(FocusSheet); await Promise.resolve(); });
    const loaded = await page().findByRole("dialog", { name: "Loaded money sheet" });
    await waitFor(() => expect(loaded.contains(document.activeElement)).toBe(true));
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(document.activeElement).toBe(second));
  });

  test("a disconnected opener is not focused and unmount does not contaminate a later initial open", async () => {
    const Sheet = delayedSheet(async () => FocusSheet);
    await Sheet.preload();
    const view = render(<FocusJourney Sheet={Sheet} />);
    const trigger = visibleOpener(page().getByRole("button", { name: "Open add money" }));
    await act(async () => fireEvent.click(trigger));
    await page().findByRole("dialog", { name: "Loaded money sheet" });
    trigger.remove();
    const focus = jest.spyOn(trigger, "focus");
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(focus).not.toHaveBeenCalled();
    view.container.prepend(trigger);
    view.unmount();
    const main = document.createElement("main");
    main.tabIndex = -1;
    document.body.append(main);
    main.focus();
    const next = render(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    await page().findByRole("dialog", { name: "Loaded money sheet" });
    next.rerender(<Sheet open={false} onCancel={() => {}} onClosed={() => {}} />);
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(focus).not.toHaveBeenCalled();
    main.remove();
  });

  test("closing the loading shell cancels, completes the exit, and a late chunk stays closed", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const openStates: boolean[] = [];
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    function RecordedSheet(props: LoadingProps) {
      openStates.push(props.open);
      return <LoadedSheet {...props} />;
    }
    let cancels = 0;
    let closed = 0;
    function Journey() {
      const [open, setOpen] = useState(true);
      return <Sheet open={open} onCancel={() => { cancels++; setOpen(false); }} onClosed={() => { closed++; }} />;
    }
    render(<Journey />);
    fireEvent.click(await page().findByRole("button", { name: "Close add money" }));
    expect(cancels).toBe(1);
    await waitFor(() => expect(closed).toBe(1));
    await act(async () => { resolve(RecordedSheet); });
    expect(openStates.length).toBeGreaterThan(0);
    expect(openStates.every((open) => !open)).toBe(true);
    expect(page().queryByRole("dialog", { name: "Loaded money sheet" })).toBeNull();
    expect(closed).toBe(1);
  });

  test("closing before the loading shell enters still completes the close once", async () => {
    let closed = 0;
    const Sheet = delayedSheet(() => new Promise(() => {}));
    const view = render(<Sheet open onCancel={() => {}} onClosed={() => { closed++; }} />);
    view.rerender(<Sheet open={false} onCancel={() => {}} onClosed={() => { closed++; }} />);
    await waitFor(() => expect(closed).toBe(1));
    view.rerender(<Sheet open={false} onCancel={() => {}} onClosed={() => { closed++; }} />);
    await act(async () => { await new Promise<void>((done) => window.requestAnimationFrame(() => done())); });
    expect(closed).toBe(1);
    expect(page().queryByRole("dialog")).toBeNull();
  });

  test("a chunk arriving during the loading shell exit waits for onClosed", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    let closed = 0;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    function Journey() {
      const [open, setOpen] = useState(true);
      return <Sheet open={open} onCancel={() => setOpen(false)} onClosed={() => { closed++; }} />;
    }
    render(<Journey />);
    await page().findByRole("button", { name: "Close add money" });
    await act(async () => {
      fireEvent.click(page().getByRole("button", { name: "Close add money" }));
      resolve(LoadedSheet);
    });
    await waitFor(() => expect(closed).toBe(1));
    expect(page().queryByRole("dialog")).toBeNull();
  });

  test("a chunk arriving after an external close waits for onClosed and mounts closed", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    let closed = 0;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    const view = render(<Sheet open onCancel={() => {}} onClosed={() => { closed++; }} />);
    await page().findByRole("button", { name: "Close add money" });
    view.rerender(<Sheet open={false} onCancel={() => {}} onClosed={() => { closed++; }} />);
    await act(async () => { resolve(LoadedSheet); });
    await waitFor(() => expect(closed).toBe(1));
    expect(page().queryByRole("dialog")).toBeNull();
  });

  test("an external close after a reopen still completes its exit when the chunk arrives", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    let closed = 0;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    const props = { onCancel: () => {}, onClosed: () => { closed++; } };
    const view = render(<Sheet open {...props} />);
    await page().findByRole("button", { name: "Close add money" });
    view.rerender(<Sheet open={false} {...props} />);
    await waitFor(() => expect(closed).toBe(1));
    view.rerender(<Sheet open {...props} />);
    await page().findByRole("button", { name: "Close add money" });
    view.rerender(<Sheet open={false} {...props} />);
    await act(async () => { resolve(LoadedSheet); });
    await waitFor(() => expect(closed).toBe(2));
    expect(page().queryByRole("dialog")).toBeNull();
  });

  test("an external close and a chunk arriving in one batch still completes the exit", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    let closed = 0;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    const props = { onCancel: () => {}, onClosed: () => { closed++; } };
    const view = render(<Sheet open {...props} />);
    await page().findByRole("button", { name: "Close add money" });
    await act(async () => {
      view.rerender(<Sheet open={false} {...props} />);
      resolve(LoadedSheet);
      await Promise.resolve();
    });
    await waitFor(() => expect(closed).toBe(1));
    expect(page().queryByRole("dialog")).toBeNull();
  });

  test("an external close after the handoff closes the loaded sheet, not the loading shell", async () => {
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    let closed = 0;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    const props = { onCancel: () => {}, onClosed: () => { closed++; } };
    const view = render(<Sheet open {...props} />);
    await page().findByRole("button", { name: "Close add money" });
    await act(async () => { resolve(FocusSheet); await Promise.resolve(); });
    await page().findByRole("dialog", { name: "Loaded money sheet" });
    view.rerender(<Sheet open={false} {...props} />);
    await waitFor(() => expect(closed).toBe(1));
    expect(page().queryByRole("dialog", { name: "Add money" })).toBeNull();
    expect(page().queryByRole("dialog")).toBeNull();
  });

  test("the loaded sheet eases its height from the loading shell's height on handoff", async () => {
    const heights = recordPopupHeights(false);
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    render(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    await page().findByRole("button", { name: "Close add money" });
    expect(heights).toEqual([]);

    await act(async () => { resolve(DetailSheet); await Promise.resolve(); });
    await page().findByRole("dialog", { name: "Loaded money sheet" });
    expect(page().queryByRole("dialog", { name: "Add money" })).toBeNull();
    expect(heights).toEqual([{
      frames: [{ height: "253px" }, { height: "673px" }],
      options: { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    }]);
  });

  test("handoff captures the shell height when layout observation has not fired yet", async () => {
    const heights = recordPopupHeights(false, false);
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    render(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    await page().findByRole("button", { name: "Close add money" });
    await act(async () => { resolve(DetailSheet); await Promise.resolve(); });
    await page().findByRole("dialog", { name: "Loaded money sheet" });
    expect(heights).toEqual([{
      frames: [{ height: "253px" }, { height: "673px" }],
      options: { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    }]);
  });

  test("the handoff resizes instantly under reduced motion", async () => {
    const heights = recordPopupHeights(true);
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    render(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    await page().findByRole("button", { name: "Close add money" });
    await act(async () => { resolve(DetailSheet); await Promise.resolve(); });
    await page().findByRole("dialog", { name: "Loaded money sheet" });
    expect(heights).toEqual([]);
  });

  test("an unrelated sheet mounted in the handoff commit does not take the shell height", async () => {
    const heights = recordPopupHeights(false);
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    let showSibling!: () => void;
    let shellEntered = false;
    const Sheet = deferSheet(
      () => new Promise<ComponentType<LoadingProps>>((done) => { resolve = done; }).then((component) => { showSibling(); return component; }),
      (props: LoadingProps) => {
        const shell = moneySheetLoading({ title: "Add money", titleId: "add-money-title", closeLabel: "Close add money", onCancel: props.onCancel, onClosed: props.onClosed });
        return { ...shell, render: (state) => shell.render({ ...state, onEntered: () => { shellEntered = true; state.onEntered(); } }) };
      },
    );
    function Journey() {
      const [sibling, setSibling] = useState(false);
      useLayoutEffect(() => { showSibling = () => setSibling(true); }, []);
      return <>
        {sibling ? <MoneyModal open={false} labelledBy="sibling-title" onCancel={() => {}} onClose={() => {}}>
          <MoneyModalHeader title="Sibling sheet" titleId="sibling-title" />
        </MoneyModal> : null}
        <Sheet open onCancel={() => {}} onClosed={() => {}} />
      </>;
    }
    render(<Journey />);
    await waitFor(() => expect(shellEntered).toBe(true));
    await act(async () => { resolve(DetailSheet); await Promise.resolve(); });
    await page().findByRole("dialog", { name: "Loaded money sheet" });
    expect(heights).toEqual([{
      frames: [{ height: "253px" }, { height: "673px" }],
      options: { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    }]);
  });

  test("closed sheets inside the loaded sheet do not take the shell height", async () => {
    const heights = recordPopupHeights(false);
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    render(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    await page().findByRole("button", { name: "Close add money" });
    await act(async () => { resolve(NestedDetailSheet); await Promise.resolve(); });
    await page().findByRole("dialog", { name: "Loaded money sheet" });
    expect(heights).toEqual([{
      frames: [{ height: "253px" }, { height: "673px" }],
      options: { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    }]);
  });

  test("reopening a handed-off sheet does not replay the shell height", async () => {
    const heights = recordPopupHeights(false);
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = delayedSheet(() => new Promise((done) => { resolve = done; }));
    function Journey() {
      const [open, setOpen] = useState(true);
      return <>
        <button type="button" onClick={() => setOpen(true)}>Reopen</button>
        <Sheet open={open} onCancel={() => setOpen(false)} onClosed={() => {}} />
      </>;
    }
    render(<Journey />);
    await page().findByRole("button", { name: "Close add money" });
    await act(async () => { resolve(DetailSheet); await Promise.resolve(); });
    await page().findByRole("dialog", { name: "Loaded money sheet" });
    expect(heights).toHaveLength(1);

    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Reopen" })));
    expect(await page().findByRole("dialog", { name: "Loaded money sheet" })).toBeTruthy();
    expect(heights).toHaveLength(1);
  });

  test("automatic failures show a Retry card, then a successful retry replaces the shell", async () => {
    const realSetTimeout = window.setTimeout.bind(window);
    const retries = new Map<number, () => void>();
    jest.spyOn(window, "setTimeout").mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 1_000 || delay === 2_000) {
        retries.set(delay, handler as () => void);
        return -delay;
      }
      return realSetTimeout(handler, delay, ...args);
    }) as typeof setTimeout);
    let loads = 0;
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = delayedSheet(() => {
      loads += 1;
      return loads <= 3 ? Promise.reject(new Error("chunk failed")) : new Promise((done) => { resolve = done; });
    });
    render(<FocusJourney Sheet={Sheet} />);
    const trigger = visibleOpener(page().getByRole("button", { name: "Open add money" }));
    await act(async () => fireEvent.click(trigger));
    await act(async () => { await Promise.resolve(); });
    expect(page().getByText("Loading")).toBeTruthy();
    await act(async () => { retries.get(1_000)!(); await Promise.resolve(); });
    await act(async () => { retries.get(2_000)!(); await Promise.resolve(); });
    expect(loads).toBe(3);
    expect(page().getByRole("alert").textContent).toContain("Couldn't load this step");
    fireEvent.click(page().getByRole("button", { name: "Try again" }));
    expect(page().getByText("Loading")).toBeTruthy();
    await act(async () => { resolve(FocusSheet); });
    jest.restoreAllMocks();
    expect(page().getByRole("dialog", { name: "Loaded money sheet" })).toBeTruthy();
    expect(loads).toBe(4);
    const dialog = page().getByRole("dialog", { name: "Loaded money sheet" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close loaded sheet" })));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("repeated opens and preloads share one import and one loading dialog", async () => {
    let loads = 0;
    let resolve!: (component: ComponentType<LoadingProps>) => void;
    const Sheet = delayedSheet(() => {
      loads += 1;
      return new Promise((done) => { resolve = done; });
    });
    const view = render(<Sheet open={false} onCancel={() => {}} onClosed={() => {}} />);
    expect(loads).toBe(0);
    view.rerender(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    view.rerender(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    void Sheet.preload();
    expect(await page().findAllByRole("dialog")).toHaveLength(1);
    expect(loads).toBe(1);
    await act(async () => { resolve(LoadedSheet); });
    expect(page().getAllByRole("dialog")).toHaveLength(1);
  });
});
