import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const {
  ActivityLedger,
  ActivityNeedsAttention,
  activityLedgerStatuses,
  isActivityLedgerNextActionAllowed,
} = await import("./activity-ledger");
import type { ActivityLedgerItem } from "./activity-ledger";

afterEach(cleanup);

type FundingLedgerItem = Extract<ActivityLedgerItem, { family: "funding-order" }>;

function fundingItem(overrides: Partial<FundingLedgerItem> = {}): FundingLedgerItem {
  return {
    canonicalId: "funding:idrx:order-1",
    family: "funding-order",
    title: "Add money by bank transfer",
    exactAmount: "Rp 2.000.000,00 IDR",
    occurredAt: "2026-09-19T04:12:00.000Z",
    occurredAtLabel: "Today, 11:12",
    status: "waiting-customer",
    nextAction: { kind: "complete-payment", label: "View instructions" },
    detail: {
      family: "funding-order",
      provider: "IDRX",
      paymentMethod: "Mandiri virtual account",
      orderId: "order-1",
    },
    ...overrides,
  };
}

describe("ActivityLedger presentation contract", () => {
  test("defines every requested status and fails closed for unsafe next actions", () => {
    expect(activityLedgerStatuses).toEqual([
      "waiting-customer",
      "waiting-provider",
      "waiting-chain",
      "waiting-home",
      "confirmed",
      "failed",
      "expired",
      "ambiguous",
      "reversed",
      "refunded",
    ]);
    expect(isActivityLedgerNextActionAllowed("waiting-customer", "complete-payment")).toBe(true);
    expect(isActivityLedgerNextActionAllowed("waiting-chain", "retry")).toBe(false);
    expect(isActivityLedgerNextActionAllowed("ambiguous", "retry")).toBe(false);
    expect(isActivityLedgerNextActionAllowed("reversed", "withdraw-returned-funds")).toBe(true);
  });

  test("preserves exact supplied amounts and presents a canonical item once", () => {
    const view = render(<ActivityLedger items={[fundingItem({ correlatedSourceCount: 2 })]} />);

    const rows = view.getAllByRole("button", { name: /Add money by bank transfer/ });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Rp 2.000.000,00 IDR");
    expect(view.getByText("Matched confirmation")).toBeTruthy();
  });

  test("opens one family-specific detail sheet and exposes only its safe action", async () => {
    const selected: (string | null)[] = [];
    const actions: string[] = [];
    const view = render(
      <ActivityLedger
        items={[fundingItem()]}
        onSelectedChange={(id) => selected.push(id)}
        onNextAction={(_, action) => actions.push(action.kind)}
      />,
    );

    const opener = view.getByRole("button", { name: /Add money by bank transfer/ });
    opener.focus();
    fireEvent.click(opener);
    expect(await view.findByRole("heading", { name: "Add money by bank transfer" })).toBeTruthy();
    expect(view.getByText("Mandiri virtual account")).toBeTruthy();
    expect(view.getByText("order-1")).toBeTruthy();
    expect(view.getByText(/Continue this activity/)).toBeTruthy();

    const actionButton = view.getByRole("button", { name: "View instructions" });
    expect(actionButton.closest('[data-slot="drawer-footer"]')).toBeTruthy();
    fireEvent.click(actionButton);
    expect(actions).toEqual(["complete-payment"]);
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(view.queryByRole("heading", { name: "Add money by bank transfer" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(selected).toEqual(["funding:idrx:order-1", null]);
  });

  test("does not render or reserve detail recovery UI without a handler", async () => {
    const view = render(<ActivityLedger items={[fundingItem()]} />);

    fireEvent.click(view.getByRole("button", { name: /Add money by bank transfer/ }));
    expect(await view.findByRole("heading", { name: "Add money by bank transfer" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "View instructions" })).toBeNull();

    const dialog = view.getByRole("dialog", { name: "Add money by bank transfer" });
    expect(dialog.querySelector('[data-slot="drawer-footer"]')).toBeNull();
  });

  test("does not render an invalid retry for an ambiguous outcome", async () => {
    const ambiguousItem: ActivityLedgerItem = {
      canonicalId: "cashout:ambiguous",
      family: "cash-out-order",
      title: "Cash out",
      exactAmount: "$80.00 USDC",
      occurredAt: "2026-09-19T04:12:00.000Z",
      occurredAtLabel: "Today, 11:12",
      status: "ambiguous",
      nextAction: { kind: "retry", label: "Try cash-out again" },
      detail: { family: "cash-out-order", provider: "Peer", payoutMethod: "Cash App", orderId: "deposit-7" },
    };
    const view = render(<ActivityLedger items={[ambiguousItem]} />);

    fireEvent.click(view.getByRole("button", { name: /Cash out/ }));
    expect(await view.findByText(/Do not try again yet/)).toBeTruthy();
    expect(view.queryByRole("button", { name: "Try cash-out again" })).toBeNull();
  });

  test("shows an authoritative empty state when all sources succeed", () => {
    const view = render(<ActivityLedger items={[]} />);

    expect(view.getByText("No activity yet")).toBeTruthy();
    expect(view.queryByRole("status")).toBeNull();
  });

  test("preserves the unavailable alert without claiming an empty ledger when a source fails", () => {
    const view = render(
      <ActivityLedger
        items={[]}
        sourceFailures={[{ id: "onchain", label: "Onchain transfers" }]}
      />,
    );

    expect(view.getByRole("status").textContent).toContain("Onchain transfers");
    expect(view.queryByText("No activity yet")).toBeNull();
  });

  test("keeps available rows visible during a partial-source failure", () => {
    const retry: string[] = [];
    const view = render(
      <ActivityLedger
        items={[fundingItem()]}
        sourceFailures={[{ id: "onchain", label: "Onchain transfers" }]}
        onRetrySources={() => retry.push("retry")}
      />,
    );

    expect(view.getByRole("status").textContent).toContain("Available items are unchanged");
    expect(view.getByRole("button", { name: /Add money by bank transfer/ }).textContent)
      .toContain("Rp 2.000.000,00 IDR");
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(retry).toEqual(["retry"]);
  });

  test("shows the Home affordance only for an allowed customer-owned continuation", () => {
    const actions: string[] = [];
    const { rerender } = render(
      <ActivityNeedsAttention
        item={fundingItem()}
        count={2}
        onNextAction={(_, action) => actions.push(action.kind)}
      />,
    );

    const body = within(document.body);
    expect(body.getByText("2 activities need you. Add money by bank transfer")).toBeTruthy();
    fireEvent.click(body.getByRole("button", { name: "View instructions" }));
    expect(actions).toEqual(["complete-payment"]);

    rerender(
      <ActivityNeedsAttention
        item={fundingItem({ status: "waiting-chain" })}
        onNextAction={() => undefined}
      />,
    );
    expect(body.queryByText("Needs your attention")).toBeNull();
  });
});
