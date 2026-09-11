import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const {
  MONEY_SHEET_DISMISS_PX,
  MONEY_SHEET_EXIT_MS,
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
} = await import("./money-modal");

const css = readFileSync(resolve(import.meta.dir, "money-modal.module.css"), "utf8");

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

function page() {
  return within(document.body);
}

function Harness({
  startOpen = false,
  immediate = false,
}: {
  startOpen?: boolean;
  immediate?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open money
      </button>
      <MoneyModal
        open={open}
        labelledBy="money-sheet-title"
        immediate={immediate}
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

async function flushSheetExit() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, MONEY_SHEET_EXIT_MS + 20));
  });
}

describe("MoneyModal shell", () => {
  test("locks Direction 2 sheet chrome", () => {
    expect(css).toContain("width: 100%");
    expect(css).toContain("max-height: 88svh");
    expect(css).toContain("border-radius: 16px 16px 0 0");
    expect(css).toContain("box-shadow: 0 -8px 28px rgba(10, 11, 13, 0.18)");
    expect(css).toContain("width: 36px");
    expect(css).toContain("height: 4px");
    expect(css).toContain("position: absolute");
    expect(css).toContain("bottom: 0");
    expect(css).toContain("left: 0");
    expect(css).toContain("right: 0");
    expect(css).toContain("min-height: 0");
    expect(css).toContain("will-change: height, transform");
    expect(css).toContain("height: 0");
    expect(css).not.toContain("clip-path: inset(100% 0 0 0");
    expect(css).not.toContain("transform: translate3d(0, 100%, 0)");
    expect(css).not.toContain("align-items: end");
    expect(css).not.toContain("animation: money-sheet-enter");
    expect(css).not.toContain("animation: money-sheet-exit");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation: none");
  });

  test("locks reversible backdrop continuity", () => {
    const root = cssRule(".root");
    expect(root).toContain("background-color: rgba(10, 11, 13, 0)");
    expect(root).toContain("transition: background-color 220ms ease-in");

    const open = cssRule('.root[data-state="open"]');
    expect(open).toContain("background-color: rgba(10, 11, 13, 0.42)");
    expect(open).toContain("transition-duration: 280ms");
    expect(open).toContain("transition-timing-function: ease-out");

    const closing = cssRule('.root[data-state="closing"]');
    expect(closing).toContain("background-color: rgba(10, 11, 13, 0)");

    const startingStyle = cssRule("@starting-style");
    expect(startingStyle).toContain('.root[data-state="open"]');
    expect(startingStyle).toContain("background-color: rgba(10, 11, 13, 0)");

    expect(css).not.toContain("@keyframes money-overlay-enter");
    expect(css).not.toContain("@keyframes money-overlay-exit");
    expect(css).not.toContain("animation: money-overlay-enter");
    expect(css).not.toContain("animation: money-overlay-exit");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.root\[data-state="open"\],[\s\S]*?\.root\[data-state="closing"\]\s*\{\s*transition: none;/,
    );
  });

  test("enter grows height from the pinned bottom without translating the sheet", () => {
    const restoreMotion = stubReducedMotion(false);
    try {
      render(<Harness />);
      fireEvent.click(page().getByRole("button", { name: "Open money" }));
      const sheet = document.querySelector("[data-money-sheet]") as HTMLElement;
      expect(sheet.style.transform).toBe("translate3d(0, 0px, 0)");
      expect(sheet.style.height === "0px" || /^\d+(\.\d+)?px$/.test(sheet.style.height)).toBe(true);
      expect(sheet.style.clipPath).toBe("");
    } finally {
      restoreMotion();
    }
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
    await flushSheetExit();
    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
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

    await flushSheetExit();
    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
  });

  test("a short grabber drag keeps the sheet open", () => {
    render(<Harness startOpen />);
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    fireEvent.pointerDown(grabber!, { pointerId: 1, button: 0, clientY: 40 });
    fireEvent.pointerMove(grabber!, { pointerId: 1, clientY: 52 });
    fireEvent.pointerUp(grabber!, { pointerId: 1, clientY: 52 });
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
  });

  test("a grabber flick dismisses before the distance threshold", async () => {
    render(<Harness startOpen />);
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    await act(async () => {
      fireEvent.pointerDown(grabber!, { pointerId: 1, button: 0, clientY: 40, timeStamp: 1000 });
      fireEvent.pointerMove(grabber!, { pointerId: 1, clientY: 72, timeStamp: 1040 });
      fireEvent.pointerUp(grabber!, { pointerId: 1, clientY: 72, timeStamp: 1040 });
    });
    await flushSheetExit();
    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
  });

  test("ages out flick velocity while the pointer is held still", async () => {
    render(<Harness startOpen />);
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    fireEvent.pointerDown(grabber!, { pointerId: 1, button: 0, clientY: 40 });
    fireEvent.pointerMove(grabber!, { pointerId: 1, clientY: 72 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    fireEvent.pointerUp(grabber!, { pointerId: 1, clientY: 72 });
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
  });

  test("returns a rejected dismissal to the open position", () => {
    render(
      <MoneyModal
        open
        labelledBy="blocked-title"
        onCancel={() => false}
        onClose={() => {}}
      >
        <h2 id="blocked-title">Blocked</h2>
      </MoneyModal>,
    );
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    fireEvent.pointerDown(grabber!, { pointerId: 1, button: 0, clientY: 40 });
    fireEvent.pointerMove(grabber!, { pointerId: 1, clientY: 40 + MONEY_SHEET_DISMISS_PX + 8 });
    fireEvent.pointerUp(grabber!, { pointerId: 1, clientY: 40 + MONEY_SHEET_DISMISS_PX + 8 });
    expect(page().getByRole("dialog", { name: "Blocked" })).toBeTruthy();
    expect((document.querySelector("[data-money-sheet]") as HTMLElement).style.transform)
      .toBe("translate3d(0, 0px, 0)");
  });

  test("keeps a noninteractive outgoing presentation through the exit animation", async () => {
    const restoreMotion = stubReducedMotion(false);
    function ResettingHarness() {
      const [open, setOpen] = useState(true);
      const [content, setContent] = useState("Composed amount: 13");
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open reset sheet</button>
          <MoneyModal
            open={open}
            labelledBy="reset-sheet-title"
            onCancel={() => {
              setContent("Reset amount: 0");
              setOpen(false);
            }}
            onClose={() => {}}
          >
            <MoneyModalHeader
              title="Send"
              titleId="reset-sheet-title"
              onClose={() => {
                setContent("Reset amount: 0");
                setOpen(false);
              }}
            />
            <p>{content}</p>
          </MoneyModal>
        </>
      );
    }
    try {
      render(<ResettingHarness />);
      fireEvent.click(page().getByRole("button", { name: "Close" }));
      const dialog = document.querySelector("dialog") as HTMLDialogElement;
      const sheet = document.querySelector("[data-money-sheet]") as HTMLElement;
      expect(page().getByText("Composed amount: 13")).toBeTruthy();
      expect(page().queryByText("Reset amount: 0")).toBeNull();
      expect(sheet.inert).toBe(true);
      expect(document.activeElement).toBe(dialog);
      await flushSheetExit();
      expect(dialog.open).toBe(false);
    } finally {
      restoreMotion();
    }
  });

  test("can reopen during exit without collapsing retained flow content", () => {
    const restoreMotion = stubReducedMotion(false);
    try {
      render(<Harness startOpen />);
      fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
      fireEvent.click(page().getByRole("button", { name: "Open money" }));
      expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
      expect(page().getByText("Amount body")).toBeTruthy();
    } finally {
      restoreMotion();
    }
  });

  test("does not restore overflow for a lock it never owned", () => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "clip";
    try {
      render(<Harness />);
      expect(document.body.style.overflow).toBe("clip");
    } finally {
      document.body.style.overflow = previousOverflow;
    }
  });

  test("restores the existing page scroll style after animated dismissal", async () => {
    const restoreMotion = stubReducedMotion(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "auto";
    try {
      render(<Harness startOpen />);
      expect(document.body.style.overflow).toBe("hidden");
      fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
      expect(document.body.style.overflow).toBe("hidden");
      await flushSheetExit();
      expect(document.body.style.overflow).toBe("auto");
    } finally {
      document.body.style.overflow = previousOverflow;
      restoreMotion();
    }
  });

  test("keeps one shared scroll lock across an open keyed remount", async () => {
    const restoreMotion = stubReducedMotion(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "auto";

    function KeyedHarness() {
      const [owner, setOwner] = useState("owner-a");
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOwner("owner-b")}>Switch owner</button>
          <MoneyModal
            key={owner}
            open={open}
            labelledBy="keyed-sheet-title"
            onCancel={() => setOpen(false)}
            onClose={() => setOpen(false)}
          >
            <MoneyModalHeader
              title="Add money"
              titleId="keyed-sheet-title"
              onClose={() => setOpen(false)}
              closeLabel="Close add money"
            />
          </MoneyModal>
        </>
      );
    }

    try {
      render(<KeyedHarness />);
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.click(page().getByRole("button", { name: "Switch owner" }));
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.click(page().getByRole("button", { name: "Close add money" }));
      await flushSheetExit();
      expect(document.body.style.overflow).toBe("auto");
    } finally {
      document.body.style.overflow = previousOverflow;
      restoreMotion();
    }
  });

  test("immediate close drops content without the exit delay", () => {
    const restoreMotion = stubReducedMotion(false);
    try {
      render(<Harness startOpen immediate />);
      fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
      expect(document.getElementById("money-sheet-title")).toBeNull();
      expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
    } finally {
      restoreMotion();
    }
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
