import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createRef, useState } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { MoneyModal, MoneyModalHeader, MoneyModalStep, MoneyModalStepLoading, useMoneyModalPending } = await import("./money-modal");
const animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");

beforeEach(() => Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: undefined }));
afterEach(async () => {
  cleanup();
  if (animateDescriptor) Object.defineProperty(HTMLElement.prototype, "animate", animateDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  await waitFor(() => expect(document.querySelector("[data-base-ui-portal]")).toBeNull());
});

describe("persistent money steps", () => {
  test("navigates within one dialog and focuses amount, marked target, then explicit target", async () => {
    const explicit = createRef<HTMLInputElement>();
    function Journey() {
      const [step, setStep] = useState(0);
      return <>
        <button type="button">Outside trigger</button>
        <MoneyModal open labelledBy="journey-title" immediate onCancel={() => {}} onClose={() => {}}>
          <MoneyModalStep step={String(step)} depth={step} initialFocusRef={step === 3 ? explicit : undefined}>
            <h2 id="journey-title">Journey</h2>
            <button type="button" onClick={() => setStep(step + 1)}>Next</button>
            {step === 1 ? <input aria-label="Amount" data-money-amount-input /> : null}
            {step === 2 ? <button type="button" data-initial-focus>Marked target</button> : null}
            {step === 3 ? <input aria-label="Explicit target" ref={explicit} /> : null}
          </MoneyModalStep>
        </MoneyModal>
      </>;
    }
    const { container } = render(<Journey />);
    const outside = container.querySelector("button");
    for (const name of ["Amount", "Marked target", "Explicit target"]) {
      await act(async () => fireEvent.click(page().getByRole("button", { name: "Next" })));
      expect(page().getAllByRole("dialog")).toHaveLength(1);
      const target = name === "Marked target" ? page().getByRole("button", { name }) : page().getByRole("textbox", { name });
      expect(document.activeElement).toBe(target);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).not.toBe(outside);
    }
  });

  test("opening focuses the first amount input in the same act as the trigger click", async () => {
    function Journey() {
      const [open, setOpen] = useState(false);
      return <><button type="button" onClick={() => setOpen(true)}>Open amount</button>
        <MoneyModal open={open} labelledBy="amount-title" immediate onCancel={() => setOpen(false)} onClose={() => {}}>
          <MoneyModalStep step="amount"><h2 id="amount-title">Amount</h2><input aria-label="Amount" data-money-amount-input /></MoneyModalStep>
        </MoneyModal></>;
    }
    render(<Journey />);
    await act(async () => {
      fireEvent.click(page().getByRole("button", { name: "Open amount" }));
      await Promise.resolve();
    });
    expect(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.getAttribute("data-slot") ?? document.activeElement?.tagName).toBe("Amount");
  });

  test("deliberate blur stays blurred through a same-key report", () => {
    function Journey() {
      const [version, setVersion] = useState(0);
      return <MoneyModal open labelledBy="blur-title" immediate onCancel={() => {}} onClose={() => {}}>
        <MoneyModalStep step="amount" depth={version}>
          <h2 id="blur-title">Amount</h2><input aria-label="Amount" data-money-amount-input />
          <output aria-label="Version">{version}</output>
        </MoneyModalStep>
        <button type="button" onClick={() => setVersion(version + 1)}>Refresh</button>
      </MoneyModal>;
    }
    render(<Journey />);
    const amount = page().getByRole("textbox", { name: "Amount" });
    amount.focus();
    expect(document.activeElement === amount).toBe(true);
    act(() => amount.blur());
    expect(document.activeElement === amount).toBe(false);
    fireEvent.click(page().getByRole("button", { name: "Refresh" }));
    expect(page().getByLabelText("Version").textContent).toBe("1");
    expect(document.activeElement === amount).toBe(false);
  });

  test("pending review recovery focuses Back instead of an aliased amount input", () => {
    function Journey({ pending }: { pending: boolean }) {
      return <MoneyModal open labelledBy="review-title" immediate pending={pending} onCancel={() => {}} onClose={() => {}}>
        <MoneyModalStep step="review" initialFocusRef={createRef<HTMLElement>()}>
          <MoneyModalHeader title="Review" titleId="review-title" onBack={() => {}} />
          {pending ? <input aria-label="Amount" data-money-amount-input /> : <p>Review ready</p>}
        </MoneyModalStep>
      </MoneyModal>;
    }
    const view = render(<Journey pending />);
    const parked = document.querySelector<HTMLElement>("[data-money-step=review]")!;
    parked.focus();
    expect(document.activeElement).toBe(parked);
    view.rerender(<Journey pending={false} />);
    expect(document.activeElement).toBe(page().getByRole("button", { name: "Back" }));
  });

  test("header X at depth C exits the whole journey without stepping Back", async () => {
    const onBack = mock(() => {});
    const onCancel = mock(() => {});
    function Journey() {
      const [depth, setDepth] = useState(0);
      const [open, setOpen] = useState(true);
      return <MoneyModal open={open} labelledBy="depth-title" immediate onCancel={() => { onCancel(); setOpen(false); }} onClose={() => {}}>
        <MoneyModalStep step={String(depth)} depth={depth}>
          <MoneyModalHeader title={["A", "B", "C"][depth]!} titleId="depth-title" onBack={depth ? onBack : undefined} />
          {depth < 2 ? <button type="button" onClick={() => setDepth(depth + 1)}>Next</button> : null}
        </MoneyModalStep>
      </MoneyModal>;
    }
    render(<Journey />);
    fireEvent.click(page().getByRole("button", { name: "Next" }));
    fireEvent.click(page().getByRole("button", { name: "Next" }));
    expect(page().getByRole("dialog", { name: "C" })).toBeTruthy();
    fireEvent.click(page().getByRole("button", { name: "Close" }));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  test("same key replacement recovers focus after the focused control disappears", async () => {
    function Journey() {
      const [version, setVersion] = useState(0);
      return <MoneyModal open labelledBy="same-title" immediate onCancel={() => {}} onClose={() => {}}>
        <MoneyModalStep key={version} step="same">
          <h2 id="same-title">Same screen</h2>
          <button type="button" onClick={() => setVersion(version + 1)}>Replace</button>
          <input aria-label="Replacement target" data-money-amount-input />
        </MoneyModalStep>
      </MoneyModal>;
    }
    render(<Journey />);
    const replace = page().getByRole("button", { name: "Replace" });
    replace.focus();
    await act(async () => fireEvent.click(replace));
    expect(document.activeElement).toBe(page().getByRole("textbox", { name: "Replacement target" }));
  });

  test("same key report does not steal focus from another inside control", async () => {
    function Journey() {
      const [version, setVersion] = useState(0);
      return <MoneyModal open labelledBy="same-title" immediate onCancel={() => {}} onClose={() => {}}>
        <MoneyModalStep step="same" depth={version}><h2 id="same-title">Same screen</h2>
          <button type="button" onClick={() => setVersion(version + 1)}>Inside control</button>
          <input aria-label="Amount" data-money-amount-input />
          <output aria-label="Version">{version}</output>
        </MoneyModalStep>
      </MoneyModal>;
    }
    render(<Journey />);
    page().getByRole("textbox", { name: "Amount" }).focus();
    const inside = page().getByRole("button", { name: "Inside control" });
    inside.focus();
    await act(async () => fireEvent.click(inside));
    expect(page().getByLabelText("Version").textContent).toBe("1");
    expect(document.activeElement === page().getByRole("button", { name: "Inside control" })).toBe(true);
  }, 30_000);

  test("content pending blocks dismissal until its registrar unmounts", async () => {
    const events: string[] = [];
    function Pending() {
      useMoneyModalPending(true);
      return <span>Working</span>;
    }
    function Journey() {
      const [busy, setBusy] = useState(true);
      return <MoneyModal open labelledBy="pending-title" immediate onCancel={() => { events.push("cancel"); }} onClose={() => {}}>
        <MoneyModalHeader title="Pending" titleId="pending-title" />
        {busy ? <Pending /> : null}
        <button type="button" onClick={() => setBusy(false)}>Finish work</button>
      </MoneyModal>;
    }
    render(<Journey />);
    expect(page().getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(true);
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    expect(events).toEqual([]);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Finish work" })));
    expect(page().getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(false);
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    expect(events).toEqual(["cancel"]);
  });

  test("loading step keeps one dialog and replaces skeleton with retry", () => {
    const retry = () => {};
    const view = render(<MoneyModal open labelledBy="load-title" immediate onCancel={() => {}} onClose={() => {}}><MoneyModalStepLoading step="load" title="Loading step" titleId="load-title" closeLabel="Close" failed={false} onRetry={retry} /></MoneyModal>);
    expect(page().getAllByRole("dialog")).toHaveLength(1);
    expect(page().getByText("Loading").closest("[aria-busy=true]")).toBeTruthy();
    view.rerender(<MoneyModal open labelledBy="load-title" immediate onCancel={() => {}} onClose={() => {}}><MoneyModalStepLoading step="load" title="Loading step" titleId="load-title" closeLabel="Close" failed onRetry={retry} /></MoneyModal>);
    expect(page().getByText("Couldn't load this step")).toBeTruthy();
    expect(page().getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
