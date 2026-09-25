import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { deferSheet } = await import("./deferred-sheet");

afterEach(() => {
  cleanup();
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
});
