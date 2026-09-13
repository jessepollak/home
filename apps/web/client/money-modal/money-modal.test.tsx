import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { MoneyModal } = await import("./money-modal");

afterEach(cleanup);

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

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(page().getByRole("dialog", { name: "Blocked" })).toBeTruthy();
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
