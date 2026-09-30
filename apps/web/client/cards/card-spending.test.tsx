import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, jest, test } from "bun:test";
import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import type { CardAllowancePrepareParams, CardSpendingResponse } from "@/shared/cards/allowance-contract";
import type { OperationResult, PreparedMoneyAction } from "@/shared/money-actions/types";
import { BASE_USDC_ADDRESS } from "@/shared/money-actions/network-fee";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { ExpirySchedulerContext } from "@/client/actions/expiry";
import { TransferExecutionError } from "@/shared/transfers/types";
import { parseRecentActionsPayload } from "@/shared/actions/contracts/list";
import { cardsBody } from "@/tests/browser/fixtures/bodies";
import type { CardScreenProps } from "./card-experience";

const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { CardScreen } = await import("./card-experience");

afterEach(() => { cleanup(); getHomeQueryClient().clear(); });

const spender = "0x2222222222222222222222222222222222222222";
const retired = "0x3333333333333333333333333333333333333333";
const available: Extract<CardSpendingResponse, { status: "available" }> = {
  version: 1, status: "available", setEnabled: true, spender, walletBaseUnits: "100000000", allowanceBaseUnits: "25000000", availableBaseUnits: "25000000", retired: [], blockNumber: "1", fetchedAt: "2026-09-28T12:00:00.000Z",
};

function prepared(params: CardAllowancePrepareParams): PreparedMoneyAction {
  return {
    id: "card-action-test", kind: "card-allowance", title: "Card spending limit", calls: [], amounts: [], warnings: ["Review this card spending permission."],
    owner: { subject: "owner-1", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
    createdAt: "2026-09-28T12:00:00.000Z", expiresAt: "2026-09-28T12:05:00.000Z",
    metadata: { product: "card", provider: "bridge", mode: "production", operation: params.operation === "set" ? "set-allowance" : "revoke-allowance", token: BASE_USDC_ADDRESS.toLowerCase() as `0x${string}`, spender: params.operation === "revoke" ? params.spender : spender, allowanceBaseUnits: params.operation === "set" ? params.allowanceBaseUnits : "0", previousAllowanceBaseUnits: "25000000", maximumBaseUnits: params.operation === "set" ? "1000000000" : null, source: { blockNumber: "1" } },
  };
}

function actionsPayload(action: PreparedMoneyAction) {
  return parseRecentActionsPayload({ actions: [{
    id: action.id, kind: "card-allowance", status: "confirmed",
    createdAt: action.createdAt, confirmedAt: action.createdAt, owner: action.owner,
    summary: { title: action.title, amounts: [], warnings: action.warnings, expiresAt: action.expiresAt, metadata: action.metadata },
  }] }, {
    user: { subject: action.owner.subject },
    smartAccount: { address: action.owner.address, chainId: action.owner.chainId },
    accountProvider: action.owner.accountProvider,
  });
}

function renderScreen(props: CardScreenProps) {
  return <ExpirySchedulerContext value={{ now: () => Date.parse("2026-09-28T12:00:00.000Z"), setTimeout: () => 0, clearTimeout: () => {} }}><CardScreen {...props} /></ExpirySchedulerContext>;
}

function setup(overrides: Partial<CardScreenProps> = {}) {
  const prepare = jest.fn(async (params: CardAllowancePrepareParams) => prepared(params));
  const execute = jest.fn(async (action: PreparedMoneyAction): Promise<OperationResult> => ({ id: action.id, status: "rejected" }));
  const fetchOperations = jest.fn(async () => ({ actions: [] }));
  const refresh = jest.fn();
  const props: CardScreenProps = {
    cards: { status: "ready", response: cardsBody("active") }, commands: { enroll: jest.fn(), issue: jest.fn(), setFrozen: jest.fn() },
    onRetry: jest.fn(), onOpenVerification: jest.fn(), ownerBoundary: "owner-1", spending: { status: "ready", response: available },
    spendingCommands: { prepare, execute, fetchOperations }, onSpendingRetry: refresh, ...overrides,
  };
  const view = render(renderScreen(props));
  return { view, props, prepare, execute, refresh };
}

async function setReview(view: ReturnType<typeof render>, amount = "25") {
  fireEvent.click(view.getByRole("button", { name: "Change" }));
  const dialog = await view.findByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: amount } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(within(dialog).getByText("Purpose")).toBeTruthy());
  return within(dialog);
}

describe("Card spending section", () => {
  test("loading is busy and has no figures", () => {
    const { view } = setup({ spending: { status: "loading" } });
    expect(view.getByRole("region", { name: "Spending" }).getAttribute("aria-busy")).toBe("true");
    expect(view.queryByText("Available to spend")).toBeNull();
  });
  test("unavailable offers a refresh without figures", () => {
    const { view, refresh } = setup({ spending: { status: "unavailable" } });
    expect(view.getByRole("alert").textContent).toContain("Couldn't load your spending limit");
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(view.queryByText("Available to spend")).toBeNull();
  });
  test("not-configured disables setting and leaves availability unknown", () => {
    const { view } = setup({ spending: { status: "not-configured" } });
    expect(view.getByText("Not available yet")).toBeTruthy();
    expect(view.getByRole("button", { name: "Set limit" }).hasAttribute("disabled")).toBe(true);
    expect(view.queryByText("Available to spend")).toBeNull();
  });
  test("ready permits setting while zero means Not set", () => {
    const { view } = setup({ spending: { status: "ready", response: { ...available, allowanceBaseUnits: "0", availableBaseUnits: "0" } } });
    expect(view.getByText("Not set")).toBeTruthy();
    expect(view.getByRole("button", { name: "Set limit" }).hasAttribute("disabled")).toBe(false);
    expect(view.queryByRole("button", { name: "Turn off" })).toBeNull();
  });
  test("disabled setting still allows revocation; restricted also disables setting", () => {
    const { view } = setup({ spending: { status: "ready", response: { ...available, setEnabled: false } } });
    expect(view.getByRole("button", { name: "Change" }).hasAttribute("disabled")).toBe(true);
    expect(view.getByRole("button", { name: "Turn off" }).hasAttribute("disabled")).toBe(false);
    expect(view.getByText("Not available yet")).toBeTruthy();
    cleanup();
    const restricted = setup({ cards: { status: "ready", response: cardsBody("restricted") } });
    expect(restricted.view.getByRole("button", { name: "Change" }).hasAttribute("disabled")).toBe(true);
  });
  test("shows nonzero retired permissions but hides zero retired permissions", () => {
    const { view } = setup({ spending: { status: "ready", response: { ...available, retired: [{ spender: retired, allowanceBaseUnits: "1000000" }, { spender: "0x4444444444444444444444444444444444444444", allowanceBaseUnits: "0" }] } } });
    expect(view.getAllByText("Old card program")).toHaveLength(1);
    expect(view.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });
  test("large allowances are displayed as Unlimited without a client maximum", () => {
    const { view } = setup({ spending: { status: "ready", response: { ...available, allowanceBaseUnits: (BigInt(1) << BigInt(255)).toString() } } });
    expect(view.getByText("Unlimited")).toBeTruthy();
  });
  test("one section follows multiple card overviews", () => {
    const { view } = setup({ cards: { status: "ready", response: { ...cardsBody("active"), cards: [...cardsBody("active").cards, { id: "ic_second", status: "active", last4: "1107" }] } } });
    expect(view.getAllByRole("region", { name: "Spending" })).toHaveLength(1);
  });
  test("non-issued states and issued states without live cards expose only nonzero revocations", () => {
    for (const state of ["not-enrolled", "verification-required", "verification-pending", "ready-to-issue", "ineligible", "canceled", "restricted", "active", "frozen"] as const) {
      const { view } = setup({
        cards: { status: "ready", response: { ...cardsBody(state), cards: [] } },
        spending: { status: "ready", response: { ...available, retired: [{ spender: retired, allowanceBaseUnits: "1000000" }] } },
      });
      const section = within(view.getByRole("region", { name: "Spending" }));
      expect(section.getByRole("button", { name: "Turn off" }).hasAttribute("disabled")).toBe(false);
      expect(section.getByRole("button", { name: "Remove" }).hasAttribute("disabled")).toBe(false);
      expect(section.queryByText("Available to spend")).toBeNull();
      expect(section.queryByText("Spending limit")).toBeNull();
      expect(section.queryByRole("button", { name: "Set limit" })).toBeNull();
      expect(section.queryByRole("button", { name: "Change" })).toBeNull();
      cleanup();
    }
  });
  test("canceled with zero or unknown allowances has no Spending region", () => {
    for (const spending of [
      { status: "ready", response: { ...available, allowanceBaseUnits: "0", availableBaseUnits: "0", retired: [{ spender: retired, allowanceBaseUnits: "0" }] } },
      { status: "loading" }, { status: "unavailable" }, { status: "not-configured" },
    ] as const) {
      const { view } = setup({ cards: { status: "ready", response: cardsBody("canceled") }, spending });
      expect(view.queryByRole("region", { name: "Spending" })).toBeNull();
      cleanup();
    }
  });
  test("not-enrolled with only a retired allowance shows Remove without Turn off", () => {
    const { view } = setup({
      cards: { status: "ready", response: cardsBody("not-enrolled") },
      spending: { status: "ready", response: { ...available, allowanceBaseUnits: "0", availableBaseUnits: "0", retired: [{ spender: retired, allowanceBaseUnits: "1000000" }] } },
    });
    const section = within(view.getByRole("region", { name: "Spending" }));
    expect(section.getByRole("button", { name: "Remove" }).hasAttribute("disabled")).toBe(false);
    expect(section.queryByRole("button", { name: "Turn off" })).toBeNull();
  });
});

describe("Card allowance flow", () => {
  test("sets exact base units and reviews the prepared spender, purpose and warning", async () => {
    const { view, prepare } = setup();
    const dialog = await setReview(view);
    expect(prepare).toHaveBeenCalledWith({ version: 1, operation: "set", allowanceBaseUnits: "25000000" });
    expect(dialog.getByText(spender)).toBeTruthy();
    expect(dialog.getByText("Card purchases from Cash")).toBeTruthy();
    expect(dialog.getByText("Review this card spending permission.")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Set limit" }).getAttribute("data-money-action-id")).toBe("card-action-test");
    fireEvent.click(dialog.getByRole("button", { name: "Back" }));
    expect(dialog.getByRole("button", { name: "Continue" })).toBeTruthy();
  });
  test("only positive amounts with at most six decimals can continue", async () => {
    const { view, prepare } = setup();
    fireEvent.click(view.getByRole("button", { name: "Change" }));
    const dialog = within(await view.findByRole("dialog"));
    expect(dialog.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "0" } });
    expect(dialog.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "1000001" } });
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(prepare).toHaveBeenCalledWith({ version: 1, operation: "set", allowanceBaseUnits: "1000001000000" }));
  });
  test("current and retired revoke prepare the exact spender", async () => {
    for (const [label, target] of [["Turn off", spender], ["Remove", retired]] as const) {
      const { view, prepare } = setup({ spending: { status: "ready", response: { ...available, setEnabled: false, retired: [{ spender: retired, allowanceBaseUnits: "1000000" }] } } });
      fireEvent.click(view.getByRole("button", { name: label }));
      await waitFor(() => expect(prepare).toHaveBeenCalledWith({ version: 1, operation: "revoke", spender: target }));
      const dialog = within(await view.findByRole("dialog"));
      await waitFor(() => expect(dialog.getByText("Purpose")).toBeTruthy());
      expect(dialog.getByText(target)).toBeTruthy();
      expect(dialog.getAllByText("Removed").length).toBeGreaterThan(0);
      cleanup();
    }
  });
  test("canceled current and retired permissions revoke the exact spender", async () => {
    for (const [label, target] of [["Turn off", spender], ["Remove", retired]] as const) {
      const { view, prepare, execute } = setup({
        cards: { status: "ready", response: cardsBody("canceled") },
        spending: { status: "ready", response: { ...available, retired: [{ spender: retired, allowanceBaseUnits: "1000000" }] } },
      });
      const section = within(view.getByRole("region", { name: "Spending" }));
      expect(section.getByRole("button", { name: "Turn off" })).toBeTruthy();
      expect(section.getByRole("button", { name: "Remove" })).toBeTruthy();
      fireEvent.click(section.getByRole("button", { name: label }));
      const dialog = within(await view.findByRole("dialog"));
      await waitFor(() => expect(dialog.getByText(target)).toBeTruthy());
      expect(prepare).toHaveBeenCalledWith({ version: 1, operation: "revoke", spender: target });
      fireEvent.click(dialog.getByRole("button", { name: "Turn off" }));
      await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
      expect(execute.mock.calls[0][0]).toEqual(prepared({ version: 1, operation: "revoke", spender: target }));
      cleanup();
    }
  });
  test("prepare error codes map to actionable copy", async () => {
    for (const [code, message] of [["CARD_ALLOWANCE_INVALID", "Enter a lower limit."], ["CARD_ALLOWANCE_UNCHANGED", "That's already your limit."], ["CARD_ALLOWANCE_NOT_READY", "An active card is required."], ["CARD_ALLOWANCE_UNAVAILABLE", "Card spending limits are unavailable right now. Try again."], ["OTHER", "Card spending limits are unavailable right now. Try again."]]) {
      const { view, prepare } = setup();
      prepare.mockImplementation(async () => { throw Object.assign(new Error(code), { code }); });
      fireEvent.click(view.getByRole("button", { name: "Change" }));
      const dialog = within(await view.findByRole("dialog"));
      fireEvent.change(dialog.getByRole("textbox"), { target: { value: "25" } });
      fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(dialog.getByRole("alert").textContent).toContain(message));
      cleanup();
    }
  });
  test("revoke prepare errors describe removal rather than setting a limit", async () => {
    for (const [code, message] of [["CARD_ALLOWANCE_INVALID", "This permission can't be removed here right now."], ["CARD_ALLOWANCE_UNCHANGED", "This permission is already off."]]) {
      const { view, prepare } = setup();
      prepare.mockImplementation(async () => { throw Object.assign(new Error(code), { code }); });
      fireEvent.click(view.getByRole("button", { name: "Turn off" }));
      const dialog = within(await view.findByRole("dialog"));
      await waitFor(() => expect(dialog.getByRole("alert").textContent).toContain(message));
      expect(dialog.queryByText("Enter a lower limit.")).toBeNull();
      expect(dialog.queryByText("That's already your limit.")).toBeNull();
      cleanup();
    }
  });
  test("wrong action kind, missing metadata and mismatched requests are rejected before review", async () => {
    for (const invalid of [
      (params: CardAllowancePrepareParams): PreparedMoneyAction => ({ ...prepared(params), kind: "send" }),
      (params: CardAllowancePrepareParams): PreparedMoneyAction => ({ ...prepared(params), metadata: undefined }),
      (): PreparedMoneyAction => prepared({ version: 1, operation: "set", allowanceBaseUnits: "1000000" }),
    ]) {
    const { view, prepare } = setup();
    prepare.mockImplementation(async (params) => invalid(params));
    fireEvent.click(view.getByRole("button", { name: "Change" }));
    const dialog = within(await view.findByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "25" } });
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(dialog.getByRole("alert").textContent).toContain("unavailable right now"));
    expect(dialog.queryByText("Purpose")).toBeNull();
      cleanup();
    }
  });
  test("wallet rejection returns to confirmation without refreshing spending", async () => {
    const { view, execute, refresh } = setup();
    const dialog = await setReview(view);
    fireEvent.click(dialog.getByRole("button", { name: "Set limit" }));
    await waitFor(() => expect(dialog.getByText("The wallet request was rejected.")).toBeTruthy());
    expect(dialog.getByRole("button", { name: "Set limit" })).toBeTruthy();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
  test("stale session stays on confirmation without retry or submission refresh", async () => {
    for (const operation of ["set", "revoke"] as const) {
      const { view, execute, refresh } = setup();
      execute.mockImplementationOnce(async () => { throw new TransferExecutionError("stale-session"); });
      let dialog: ReturnType<typeof within>;
      if (operation === "set") dialog = await setReview(view);
      else {
        fireEvent.click(view.getByRole("button", { name: "Turn off" }));
        dialog = within(await view.findByRole("dialog"));
        await waitFor(() => expect(dialog.getByText("Purpose")).toBeTruthy());
      }
      const label = operation === "set" ? "Set limit" : "Turn off";
      fireEvent.click(dialog.getByRole("button", { name: label }));
      await waitFor(() => expect(dialog.getByText("Your account changed. Sign in again and try again.")).toBeTruthy());
      expect(dialog.getByText("Purpose")).toBeTruthy();
      expect(dialog.queryByRole("button", { name: "Try again" })).toBeNull();
      const confirm = dialog.getByRole("button", { name: label });
      expect(confirm.hasAttribute("disabled")).toBe(true);
      expect(dialog.getByRole("button", { name: "Back" }).hasAttribute("disabled")).toBe(false);
      fireEvent.click(confirm);
      expect(execute).toHaveBeenCalledTimes(1);
      fireEvent.click(dialog.getByRole("button", { name: "Close spending limit" }));
      await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
      expect(refresh).not.toHaveBeenCalled();
      cleanup();
    }
  });
  test("unresolved execution retries the same action without preparing again", async () => {
    for (const failure of [new TransferExecutionError("unavailable"), new TransferExecutionError("not-submitted"), new Error("handle failed")]) {
      const { view, prepare, execute } = setup();
      execute.mockImplementationOnce(async () => { throw failure; });
      const dialog = await setReview(view);
      fireEvent.click(dialog.getByRole("button", { name: "Set limit" }));
      await waitFor(() => expect(dialog.getByText("The result is unresolved. Try again to record this same action; it won't be sent twice.")).toBeTruthy());
      expect(dialog.getByText("Purpose")).toBeTruthy();
      const originalAction = execute.mock.calls[0][0];
      expect(originalAction.id).toBe("card-action-test");
      expect(dialog.getByRole("button", { name: "Try again" }).getAttribute("data-money-action-id")).toBe(originalAction.id);
      fireEvent.click(dialog.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
      expect(execute.mock.calls[1][0]).toBe(originalAction);
      expect(prepare).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });
  test("server expiration retains review and requires Back to prepare again", async () => {
    const { view, prepare, execute } = setup();
    execute.mockImplementationOnce(async () => { throw Object.assign(new Error("expired"), { code: "ACTION_EXPIRED" }); });
    const dialog = await setReview(view);
    fireEvent.click(dialog.getByRole("button", { name: "Set limit" }));
    await waitFor(() => expect(dialog.getByText("This spending change expired. Go back and continue again.")).toBeTruthy());
    expect(dialog.getByText("Purpose")).toBeTruthy();
    const confirm = dialog.getByRole("button", { name: "Set limit" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    expect(confirm.getAttribute("data-money-action-id")).toBeNull();
    fireEvent.click(confirm);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.getByRole("button", { name: "Back" }));
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(dialog.getByText("Purpose")).toBeTruthy());
    expect(dialog.getByRole("button", { name: "Set limit" }).hasAttribute("disabled")).toBe(false);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  test("Close dismisses an outstanding preparation and ignores its late resolution", async () => {
    for (const operation of ["set", "revoke"] as const) {
      const { view, prepare, execute, refresh } = setup();
      let resolve!: (action: PreparedMoneyAction) => void;
      prepare.mockImplementation(() => new Promise((done) => { resolve = done; }));
      fireEvent.click(view.getByRole("button", { name: operation === "set" ? "Change" : "Turn off" }));
      const dialog = within(await view.findByRole("dialog"));
      if (operation === "set") {
        fireEvent.change(dialog.getByRole("textbox"), { target: { value: "25" } });
        fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
      }
      expect(prepare).toHaveBeenCalledTimes(1);
      const close = dialog.getByRole("button", { name: "Close spending limit" });
      expect(close.hasAttribute("disabled")).toBe(false);
      fireEvent.click(close);
      await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
      fireEvent.click(view.getByRole("button", { name: "Change" }));
      const reopened = within(await view.findByRole("dialog"));
      await act(async () => resolve(prepared(operation === "set" ? { version: 1, operation, allowanceBaseUnits: "25000000" } : { version: 1, operation, spender })));
      expect(reopened.queryByText("Purpose")).toBeNull();
      expect(reopened.getByRole("textbox").getAttribute("value")).toBe("");
      expect(execute).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      cleanup();
    }
  });
  test("a settled result and closing after submission refresh spending", async () => {
    const { view, execute, refresh } = setup();
    execute.mockImplementation(async () => ({ id: "card-action-test", status: "submitted" }));
    const dialog = await setReview(view);
    fireEvent.click(dialog.getByRole("button", { name: "Set limit" }));
    await waitFor(() => expect(dialog.getByText("Setting card spending limit")).toBeTruthy());
    const action = prepared({ version: 1, operation: "set", allowanceBaseUnits: "25000000" });
    const ownerKey = dataOwnerKey({ subject: action.owner.subject, smartAccountAddress: action.owner.address, chainId: action.owner.chainId, accountProvider: action.owner.accountProvider });
    await act(async () => { getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "actions"), actionsPayload(action)); });
    await waitFor(() => expect(dialog.getByText("Card spending limit set")).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });
  test("ambiguous and failed submissions use permission-only result copy", async () => {
    for (const outcome of ["submission-unknown", "dispatch-unknown", "failed"] as const) {
      const { view, execute } = setup();
      execute.mockImplementation(async () => {
        if (outcome === "failed") return { id: "card-action-test", status: "failed" };
        throw new TransferExecutionError(outcome);
      });
      const dialog = await setReview(view);
      fireEvent.click(dialog.getByRole("button", { name: "Set limit" }));
      await waitFor(() => expect(dialog.getByText(outcome === "failed" ? "Card spending change didn't go through" : "We can't confirm the card spending change")).toBeTruthy());
      cleanup();
    }
  });
  test.each([
    ["all-zero", { status: "ready", response: { ...available, allowanceBaseUnits: "0", availableBaseUnits: "0", retired: [{ spender: retired, allowanceBaseUnits: "0" }] } }],
    ["unavailable", { status: "unavailable" }],
  ] as const)("revoke-only preserves a pending execution when spending becomes %s", async (_status, spending) => {
    const { view, props, execute, refresh } = setup({ cards: { status: "ready", response: cardsBody("canceled") } });
    let resolve!: (result: OperationResult) => void;
    execute.mockImplementation(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(view.getByRole("button", { name: "Turn off" }));
    const sheet = await view.findByRole("dialog");
    const dialog = within(sheet);
    await waitFor(() => expect(dialog.getByText("Purpose")).toBeTruthy());
    fireEvent.click(dialog.getByRole("button", { name: "Turn off" }));
    expect(execute).toHaveBeenCalledTimes(1);
    view.rerender(renderScreen({ ...props, spending }));
    expect(view.queryByRole("region", { name: "Spending" })).toBeNull();
    expect(view.getByRole("dialog")).toBe(sheet);
    await act(async () => resolve({ id: "card-action-test", status: "submitted" }));
    await waitFor(() => expect(dialog.getByText("Removing card spending permission")).toBeTruthy());
    const action = prepared({ version: 1, operation: "revoke", spender });
    const ownerKey = dataOwnerKey({ subject: action.owner.subject, smartAccountAddress: action.owner.address, chainId: action.owner.chainId, accountProvider: action.owner.accountProvider });
    await act(async () => { getHomeQueryClient().setQueryData(ownerQueryKey(ownerKey, "actions"), actionsPayload(action)); });
    await waitFor(() => expect(dialog.getByText("Card spending permission removed")).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  test.each([
    { status: "loading" },
    { status: "failed" },
    { status: "ready", response: cardsBody("unavailable") },
  ] as const)("preserves a set review through cards state %j and completes execution", async (cards) => {
    const { view, props, execute, refresh } = setup();
    let resolve!: (result: OperationResult) => void;
    execute.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await setReview(view);
    const sheet = view.getByRole("dialog");
    const dialog = within(sheet);
    view.rerender(renderScreen({ ...props, cards }));
    expect(view.queryByRole("region", { name: "Spending" })).toBeNull();
    expect(view.getByRole("dialog")).toBe(sheet);
    expect(dialog.getByText("Purpose")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Set limit" }));
    expect(execute).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ id: "card-action-test", status: "submitted" }));
    await waitFor(() => expect(dialog.getByText("Setting card spending limit")).toBeTruthy());
    fireEvent.click(dialog.getByRole("button", { name: "Close spending limit" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  test("owner change fences a late wallet result and its spending refresh", async () => {
    const { view, props, execute, refresh } = setup();
    let resolve!: (result: OperationResult) => void;
    execute.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const dialog = await setReview(view);
    fireEvent.click(dialog.getByRole("button", { name: "Set limit" }));
    view.rerender(<CardScreen {...props} ownerBoundary="owner-2" />);
    await act(async () => resolve({ id: "card-action-test", status: "submitted" }));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
  test("owner boundary resets the sheet and ignores a late preparation", async () => {
    const { view, props, prepare } = setup();
    let resolve!: (action: PreparedMoneyAction) => void;
    prepare.mockImplementation(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(view.getByRole("button", { name: "Change" }));
    const dialog = within(await view.findByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "25" } });
    fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
    view.rerender(<CardScreen {...props} ownerBoundary="owner-2" />);
    expect(view.queryByRole("dialog")).toBeNull();
    await act(async () => resolve(prepared({ version: 1, operation: "set", allowanceBaseUnits: "25000000" })));
    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Change" }));
    expect(within(await view.findByRole("dialog")).getByRole("textbox").getAttribute("value")).toBe("");
  });
});
