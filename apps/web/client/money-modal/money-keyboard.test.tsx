import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { useState } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { MoneyModal, MoneyModalHeader, MoneyModalStep } = await import("./money-modal");

const KEYBOARD_HEIGHT = 300;
const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");

beforeEach(() => {
  (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = false;
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: Object.assign(new EventTarget(), { height: window.innerHeight - KEYBOARD_HEIGHT, offsetTop: 0, scale: 1, width: window.innerWidth }),
  });
});

afterEach(async () => {
  cleanup();
  if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
  else Reflect.deleteProperty(window, "visualViewport");
  await waitFor(() => expect(document.querySelector("[data-base-ui-portal]")).toBeNull());
  document.body.style.overflow = "";
  document.body.style.overflowX = "";
  document.body.style.overflowY = "";
  document.documentElement.style.scrollbarGutter = "";
});

function keyboardInset() {
  return document.querySelector<HTMLElement>("[data-slot=drawer-viewport]")?.style.getPropertyValue("--sheet-keyboard-inset") ?? null;
}

function holdExitAnimation() {
  let finish = () => {};
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [{ finished, pending: false, playState: "running" }],
  });
  return {
    finish: async () => {
      if (descriptor) Object.defineProperty(Element.prototype, "getAnimations", descriptor);
      else Reflect.deleteProperty(Element.prototype, "getAnimations");
      finish();
      await finished;
    },
  };
}

function Journey({ trigger = "button", onCancel }: { trigger?: "button" | "input"; onCancel?: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"amount" | "recipient">("amount");
  return <>
    {trigger === "input"
      ? <input aria-label="Search" onFocus={() => setOpen(true)} />
      : <button type="button" onClick={() => setOpen(true)}>Open send</button>}
    <MoneyModal open={open} labelledBy="keyboard-title" onCancel={() => { onCancel?.(); setOpen(false); }} onClose={() => setStep("amount")}>
      <MoneyModalStep step={step} depth={step === "amount" ? 0 : 1}>
        {step === "amount"
          ? <MoneyModalHeader title="Send" titleId="keyboard-title" />
          : <MoneyModalHeader title="Send" titleId="keyboard-title" onBack={() => setStep("amount")} />}
        {step === "amount"
          ? <input aria-label="Amount" data-money-amount-input inputMode="decimal" />
          : <input aria-label="To" />}
        {step === "amount" ? <button type="button" onClick={() => setStep("recipient")}>Continue</button> : null}
      </MoneyModalStep>
    </MoneyModal>
  </>;
}

describe("software keyboard and the persistent money sheet", () => {
  test("releases the keyboard inset in the same act as Continue moves focus off the amount", async () => {
    render(<Journey />);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Open send" })));
    const amount = page().getByRole("textbox", { name: "Amount" });
    expect(document.activeElement).toBe(amount);
    expect(keyboardInset()).toBe(`${KEYBOARD_HEIGHT}px`);

    await act(async () => fireEvent.click(page().getByRole("button", { name: "Continue" })));
    expect(page().getAllByRole("dialog")).toHaveLength(1);
    expect(document.activeElement).toBe(page().getByRole("button", { name: "Back" }));
    expect(keyboardInset()).toBe("0px");

    await act(async () => fireEvent.click(page().getByRole("button", { name: "Back" })));
    expect(document.activeElement).toBe(page().getByRole("textbox", { name: "Amount" }));
    expect(keyboardInset()).toBe(`${KEYBOARD_HEIGHT}px`);
  });

  test("exposes the panned visual viewport top beside the bottom inset", async () => {
    Object.assign(window.visualViewport!, { offsetTop: 100 });
    render(<Journey />);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Open send" })));
    const viewport = document.querySelector<HTMLElement>("[data-slot=drawer-viewport]")!;
    expect(viewport.style.getPropertyValue("--sheet-keyboard-top")).toBe("100px");
    expect(keyboardInset()).toBe(`${KEYBOARD_HEIGHT - 100}px`);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Continue" })));
    expect(viewport.style.getPropertyValue("--sheet-keyboard-top")).toBe("0px");
  });

  test("a blur with no next focus releases the inset synchronously and keeps the sheet open", async () => {
    render(<Journey />);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Open send" })));
    const amount = page().getByRole("textbox", { name: "Amount" });
    act(() => amount.blur());
    expect(keyboardInset()).toBe("0px");
    expect(page().getByRole("dialog", { name: "Send" })).toBeTruthy();
  });

  test("window blur retains the inset until focus returns to the input", async () => {
    render(<Journey />);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Open send" })));
    const amount = page().getByRole("textbox", { name: "Amount" });
    const focus = spyOn(document, "hasFocus").mockReturnValue(false);
    try {
      fireEvent.focusOut(amount, { relatedTarget: null });
      expect(keyboardInset()).toBe(`${KEYBOARD_HEIGHT}px`);
      Object.assign(window.visualViewport!, { height: window.innerHeight - KEYBOARD_HEIGHT + 50 });
      focus.mockReturnValue(true);
      fireEvent.focusIn(amount);
      expect(keyboardInset()).toBe(`${KEYBOARD_HEIGHT - 50}px`);
    } finally {
      focus.mockRestore();
    }
  });

  for (const field of ["Amount", "To"] as const) {
    test(`X from a focused ${field} field releases the keyboard as the exit starts and restores the trigger`, async () => {
      const cancels: number[] = [];
      render(<Journey onCancel={() => cancels.push(1)} />);
      const trigger = page().getByRole("button", { name: "Open send" });
      trigger.focus();
      await act(async () => fireEvent.click(trigger));
      if (field === "To") {
        await act(async () => fireEvent.click(page().getByRole("button", { name: "Continue" })));
        page().getByRole("textbox", { name: "To" }).focus();
      }
      const input = page().getByRole("textbox", { name: field });
      expect(document.activeElement).toBe(input);
      const exit = holdExitAnimation();
      try {
        await act(async () => fireEvent.click(page().getByRole("button", { name: "Close" })));
        expect(cancels).toHaveLength(1);
        expect(input.isConnected).toBe(true);
        expect(document.activeElement).not.toBe(input);
        expect(document.querySelector("[data-money-sheet]")?.contains(document.activeElement)).toBe(true);
        expect(keyboardInset()).toBe(`${KEYBOARD_HEIGHT}px`);
        window.visualViewport!.dispatchEvent(new Event("resize"));
        expect(keyboardInset()).toBe(`${KEYBOARD_HEIGHT}px`);
      } finally {
        await act(async () => exit.finish());
      }
      await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    });
  }

  test("a sheet without steps still parks focus inside itself while its exit releases the keyboard", async () => {
    function Plain() {
      const [open, setOpen] = useState(true);
      return <MoneyModal open={open} labelledBy="plain-title" onCancel={() => setOpen(false)} onClose={() => {}}>
        <MoneyModalHeader title="Plain" titleId="plain-title" />
        <input aria-label="Note" />
      </MoneyModal>;
    }
    render(<Plain />);
    const note = await page().findByRole("textbox", { name: "Note" });
    await act(async () => note.focus());
    const exit = holdExitAnimation();
    try {
      await act(async () => fireEvent.click(page().getByRole("button", { name: "Close" })));
      expect(document.activeElement).not.toBe(note);
      expect(document.querySelector("[data-money-sheet]")?.contains(document.activeElement)).toBe(true);
    } finally {
      await act(async () => exit.finish());
    }
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
  });

  test("a closing sheet never returns focus to a text field that would reopen the keyboard", async () => {
    render(<Journey trigger="input" />);
    const search = page().getByRole("textbox", { name: "Search" });
    await act(async () => search.focus());
    await page().findByRole("dialog", { name: "Send" });
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close" })));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(search);
  });
});
