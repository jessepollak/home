import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { MoneyModal } = await import("./money-modal");

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.body.style.overflow = "";
  document.body.style.overflowX = "";
  document.body.style.overflowY = "";
  document.documentElement.style.scrollbarGutter = "";
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
