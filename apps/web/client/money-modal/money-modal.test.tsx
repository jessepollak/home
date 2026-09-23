import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { MoneyModal, MoneyModalHeader } = await import("./money-modal");

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
          onClose={() => {}}
        />
      </MoneyModal>,
    );

    expect(page().getByLabelText("Asset")).toBeTruthy();
    expect(document.querySelectorAll("[data-initial-focus]")).toHaveLength(1);
    expect(page().getByRole("button", { name: "Close" }).hasAttribute("data-initial-focus")).toBe(true);
  });
});

describe("MoneyModal dismissal contract", () => {
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

  test("rejects dismissal during a pending request and accepts it after settlement", async () => {
    const events: string[] = [];
    const onCancel = () => { events.push("cancel"); };
    const onClose = () => { events.push("close"); };
    const renderModal = (pending: boolean) => (
      <MoneyModal open labelledBy="pending-title" immediate pending={pending} onCancel={onCancel} onClose={onClose}>
        <h2 id="pending-title">Pending request</h2>
      </MoneyModal>
    );
    const { rerender } = render(renderModal(true));
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    await act(async () => fireEvent.click(document.querySelector("[data-slot=drawer-overlay]")!));
    expect(page().getByRole("dialog", { name: "Pending request" })).toBeTruthy();
    expect(events).toEqual([]);

    rerender(renderModal(false));
    await act(async () => fireEvent.click(document.querySelector("[data-slot=drawer-overlay]")!));
    expect(events).toEqual(["cancel"]);
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    expect(events).toEqual(["cancel", "cancel"]);
  });

  test("moves focus into the drawer, locks scroll, then restores both on close", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open drawer</button>
          <MoneyModal
            open={open}
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
    const trigger = page().getByRole("button", { name: "Open drawer" });
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
