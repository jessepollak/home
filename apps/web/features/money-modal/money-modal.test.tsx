import "@/features/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const {
  MONEY_SHEET_DISMISS_PX,
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
} = await import("./money-modal");

const css = readFileSync(resolve(import.meta.dir, "money-modal.module.css"), "utf8");

function page() {
  return within(document.body);
}

function Harness({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open money
      </button>
      <MoneyModal
        open={open}
        labelledBy="money-sheet-title"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <MoneyModalHeader
          title="Send"
          titleId="money-sheet-title"
          onClose={() => setOpen(false)}
          closeLabel="Close send dialog"
        />
        <div>Amount body</div>
        <MoneyModalFooter primaryLabel="Continue" onPrimary={() => {}} />
      </MoneyModal>
    </>
  );
}

afterEach(cleanup);

describe("MoneyModal shell", () => {
  test("locks Direction 2 sheet chrome", () => {
    expect(css).toContain("width: 100%");
    expect(css).toContain("max-height: 88svh");
    expect(css).toContain("border-radius: 16px 16px 0 0");
    expect(css).toContain("box-shadow: 0 -8px 28px rgba(10, 11, 13, 0.18)");
    expect(css).toContain("background: rgba(10, 11, 13, 0.42)");
    expect(css).toContain("width: 36px");
    expect(css).toContain("height: 4px");
    expect(css).toContain("animation: money-sheet-enter 280ms ease-out both");
    expect(css).toContain(".sheet[data-state=\"open\"]:not([data-entered])");
    expect(css).toContain("animation: money-sheet-exit 220ms ease-in both");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation: none");
  });

  test("opens a full-width bottom sheet with a grabber above the title row", () => {
    render(<Harness />);
    fireEvent.click(page().getByRole("button", { name: "Open money" }));

    const dialog = page().getByRole("dialog", { name: "Send" }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);

    const sheet = dialog.querySelector("[data-money-sheet]");
    expect(sheet).toBeTruthy();
    expect((sheet as HTMLElement).dataset.state).toBe("open");

    const grabber = dialog.querySelector("[data-money-sheet-grabber]");
    const title = page().getByRole("heading", { name: "Send" });
    expect(grabber).toBeInstanceOf(HTMLElement);
    expect(
      (grabber as HTMLElement).compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("dismisses from × and restores the trigger", async () => {
    const restoreMotion = stubReducedMotion(true);
    try {
      render(<Harness />);
      const trigger = page().getByRole("button", { name: "Open money" });
      trigger.focus();
      fireEvent.click(trigger);
      fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
      expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      restoreMotion();
    }
  });

  test("dismisses from a backdrop tap", async () => {
    render(<Harness startOpen />);
    const dialog = page().getByRole("dialog", { name: "Send" });
    fireEvent.click(dialog);
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Send" })).toBeNull());
  });

  test("keeps an inside sheet tap open", () => {
    render(<Harness startOpen />);
    fireEvent.click(page().getByRole("heading", { name: "Send" }));
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
  });

  test("drag-down on the grabber dismisses", async () => {
    render(<Harness startOpen />);
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    expect(grabber).toBeTruthy();

    await act(async () => {
      fireEvent.pointerDown(grabber!, { pointerId: 1, button: 0, clientY: 40 });
      fireEvent.pointerMove(grabber!, { pointerId: 1, clientY: 40 + MONEY_SHEET_DISMISS_PX + 8 });
      fireEvent.pointerUp(grabber!, { pointerId: 1, clientY: 40 + MONEY_SHEET_DISMISS_PX + 8 });
    });

    await waitFor(() => expect(page().queryByRole("dialog", { name: "Send" })).toBeNull());
  });

  test("a short grabber drag keeps the sheet open", () => {
    render(<Harness startOpen />);
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    fireEvent.pointerDown(grabber!, { pointerId: 1, button: 0, clientY: 40 });
    fireEvent.pointerMove(grabber!, { pointerId: 1, clientY: 52 });
    fireEvent.pointerUp(grabber!, { pointerId: 1, clientY: 52 });
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
  });

  test("reduced motion closes without the exit delay", () => {
    const restoreMotion = stubReducedMotion(true);
    try {
      render(<Harness startOpen />);
      fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
      expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
    } finally {
      restoreMotion();
    }
  });
});

function stubReducedMotion(enabled: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: enabled && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
