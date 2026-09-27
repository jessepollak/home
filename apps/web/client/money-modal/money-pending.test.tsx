import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import { useState } from "react";

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { MoneyModal, MoneyModalHeader, useMoneyModalPending } = await import("./money-modal");

afterEach(async () => {
  cleanup();
  await waitFor(() => expect(document.querySelector("[data-base-ui-portal]")).toBeNull());
});

function Pending() {
  useMoneyModalPending(true);
  return <span>Waiting</span>;
}

test("multiple pending descendants keep dismissal blocked until the last one unregisters", async () => {
  const events: string[] = [];
  function Journey() {
    const [remaining, setRemaining] = useState(2);
    return <MoneyModal open labelledBy="pending-title" immediate onCancel={() => { events.push("cancel"); }} onClose={() => {}}>
      <MoneyModalHeader title="Pending" titleId="pending-title" />
      {remaining > 0 ? <Pending /> : null}
      {remaining > 1 ? <Pending /> : null}
      <button type="button" onClick={() => setRemaining((count) => count - 1)}>Complete task</button>
    </MoneyModal>;
  }
  render(<Journey />);
  const close = page().getByRole("button", { name: "Close" });
  expect(close.hasAttribute("disabled")).toBe(true);
  await act(async () => fireEvent.click(page().getByRole("button", { name: "Complete task" })));
  expect(close.hasAttribute("disabled")).toBe(true);
  await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
  expect(events).toEqual([]);
  await act(async () => fireEvent.click(page().getByRole("button", { name: "Complete task" })));
  expect(close.hasAttribute("disabled")).toBe(false);
  await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
  expect(events).toEqual(["cancel"]);
});
