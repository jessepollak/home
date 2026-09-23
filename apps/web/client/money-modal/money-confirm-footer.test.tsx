import "@/client/account/dom-test-harness";

import { page } from "@/tests/helpers/dom";
import { afterEach, expect, test } from "bun:test";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { MoneyConfirmFooter, MoneyModalFooter } = await import("./money-modal");

afterEach(cleanup);

const action: PreparedMoneyAction = {
  id: "prepared-1",
  kind: "send",
  title: "Send",
  calls: [],
  amounts: [],
  warnings: [],
  owner: { subject: "subject", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
  createdAt: "2026-09-23T00:00:00.000Z",
  expiresAt: "2099-09-23T00:00:00.000Z",
};

test("only a prepared confirm primary carries its id", () => {
  const view = render(<MoneyModalFooter primaryLabel="Continue" secondaryLabel="Back" onSecondary={() => {}} />);
  expect(page().getByRole("button", { name: "Continue" }).hasAttribute("data-money-action-id")).toBe(false);
  view.rerender(<MoneyConfirmFooter action={action} primaryLabel="Send" secondaryLabel="Back" onSecondary={() => {}} />);
  expect(page().getByRole("button", { name: "Send" }).getAttribute("data-money-action-id")).toBe("prepared-1");
  expect(page().getByRole("button", { name: "Back" }).hasAttribute("data-money-action-id")).toBe(false);
  view.rerender(<MoneyModalFooter primaryLabel="Try again" />);
  expect(page().getByRole("button", { name: "Try again" }).hasAttribute("data-money-action-id")).toBe(false);
});

test("expired and invalid prepared actions never mark a confirm control", () => {
  const view = render(<MoneyConfirmFooter action={{ ...action, expiresAt: "2000-01-01T00:00:00.000Z" }} primaryLabel="Send" />);
  expect(page().getByRole("button", { name: "Send" }).hasAttribute("data-money-action-id")).toBe(false);
  view.rerender(<MoneyConfirmFooter action={{ ...action, expiresAt: "invalid" }} primaryLabel="Send" />);
  expect(page().getByRole("button", { name: "Send" }).hasAttribute("data-money-action-id")).toBe(false);
});

test("removes the id when a prepared action expires while its review remains open", async () => {
  const view = render(<MoneyConfirmFooter action={{ ...action, expiresAt: new Date(Date.now() + 100).toISOString() }} primaryLabel="Send" />);
  const confirm = page().getByRole("button", { name: "Send" });
  expect(confirm.getAttribute("data-money-action-id")).toBe("prepared-1");
  await waitFor(() => expect(confirm.hasAttribute("data-money-action-id")).toBe(false));
  view.unmount();
});
