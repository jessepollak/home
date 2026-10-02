import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { supportSheetLoading } from "./support-sheet-loading";

afterEach(cleanup);

function loadingState(overrides: Partial<{ open: boolean; failed: boolean; retry: () => void; onCancel: () => void; onClosed: () => void; onEntered: () => void }> = {}) {
  const calls: string[] = [];
  let entrances = 0;
  return {
    entered: () => entrances,
    calls,
    state: {
      open: true,
      failed: false,
      retry: () => { calls.push("retry"); },
      onCancel: () => { calls.push("cancel"); },
      onClosed: () => { calls.push("closed"); },
      onEntered: () => { entrances += 1; },
      ...overrides,
    },
  };
}

test("the deferred support sheet shows the loading skeleton while its chunk loads", async () => {
  const { state } = loadingState();
  render(<>{supportSheetLoading({ onClose: state.onCancel }).render(state)}</>);
  expect(await page().findByRole("dialog", { name: "Support" })).toBeTruthy();
  expect(page().getByRole("status", { name: "Loading support messages" })).toBeTruthy();
  expect(page().queryByText("Couldn't open support.")).toBeNull();
  expect(page().getByRole("button", { name: "Close support" })).toBeTruthy();
});

test("a failed support chunk offers a manual retry instead of a dead control", async () => {
  const { calls, state } = loadingState({ failed: true });
  render(<>{supportSheetLoading({ onClose: state.onCancel }).render(state)}</>);
  const dialog = await page().findByRole("dialog", { name: "Support" });
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("Couldn't open support.");
  expect(page().queryByRole("status", { name: "Loading support messages" })).toBeNull();
  fireEvent.click(page().getByRole("button", { name: "Try again" }));
  expect(calls).toEqual(["retry"]);
});

test("closing the deferred support sheet cancels the open request", async () => {
  const { calls, state } = loadingState();
  render(<>{supportSheetLoading({ onClose: state.onCancel }).render(state)}</>);
  await page().findByRole("dialog", { name: "Support" });
  fireEvent.click(page().getByRole("button", { name: "Close support" }));
  expect(calls).toEqual(["cancel"]);
});

test("the loading skeleton reports its entrance so the deferred sheet hands off the chat", async () => {
  const { entered, state } = loadingState();
  render(<>{supportSheetLoading({ onClose: state.onCancel }).render(state)}</>);
  await page().findByRole("dialog", { name: "Support" });
  await waitFor(() => expect(entered()).toBeGreaterThan(0));
});
