import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { AppDrawer, MoneyModal, MoneyModalHeader } = await import("./money-modal");

afterEach(async () => {
  cleanup();
  await waitFor(() => expect(document.querySelector("[data-base-ui-portal]")).toBeNull());
  await waitFor(() => expect(document.body.style.overflowY).toBe(""));
  document.body.style.overflow = "";
  document.body.style.overflowX = "";
  document.body.style.overflowY = "";
  document.documentElement.style.scrollbarGutter = "";
});

describe("MoneyModal layout contract", () => {
  test("keeps the asset control in the leading track while Close owns initial focus", () => {
    render(
      <MoneyModal open labelledBy="layout-title" immediate onCancel={() => {}} onClose={() => {}}>
        <MoneyModalHeader
          title="A deliberately long centered title"
          titleId="layout-title"
          assetControl={<input aria-label="Asset" />}
        />
      </MoneyModal>,
    );

    expect(page().getByLabelText("Asset")).toBeTruthy();
    expect(document.querySelectorAll("[data-initial-focus]")).toHaveLength(1);
    expect(page().getByRole("button", { name: "Close" }).hasAttribute("data-initial-focus")).toBe(true);
  });

  test("stays open when the amount blurs under a software keyboard and closes with one header click", async () => {
    const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight - 300,
      offsetTop: 0,
      scale: 1,
      width: window.innerWidth,
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    const events: string[] = [];

    function Harness() {
      const [open, setOpen] = useState(false);
      const cancel = () => { events.push("cancel"); setOpen(false); };
      return <>
        <button type="button" onClick={() => setOpen(true)}>Open drawer</button>
        <MoneyModal open={open} labelledBy="keyboard-title" immediate onCancel={cancel} onClose={() => events.push("close")}>
          <MoneyModalHeader title="Keyboard" titleId="keyboard-title" />
          <input aria-label="Amount" data-money-amount-input />
        </MoneyModal>
      </>;
    }

    try {
      render(<Harness />);
      await act(async () => fireEvent.click(page().getByRole("button", { name: "Open drawer" })));
      const amount = await page().findByRole("textbox", { name: "Amount" });
      const close = page().getByRole("button", { name: "Close" });
      amount.focus();
      await waitFor(() => expect(document.activeElement).toBe(amount));
      close.focus();
      expect(document.activeElement).toBe(close);
      expect(page().getByRole("dialog", { name: "Keyboard" })).toBeTruthy();
      await act(async () => fireEvent.click(close));
      await waitFor(() => expect(page().queryByRole("dialog", { name: "Keyboard" })).toBeNull());
      expect(events).toEqual(["cancel", "close"]);
    } finally {
      if (originalViewport) Object.defineProperty(window, "visualViewport", originalViewport);
      else Reflect.deleteProperty(window, "visualViewport");
    }
  });

  test("focuses the enabled amount input before a fallback focus target", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open drawer</button>
          <MoneyModal open={open} labelledBy="amount-title" immediate onCancel={() => setOpen(false)} onClose={() => {}}>
            <h2 id="amount-title">Enter amount</h2>
            <button type="button" data-initial-focus>Fallback focus</button>
            <input aria-label="Amount" data-money-amount-input />
          </MoneyModal>
        </>
      );
    }

    render(<Harness />);
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Open drawer" })));
    const amount = await page().findByRole("textbox", { name: "Amount" });
    await waitFor(() => expect(document.activeElement === amount).toBe(true));
  });

  test("keeps the entered amount and the same input when the viewport crosses the desktop breakpoint", async () => {
    render(
      <MoneyModal open labelledBy="resize-title" immediate onCancel={() => {}} onClose={() => {}}>
        <h2 id="resize-title">Send</h2>
        <input aria-label="Amount" data-money-amount-input />
      </MoneyModal>,
    );
    const amount = page().getByRole("textbox", { name: "Amount" });
    fireEvent.change(amount, { target: { value: "25.50" } });
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(page().getByRole("textbox", { name: "Amount" })).toBe(amount);
    expect((amount as HTMLInputElement).value).toBe("25.50");
  });

  test("only money dialogs ignore swipe dismissal at the lg breakpoint", () => {
    const originalMatchMedia = window.matchMedia;
    let desktop = true;
    window.matchMedia = ((query: string) => ({ matches: query === "(min-width: 64rem)" && desktop, media: query })) as typeof window.matchMedia;
    try {
      const money = render(<MoneyModal open labelledBy="money-title" immediate onCancel={() => {}} onClose={() => {}}><h2 id="money-title">Send</h2></MoneyModal>);
      const moneyDialog = page().getByRole("dialog", { name: "Send" });
      fireEvent.pointerDown(moneyDialog);
      expect(moneyDialog.hasAttribute("data-base-ui-swipe-ignore")).toBe(true);
      desktop = false;
      fireEvent.pointerDown(moneyDialog);
      expect(moneyDialog.hasAttribute("data-base-ui-swipe-ignore")).toBe(false);
      money.unmount();

      desktop = true;
      render(<AppDrawer open labelledBy="sheet-title" immediate onCancel={() => {}}><h2 id="sheet-title">Sign in</h2></AppDrawer>);
      const sheetDialog = page().getByRole("dialog", { name: "Sign in" });
      fireEvent.pointerDown(sheetDialog);
      expect(sheetDialog.hasAttribute("data-base-ui-swipe-ignore")).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});

describe("MoneyModal dismissal contract", () => {
  test("returns focus to the external trigger after header Close", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [opener, setOpener] = useState<HTMLElement | null>(null);
      return <>
        <button type="button" onClick={(event) => { setOpener(event.currentTarget); setOpen(true); }}>Open drawer</button>
        <MoneyModal open={open} opener={opener} labelledBy="return-title" immediate onCancel={() => setOpen(false)} onClose={() => {}}>
          <MoneyModalHeader title="Focus return" titleId="return-title" />
        </MoneyModal>
      </>;
    }

    render(<Harness />);
    const trigger = page().getByRole("button", { name: "Open drawer" });
    trigger.focus();
    await act(async () => fireEvent.click(trigger));
    const close = await page().findByRole("button", { name: "Close" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    await act(async () => fireEvent.click(close));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  test("checks the current close focus guard and restores the opener in a later allowed session", async () => {
    let allowFocus = true;
    function Harness() {
      const [open, setOpen] = useState(false);
      const [opener, setOpener] = useState<HTMLElement | null>(null);
      return <>
        <button type="button" onClick={(event) => { setOpener(event.currentTarget); setOpen(true); }}>Open guarded drawer</button>
        <MoneyModal open={open} opener={opener} focusOnClose={() => allowFocus} labelledBy="guard-title" immediate onCancel={() => setOpen(false)} onClose={() => {}}>
          <MoneyModalHeader title="Guarded focus" titleId="guard-title" />
        </MoneyModal>
      </>;
    }
    render(<Harness />);
    const trigger = page().getByRole("button", { name: "Open guarded drawer" });
    const rects = [new DOMRect(0, 0, 100, 44)];
    trigger.getClientRects = () => Object.assign(rects, { item: (index: number) => rects[index] ?? null });
    for (const allowed of [false, true]) {
      trigger.focus();
      await act(async () => fireEvent.click(trigger));
      const close = await page().findByRole("button", { name: "Close" });
      await waitFor(() => expect(document.activeElement).toBe(close));
      allowFocus = allowed;
      await act(async () => fireEvent.click(close));
      await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
      if (allowed) await waitFor(() => expect(document.activeElement).toBe(trigger));
      else expect(document.activeElement).not.toBe(trigger);
    }
  });

  test("standalone sibling drawers do not reuse unrelated focus or a previous interactive opener", async () => {
    let programmaticOpen: (index: number) => void = () => { throw new Error("Sheet controls are not initialized"); };
    function Harness({ initialActive = null }: { initialActive?: number | null }) {
      const [active, setActive] = useState<number | null>(initialActive);
      const [opener, setOpener] = useState<HTMLElement | null>(null);
      useLayoutEffect(() => { programmaticOpen = (index) => { setOpener(null); setActive(index); }; }, []);
      return <>
        <button type="button" onClick={(event) => { setOpener(event.currentTarget); setActive(0); }}>Open first</button>
        <button type="button">Unrelated</button>
        <main tabIndex={-1} />
        <AppDrawer open={active === 0} opener={opener} labelledBy="first-title" immediate onCancel={() => setActive(null)}><MoneyModalHeader title="First" titleId="first-title" /></AppDrawer>
        <AppDrawer open={active === 1} opener={opener} labelledBy="second-title" immediate onCancel={() => setActive(null)}><MoneyModalHeader title="Second" titleId="second-title" /></AppDrawer>
      </>;
    }
    const view = render(<Harness />);
    const trigger = page().getByRole("button", { name: "Open first" });
    const unrelated = page().getByRole("button", { name: "Unrelated" });
    for (const element of [trigger, unrelated]) {
      const rects = [new DOMRect(0, 0, 100, 44)];
      element.getClientRects = () => Object.assign(rects, { item: (index: number) => rects[index] ?? null });
    }
    await act(async () => fireEvent.click(trigger));
    await page().findByRole("dialog", { name: "First" });
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close" })));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    for (const index of [0, 1]) {
      page().getByRole("main").focus();
      await act(async () => { fireEvent.click(unrelated); programmaticOpen(index); });
      const dialog = await page().findByRole("dialog", { name: index === 0 ? "First" : "Second" });
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      await act(async () => fireEvent.click(page().getByRole("button", { name: "Close" })));
      await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
      expect(document.activeElement).not.toBe(trigger);
      expect(document.activeElement).not.toBe(unrelated);
    }
    view.unmount();
    render(<Harness initialActive={1} />);
    await page().findByRole("dialog", { name: "Second" });
    await act(async () => fireEvent.click(page().getByRole("button", { name: "Close" })));
    await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(trigger);
    expect(document.activeElement).not.toBe(unrelated);
  });

  test("keeps the drawer open when cancellation is vetoed", async () => {
    render(
      <MoneyModal
        open
        labelledBy="blocked-title"
        immediate
        onCancel={() => false}
        onClose={() => {}}
      >
        <h2 id="blocked-title">Blocked</h2>
      </MoneyModal>,
    );

    const dialog = page().getByRole("dialog", { name: "Blocked" });
    expect(dialog.getAttribute("data-immediate")).toBe("");

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(page().getByRole("dialog", { name: "Blocked" })).toBeTruthy();
  });

  test("vetoes Escape and overlay while pending and disables Close", async () => {
    const events: string[] = [];
    render(
      <MoneyModal open labelledBy="pending-title" immediate pending onCancel={() => { events.push("cancel"); }} onClose={() => events.push("close")}>
        <MoneyModalHeader title="Pending request" titleId="pending-title" />
      </MoneyModal>,
    );

    const close = page().getByRole("button", { name: "Close" });
    expect(close.hasAttribute("disabled")).toBe(true);
    await act(async () => fireEvent.click(close));
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    await act(async () => fireEvent.click(document.querySelector("[data-slot=drawer-overlay]")!));
    expect(page().getByRole("dialog", { name: "Pending request" })).toBeTruthy();
    expect(events).toEqual([]);
  });

  test("allows dismissal after pending clears", async () => {
    const events: string[] = [];
    const renderModal = (pending: boolean) => (
      <MoneyModal open labelledBy="pending-title" immediate pending={pending} onCancel={() => { events.push("cancel"); }} onClose={() => events.push("close")}>
        <MoneyModalHeader title="Pending request" titleId="pending-title" />
      </MoneyModal>
    );
    const { rerender } = render(renderModal(true));
    rerender(renderModal(false));

    expect(page().getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(false);
    await act(async () => fireEvent.click(document.querySelector("[data-slot=drawer-overlay]")!));
    expect(events).toEqual(["cancel"]);
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    expect(events).toEqual(["cancel", "cancel"]);
  });

  for (const triggerName of ["Add money", "Send"]) {
    test(`returns focus to the ${triggerName} button after closing`, async () => {
      function Harness() {
        const [open, setOpen] = useState(false);
        const [opener, setOpener] = useState<HTMLElement | null>(null);
        return (
          <>
            <button type="button" onClick={(event) => { setOpener(event.currentTarget); setOpen(true); }}>{triggerName}</button>
            <MoneyModal
              open={open}
              opener={opener}
              labelledBy="focus-title"
              immediate
              onCancel={() => setOpen(false)}
              onClose={() => {}}
            >
              <h2 id="focus-title">Focus drawer</h2>
              <button type="button" data-initial-focus>Inside drawer</button>
            </MoneyModal>
          </>
        );
      }

      render(<Harness />);
      const trigger = page().getByRole("button", { name: triggerName });
      trigger.focus();
      await act(async () => fireEvent.click(trigger));
      const dialog = await page().findByRole("dialog", { name: "Focus drawer" });
      expect(dialog.contains(document.activeElement)).toBe(true);
      await waitFor(() => expect(document.body.style.overflowY).toBe("hidden"));

      await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
      await waitFor(() => expect(page().queryByRole("dialog", { name: "Focus drawer" })).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      await waitFor(() => expect(document.body.style.overflowY).toBe(""));
    });
  }

  for (const dismissal of ["Escape", "Close"] as const) {
    test(`restores the opener after ${dismissal} while a route focuses the shell`, async () => {
      function Harness() {
        const [open, setOpen] = useState(false);
        const [opener, setOpener] = useState<HTMLElement | null>(null);
        const dismiss = () => {
          setOpen(false);
          document.querySelector<HTMLElement>("main")?.focus();
        };
        return (
          <>
            <button type="button" onClick={(event) => { setOpener(event.currentTarget); setOpen(true); }}>Send</button>
            <main tabIndex={-1} />
            <MoneyModal open={open} opener={opener} labelledBy="route-title" immediate onCancel={dismiss} onClose={() => {}}>
              <MoneyModalHeader title="Send" titleId="route-title" />
            </MoneyModal>
          </>
        );
      }

      render(<Harness />);
      const trigger = page().getByRole("button", { name: "Send" });
      const rects = [new DOMRect(0, 0, 100, 44)];
      trigger.getClientRects = () => Object.assign(rects, { item: (index: number) => rects[index] ?? null });
      trigger.focus();
      await act(async () => fireEvent.click(trigger));
      await page().findByRole("dialog", { name: "Send" });
      await act(async () => {
        if (dismissal === "Escape") fireEvent.keyDown(document, { key: "Escape" });
        else fireEvent.click(page().getByRole("button", { name: "Close" }));
      });
      await waitFor(() => expect(page().queryByRole("dialog", { name: "Send" })).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    });
  }

  test("calls onClose only after an accepted close completes", async () => {
    const events: string[] = [];

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <MoneyModal
          open={open}
          labelledBy="ordered-title"
          immediate
          onCancel={() => {
            events.push("cancel");
            setOpen(false);
          }}
          onClose={() => events.push("close")}
        >
          <h2 id="ordered-title">Ordered</h2>
        </MoneyModal>
      );
    }

    render(<Harness />);
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => expect(page().queryByRole("dialog", { name: "Ordered" })).toBeNull());
    expect(events).toEqual(["cancel", "close"]);
  });
});
