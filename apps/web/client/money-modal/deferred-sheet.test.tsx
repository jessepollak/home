import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, jest, test } from "bun:test";
import { useState, type ComponentType } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { deferSheet } = await import("./deferred-sheet");
const { MoneyModal, MoneyModalHeader, moneySheetLoading } = await import("./money-modal");

let restoreAnimations = () => {};

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

type LoadingProps = { open: boolean; onCancel: () => void; onClosed: () => void };

function delayedSheet(load: () => Promise<ComponentType<LoadingProps>>) {
  return deferSheet(load, (props) => moneySheetLoading({
    title: "Add money", titleId: "add-money-title", closeLabel: "Close add money",
    onCancel: props.onCancel, onClosed: props.onClosed,
  }));
}

function LoadedSheet({ open }: LoadingProps) {
  return open ? <div role="dialog" aria-label="Loaded money sheet">Method list</div> : null;
}

function FocusSheet({ open, onCancel, onClosed }: LoadingProps) {
  return <MoneyModal open={open} labelledBy="loaded-focus-title" onCancel={onCancel} onClose={onClosed}>
    <MoneyModalHeader title="Loaded money sheet" titleId="loaded-focus-title" closeLabel="Close loaded sheet" />
  </MoneyModal>;
}

function FocusJourney({ Sheet }: { Sheet: ReturnType<typeof delayedSheet> }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open add money</button>
    <Sheet open={open} onCancel={() => setOpen(false)} onClosed={() => {}} />
  </>;
}

function holdEntranceAnimation() {
  let finish = () => {};
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [{ finished, pending: false, playState: "running" }],
  });
  restoreAnimations = () => {
    restoreAnimations = () => {};
    if (descriptor) Object.defineProperty(Element.prototype, "getAnimations", descriptor);
    else Reflect.deleteProperty(Element.prototype, "getAnimations");
  };
  return {
    finish: async () => {
      restoreAnimations();
      await act(async () => { finish(); await finished; });
    },
  };
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
    render(<Sheet open onCancel={() => {}} onClosed={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(page().getByText("Loading")).toBeTruthy();
    await act(async () => { retries.get(1_000)!(); await Promise.resolve(); });
    await act(async () => { retries.get(2_000)!(); await Promise.resolve(); });
    expect(loads).toBe(3);
    expect(page().getByRole("alert").textContent).toContain("Couldn't load this step");
    fireEvent.click(page().getByRole("button", { name: "Try again" }));
    expect(page().getByText("Loading")).toBeTruthy();
    await act(async () => { resolve(LoadedSheet); });
    expect(page().getByRole("dialog", { name: "Loaded money sheet" })).toBeTruthy();
    expect(loads).toBe(4);
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
