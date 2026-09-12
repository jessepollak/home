import "@/client/account/dom-test-harness";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useState } from "react";

const { act, cleanup, createEvent, fireEvent, render, within } = await import("@testing-library/react");

const animationFrames: FrameRequestCallback[] = [];
const realRequestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
  animationFrames.push(callback);
  return animationFrames.length;
}) as typeof requestAnimationFrame;
const { MotionGlobalConfig } = await import("motion/react");
const {
  MONEY_SHEET_DISMISS_FRACTION,
  MONEY_SHEET_DISMISS_PROJECTION_MS,
  MoneyModal,
  MoneyModalFooter,
  MoneyModalHeader,
  resolveSheetDragDismiss,
} = await import("./money-modal");
globalThis.requestAnimationFrame = realRequestAnimationFrame;

function page() {
  return within(document.body);
}

function dismissDistance() {
  // happy-dom reports no layout height for the sheet, so the module falls back
  // to window.innerHeight. Express gestures against the same proportional base
  // so the tests stay proportional rather than hard-coding pixels.
  return window.innerHeight * MONEY_SHEET_DISMISS_FRACTION;
}

async function flushSheetAnimation() {
  await act(async () => {
    while (animationFrames.length > 0) {
      const callbacks = animationFrames.splice(0);
      for (const callback of callbacks) callback(performance.now());
    }
  });
}

type TimedPointerEvent =
  | "lostPointerCapture"
  | "pointerCancel"
  | "pointerDown"
  | "pointerMove"
  | "pointerUp";

async function fireTimedPointerEvent(
  target: Element,
  type: TimedPointerEvent,
  timeStamp: number,
  init: Record<string, unknown>,
) {
  const event = createEvent[type](target, init);
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  await act(async () => {
    fireEvent(target, event);
  });
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

function ExternalCloseHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>
        Close externally
      </button>
      <MoneyModal
        open={open}
        labelledBy="external-sheet-title"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <MoneyModalHeader
          title="External"
          titleId="external-sheet-title"
          onClose={() => setOpen(false)}
          closeLabel="Close external dialog"
        />
        <div>External body</div>
      </MoneyModal>
    </>
  );
}

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(async () => {
  await flushSheetAnimation();
  cleanup();
  MotionGlobalConfig.skipAnimations = false;
});

describe("MoneyModal shell", () => {
  test("enter uses one transform spring without a competing height writer", () => {
    const restoreMotion = stubReducedMotion(false);
    try {
      render(<Harness />);
      fireEvent.click(page().getByRole("button", { name: "Open money" }));
      const sheet = document.querySelector("dialog[open] [data-money-sheet]") as HTMLElement;
      expect(sheet.style.transform).toBe(`translate3d(0, ${window.innerHeight}px, 0)`);
      expect(sheet.style.height).toBe("");
      expect(sheet.style.clipPath).toBe("");
      expect(sheet.dataset.positionOwner).toBe("opening");
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
    await flushSheetAnimation();
    const dialog = page().getByRole("dialog", { name: "Send" });
    fireEvent.click(dialog);
    await flushSheetAnimation();
    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
  });

  test("keeps an inside sheet tap open", () => {
    render(<Harness startOpen />);
    fireEvent.click(page().getByRole("heading", { name: "Send" }));
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
  });

  test("drag-down past the proportional threshold dismisses", async () => {
    render(<Harness startOpen />);
    await flushSheetAnimation();
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    expect(grabber).toBeTruthy();
    const distance = dismissDistance() + 24;

    await fireTimedPointerEvent(
      grabber!,
      "pointerDown",
      100,
      { pointerId: 1, button: 0, clientY: 40 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      110,
      { pointerId: 1, clientY: 40 + distance },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerUp",
      230,
      { pointerId: 1, clientY: 40 + distance },
    );

    await flushSheetAnimation();
    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
  });

  test("commits an accepted drag dismissal before the closing spring starts", async () => {
    const snapshots: Array<{
      owner: string | undefined;
      state: string | undefined;
      transform: string;
    }> = [];

    function CommitHarness() {
      const [open, setOpen] = useState(true);
      return (
        <MoneyModal
          open={open}
          labelledBy="commit-title"
          onCancel={() => {
            const sheet = document.getElementById("commit-title")
              ?.closest<HTMLElement>("[data-money-sheet]");
            snapshots.push({
              owner: sheet?.dataset.positionOwner,
              state: sheet?.dataset.state,
              transform: sheet?.style.transform ?? "",
            });
            setOpen(false);
          }}
          onClose={() => {}}
        >
          <h2 id="commit-title">Commit</h2>
        </MoneyModal>
      );
    }

    render(<CommitHarness />);
    await flushSheetAnimation();
    const sheet = document.getElementById("commit-title")
      ?.closest<HTMLElement>("[data-money-sheet]") as HTMLElement;
    const grabber = sheet.querySelector("[data-money-sheet-grabber]");
    const distance = dismissDistance() + 24;

    await fireTimedPointerEvent(
      grabber!,
      "pointerDown",
      100,
      { pointerId: 1, button: 0, clientY: 40 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      110,
      { pointerId: 1, clientY: 40 + distance },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerUp",
      230,
      { pointerId: 1, clientY: 40 + distance },
    );

    expect(snapshots).toEqual([{
      owner: "pending-close",
      state: "open",
      transform: `translate3d(0, ${distance}px, 0)`,
    }]);
  });

  test("an upward throw already at the top does not start a rebound writer", async () => {
    render(<Harness startOpen />);
    await flushSheetAnimation();
    const sheet = document.querySelector("dialog[open] [data-money-sheet]") as HTMLElement;
    const grabber = sheet.querySelector("[data-money-sheet-grabber]");

    await fireTimedPointerEvent(
      grabber!,
      "pointerDown",
      100,
      { pointerId: 1, button: 0, clientY: 80 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      120,
      { pointerId: 1, clientY: 20 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerUp",
      120,
      { pointerId: 1, clientY: 20 },
    );

    expect(sheet.dataset.positionOwner).toBe("idle");
    expect(sheet.style.transform).toBe("translate3d(0, 0px, 0)");
    await flushSheetAnimation();
    expect(sheet.style.transform).toBe("translate3d(0, 0px, 0)");
  });

  test("a short proportional grabber drag keeps the sheet open", async () => {
    render(<Harness startOpen />);
    await flushSheetAnimation();
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    await fireTimedPointerEvent(
      grabber!,
      "pointerDown",
      100,
      { pointerId: 1, button: 0, clientY: 40 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      160,
      { pointerId: 1, clientY: 70 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerUp",
      160,
      { pointerId: 1, clientY: 70 },
    );
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
  });

  test("a grabber flick dismisses through the projected destination", async () => {
    render(<Harness startOpen />);
    await flushSheetAnimation();
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    await fireTimedPointerEvent(
      grabber!,
      "pointerDown",
      100,
      { pointerId: 1, button: 0, clientY: 40 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      140,
      { pointerId: 1, clientY: 88 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerUp",
      140,
      { pointerId: 1, clientY: 88 },
    );
    await flushSheetAnimation();
    expect(page().queryByRole("dialog", { name: "Send" })).toBeNull();
  });

  test("ages out flick velocity while the pointer is held still", async () => {
    render(<Harness startOpen />);
    await flushSheetAnimation();
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    await fireTimedPointerEvent(
      grabber!,
      "pointerDown",
      100,
      { pointerId: 1, button: 0, clientY: 40 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      140,
      { pointerId: 1, clientY: 88 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerUp",
      260,
      { pointerId: 1, clientY: 88 },
    );
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
  });

  test("down-pause-up reopens even after clearing the proportional threshold", async () => {
    render(<Harness startOpen />);
    await flushSheetAnimation();
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    const downY = 40 + dismissDistance() + 40;
    const upY = 40 + dismissDistance() + 30;

    await fireTimedPointerEvent(
      grabber!,
      "pointerDown",
      100,
      { pointerId: 1, button: 0, clientY: 40 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      110,
      { pointerId: 1, clientY: downY },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      230,
      { pointerId: 1, clientY: upY },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerUp",
      230,
      { pointerId: 1, clientY: upY },
    );

    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
    await flushSheetAnimation();
    expect((document.querySelector("[data-money-sheet]") as HTMLElement).style.transform)
      .toBe("translate3d(0, 0px, 0)");
  });

  test("pointer cancel never dismisses and springs back to open", async () => {
    render(<Harness startOpen />);
    await flushSheetAnimation();
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    const distance = dismissDistance() + 24;
    await fireTimedPointerEvent(
      grabber!,
      "pointerDown",
      100,
      { pointerId: 1, button: 0, clientY: 40 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      110,
      { pointerId: 1, clientY: 40 + distance },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerCancel",
      110,
      { pointerId: 1, clientY: 40 + distance },
    );
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();

    await flushSheetAnimation();
    expect((document.querySelector("[data-money-sheet]") as HTMLElement).style.transform)
      .toBe("translate3d(0, 0px, 0)");
  });

  test("lost pointer capture never dismisses", async () => {
    render(<Harness startOpen />);
    await flushSheetAnimation();
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    const distance = dismissDistance() + 24;
    await fireTimedPointerEvent(
      grabber!,
      "pointerDown",
      100,
      { pointerId: 1, button: 0, clientY: 40 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      110,
      { pointerId: 1, clientY: 40 + distance },
    );
    await fireTimedPointerEvent(
      grabber!,
      "lostPointerCapture",
      110,
      { pointerId: 1, clientY: 40 + distance },
    );
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();

    await flushSheetAnimation();
    expect((document.querySelector("[data-money-sheet]") as HTMLElement).style.transform)
      .toBe("translate3d(0, 0px, 0)");
  });

  test("external open=false during an upward drag keeps closing and unlocks scroll", async () => {
    const restoreMotion = stubReducedMotion(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "auto";
    try {
      render(<ExternalCloseHarness />);
      await flushSheetAnimation();
      expect(document.body.style.overflow).toBe("hidden");

      const grabber = document.querySelector("[data-money-sheet-grabber]");
      expect(grabber).toBeTruthy();
      await fireTimedPointerEvent(
        grabber!,
        "pointerDown",
        100,
        { pointerId: 1, button: 0, clientY: 160 },
      );
      await fireTimedPointerEvent(
        grabber!,
        "pointerMove",
        140,
        { pointerId: 1, clientY: 120 },
      );
      fireEvent.click(page().getByRole("button", { name: "Close externally" }));
      await fireTimedPointerEvent(
        grabber!,
        "pointerUp",
        140,
        { pointerId: 1, clientY: 120 },
      );

      await flushSheetAnimation();
      expect(document.querySelector("dialog[open]")).toBeNull();
      expect(document.body.style.overflow).toBe("auto");
    } finally {
      document.body.style.overflow = previousOverflow;
      restoreMotion();
    }
  });

  test("projects the dismissal destination proportionally to sheet height", () => {
    expect(resolveSheetDragDismiss(0, 0, 800)).toBe(false);
    expect(resolveSheetDragDismiss(200, 0, 800)).toBe(true);
    expect(resolveSheetDragDismiss(200, 0, 1000)).toBe(false);
    expect(resolveSheetDragDismiss(160, 0.4, 800)).toBe(true);
    expect(resolveSheetDragDismiss(160, -0.1, 800)).toBe(false);
    expect(MONEY_SHEET_DISMISS_FRACTION).toBeGreaterThan(0);
    expect(MONEY_SHEET_DISMISS_FRACTION).toBeLessThan(1);
    expect(MONEY_SHEET_DISMISS_PROJECTION_MS).toBeGreaterThan(0);
  });

  test("returns a rejected dismissal to the open position", async () => {
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
    await flushSheetAnimation();
    const grabber = document.querySelector("[data-money-sheet-grabber]");
    const distance = dismissDistance() + 24;
    await fireTimedPointerEvent(
      grabber!,
      "pointerDown",
      100,
      { pointerId: 1, button: 0, clientY: 40 },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerMove",
      110,
      { pointerId: 1, clientY: 40 + distance },
    );
    await fireTimedPointerEvent(
      grabber!,
      "pointerUp",
      110,
      { pointerId: 1, clientY: 40 + distance },
    );
    expect(page().getByRole("dialog", { name: "Blocked" })).toBeTruthy();

    await flushSheetAnimation();
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
      await flushSheetAnimation();
      fireEvent.click(page().getByRole("button", { name: "Close" }));
      const dialog = document.querySelector("dialog") as HTMLDialogElement;
      const sheet = document.querySelector("[data-money-sheet]") as HTMLElement;
      expect(page().getByText("Composed amount: 13")).toBeTruthy();
      expect(page().queryByText("Reset amount: 0")).toBeNull();
      expect(sheet.inert).toBe(true);
      expect(document.activeElement).toBe(dialog);
      await flushSheetAnimation();
      expect(dialog.open).toBe(false);
    } finally {
      restoreMotion();
    }
  });

  test("can reopen during exit without collapsing retained flow content", async () => {
    const restoreMotion = stubReducedMotion(false);
    try {
      render(<Harness startOpen />);
      await act(async () => {
        fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
        fireEvent.click(page().getByRole("button", { name: "Open money" }));
      });
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
      await flushSheetAnimation();
      expect(document.body.style.overflow).toBe("hidden");
      fireEvent.click(page().getByRole("button", { name: "Close send dialog" }));
      expect(document.body.style.overflow).toBe("hidden");
      await flushSheetAnimation();
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
      await flushSheetAnimation();
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.click(page().getByRole("button", { name: "Switch owner" }));
      expect(document.body.style.overflow).toBe("hidden");

      fireEvent.click(page().getByRole("button", { name: "Close add money" }));
      await flushSheetAnimation();
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
