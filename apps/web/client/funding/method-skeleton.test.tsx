import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, jest, test } from "bun:test";
import type { ComponentType } from "react";
import type { RegionId } from "@/config/regions";
import type { AddMoneyStep } from "./add-money-dialog";

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { deferSheet } = await import("@/client/money-modal/deferred-sheet");
const { addMoneySheetLoading } = await import("./method-skeleton");

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

type SheetProps = {
  open?: boolean;
  step: AddMoneyStep;
  regionId: RegionId;
  selectedBinding?: { currency: string } | null;
  onClose: () => void;
  onClosed?: () => void;
};

function LoadedSheet({ open }: SheetProps) {
  return open ? <div role="dialog" aria-label="Loaded Add money">Method list</div> : null;
}

function placeholderRows(dialog: HTMLElement) {
  return [...dialog.querySelectorAll('[aria-hidden="true"] [data-slot="item"]')]
    .filter((row) => row.querySelector('[data-slot="item-media"]') && row.querySelectorAll('[data-slot="item-content"] > *').length === 2);
}

describe("Add money loading shell", () => {
  test("renders a hidden method-list placeholder with a Loading status until the sheet loads", async () => {
    let resolve!: (component: ComponentType<SheetProps>) => void;
    const Sheet = deferSheet<SheetProps>(() => new Promise((done) => { resolve = done; }), addMoneySheetLoading);
    render(<Sheet open step="method" regionId="US" onClose={() => {}} />);

    const dialog = await page().findByRole("dialog", { name: "Add money" });
    expect(placeholderRows(dialog)).toHaveLength(2);
    expect(page().getByRole("status").textContent).toBe("Loading");
    expect(page().getByRole("button", { name: "Close add money" })).toBeTruthy();

    await act(async () => { resolve(LoadedSheet); });
    expect(page().getByRole("dialog", { name: "Loaded Add money" })).toBeTruthy();
    expect(page().queryByText("Loading")).toBeNull();
  });

  test("renders a receive-shaped placeholder instead of method rows on a cold Receive load", async () => {
    const Sheet = deferSheet<SheetProps>(() => new Promise(() => {}), addMoneySheetLoading);
    render(<Sheet open step="receive" regionId="US" onClose={() => {}} />);

    const dialog = await page().findByRole("dialog", { name: "Receive" });
    expect(dialog.querySelector('[aria-hidden="true"] [data-shimmer="receive-badge"]')).toBeTruthy();
    expect(dialog.querySelector('[aria-hidden="true"] [data-shimmer="qr"]')).toBeTruthy();
    expect(dialog.querySelector('[aria-hidden="true"] [data-shimmer="address"]')).toBeTruthy();
    expect(dialog.querySelectorAll('[aria-hidden="true"] [data-shimmer="supported-assets"]')).toHaveLength(3);
    expect(placeholderRows(dialog)).toHaveLength(0);
    expect(page().getByRole("status").textContent).toBe("Loading");
    expect(page().getByRole("button", { name: "Close add money" })).toBeTruthy();
  });

  test.each([
    { step: "order" as const, regionId: "US" as const, selectedBinding: { currency: "GBP" }, title: "Deposit GBP" },
    { step: "open-order" as const, regionId: "DE" as const, selectedBinding: null, title: "Deposit EUR" },
  ])("renders the $step deposit title and generic placeholder", async ({ step, regionId, selectedBinding, title }) => {
    const Sheet = deferSheet<SheetProps>(() => new Promise(() => {}), addMoneySheetLoading);
    render(<Sheet open step={step} regionId={regionId} selectedBinding={selectedBinding} onClose={() => {}} />);

    const dialog = await page().findByRole("dialog", { name: title });
    expect(placeholderRows(dialog)).toHaveLength(0);
    expect(dialog.querySelector('[data-shimmer="qr"]')).toBeNull();
    expect(page().getByRole("button", { name: "Close add money" })).toBeTruthy();
  });

  test("replaces the placeholder with Try again after automatic loads fail", async () => {
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
    const Sheet = deferSheet<SheetProps>(() => {
      loads += 1;
      return Promise.reject(new Error("chunk failed"));
    }, addMoneySheetLoading);
    render(<Sheet open step="method" regionId="US" onClose={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { retries.get(1_000)!(); await Promise.resolve(); });
    await act(async () => { retries.get(2_000)!(); await Promise.resolve(); });

    expect(loads).toBe(3);
    expect(placeholderRows(page().getByRole("dialog", { name: "Add money", hidden: true }))).toHaveLength(0);
    expect(page().getByRole("alert").textContent).toContain("Couldn't load this step");
    fireEvent.click(page().getByRole("button", { name: "Try again" }));
    expect(loads).toBe(4);
    expect(placeholderRows(page().getByRole("dialog", { name: "Add money", hidden: true }))).toHaveLength(2);
  });
});
