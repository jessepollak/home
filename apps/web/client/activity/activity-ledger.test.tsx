import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { useState } = await import("react");
const {
  ActivityLedger,
  ActivityNeedsAttention,
  activityLedgerStatuses,
  isActivityLedgerNextActionAllowed,
} = await import("./activity-ledger");
import type { ActivityLedgerItem, ActivityLedgerProps } from "./activity-ledger";

afterEach(cleanup);

type FundingLedgerItem = Extract<ActivityLedgerItem, { family: "funding-order" }>;
type HomeActionLedgerItem = Extract<ActivityLedgerItem, { family: "home-action" }>;
type CashOutLedgerItem = Extract<ActivityLedgerItem, { family: "cash-out-order" }>;

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

function homeActionItem(overrides: Partial<HomeActionLedgerItem> = {}): HomeActionLedgerItem {
  return {
    canonicalId: "action:verification:1",
    family: "home-action",
    title: "Verify your account",
    exactAmount: "$250.00 USD",
    occurredAt: "2026-09-19T04:12:00.000Z",
    occurredAtLabel: "Today, 11:12",
    status: "waiting-customer",
    nextAction: { kind: "resume-verification", label: "Resume verification" },
    detail: {
      family: "home-action",
      operation: "Verify account",
      network: "Base",
      actionId: "verification-1",
    },
    ...overrides,
  };
}

function ControlledLedger({ item }: { item: ActivityLedgerItem }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <ActivityLedger
      items={[item]}
      selectedId={selectedId}
      onSelectedChange={setSelectedId}
    />
  );
}

function cashOutItem(overrides: Partial<CashOutLedgerItem> = {}): CashOutLedgerItem {
  return {
    canonicalId: "cashout:peer:deposit-7",
    family: "cash-out-order",
    title: "Cash out",
    exactAmount: "$80.00 USDC",
    occurredAt: "2026-09-19T04:12:00.000Z",
    occurredAtLabel: "Today, 11:12",
    status: "reversed",
    nextAction: { kind: "withdraw-returned-funds", label: "Withdraw returned funds" },
    detail: {
      family: "cash-out-order",
      provider: "Peer",
      payoutMethod: "Cash App",
      orderId: "deposit-7",
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
    expect(isActivityLedgerNextActionAllowed("waiting-customer", "resume-verification", "funding-order")).toBe(true);
    expect(isActivityLedgerNextActionAllowed("waiting-customer", "resume-verification", "home-action")).toBe(false);
    expect(isActivityLedgerNextActionAllowed("waiting-customer", "complete-payment", "funding-order")).toBe(true);
    expect(isActivityLedgerNextActionAllowed("waiting-customer", "complete-payment", "cash-out-order")).toBe(false);
    expect(isActivityLedgerNextActionAllowed("waiting-chain", "retry", "home-action")).toBe(false);
    expect(isActivityLedgerNextActionAllowed("ambiguous", "retry", "cash-out-order")).toBe(false);
    expect(isActivityLedgerNextActionAllowed("reversed", "withdraw-returned-funds", "cash-out-order")).toBe(true);
    expect(isActivityLedgerNextActionAllowed("reversed", "withdraw-returned-funds", "funding-order")).toBe(false);
    expect(isActivityLedgerNextActionAllowed("failed", "retry", "card")).toBe(true);
  });

  test("preserves exact supplied amounts and presents a canonical item once", () => {
    const view = render(<ActivityLedger items={[fundingItem({ correlatedSourceCount: 2 })]} />);

    const rows = view.getAllByRole("button", { name: /Add money by bank transfer/ });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Rp 2.000.000,00 IDR");
    expect(view.getByText("Matched confirmation")).toBeTruthy();
  });

  test("opens one family-specific detail sheet, exposes only its safe action, and restores focus to the activated row", async () => {
    const selected: (string | null)[] = [];
    const actions: string[] = [];
    const view = render(
      <>
        <button type="button">Previously focused</button>
        <ActivityLedger
          items={[fundingItem()]}
          onSelectedChange={(id) => selected.push(id)}
          onNextAction={(_, action) => actions.push(action.kind)}
        />
      </>,
    );

    const previouslyFocused = view.getByRole("button", { name: "Previously focused" });
    const opener = view.getByRole("button", { name: /Add money by bank transfer/ });
    previouslyFocused.focus();
    expect(document.activeElement).toBe(previouslyFocused);
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

  test("shows confirmed detail copy once without an empty or malformed accessible description", async () => {
    const view = render(
      <ActivityLedger items={[fundingItem({ status: "confirmed", nextAction: undefined })]} />,
    );

    fireEvent.click(view.getByRole("button", { name: /Add money by bank transfer/ }));
    const dialog = await view.findByRole("dialog", { name: "Add money by bank transfer" });
    const descriptionId = dialog.getAttribute("aria-describedby");
    const description = descriptionId ? document.getElementById(descriptionId) : null;

    expect(description?.textContent).toBe("Confirmed");
    expect(view.queryByText("Confirmed. This activity is confirmed.")).toBeNull();
  });

  test("keeps custom confirmed status copy in the modal accessible description", async () => {
    const view = render(
      <ActivityLedger
        items={[fundingItem({
          status: "confirmed",
          statusCopy: { label: "Completed!", description: "Settled on Base." },
          nextAction: undefined,
        })]}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: /Add money by bank transfer/ }));
    const dialog = await view.findByRole("dialog", { name: "Add money by bank transfer" });
    const descriptionId = dialog.getAttribute("aria-describedby");
    const description = descriptionId ? document.getElementById(descriptionId) : null;

    expect(description?.textContent).toBe("Completed! Settled on Base.");
  });

  test("opens and closes details when selection is controlled", async () => {
    const view = render(<ControlledLedger item={fundingItem()} />);

    fireEvent.click(view.getByRole("button", { name: /Add money by bank transfer/ }));
    expect(await view.findByRole("heading", { name: "Add money by bank transfer" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(view.queryByRole("heading", { name: "Add money by bank transfer" })).toBeNull());
  });

  test("falls back to working local selection for malformed controlled props without a handler", async () => {
    // @ts-expect-error A selectedId requires onSelectedChange at the public TypeScript boundary.
    const malformedProps: ActivityLedgerProps = {
      items: [fundingItem()],
      selectedId: "funding:idrx:order-1",
    };
    const view = render(<ActivityLedger {...malformedProps} />);

    expect(await view.findByRole("heading", { name: "Add money by bank transfer" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(view.queryByRole("heading", { name: "Add money by bank transfer" })).toBeNull());

    fireEvent.click(view.getByRole("button", { name: /Add money by bank transfer/ }));
    expect(await view.findByRole("heading", { name: "Add money by bank transfer" })).toBeTruthy();
  });

  test("exposes verification recovery only in a funding-owned detail sheet", async () => {
    const verificationAction = { kind: "resume-verification", label: "Resume verification" } as const;
    const view = render(
      <ActivityLedger
        items={[
          fundingItem({
            canonicalId: "funding:verification:1",
            title: "Verify your funding account",
            nextAction: verificationAction,
          }),
          homeActionItem(),
        ]}
        onNextAction={() => undefined}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: /Verify your funding account/ }));
    expect(await view.findByRole("button", { name: "Resume verification" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(view.queryByRole("heading", { name: "Verify your funding account" })).toBeNull());

    fireEvent.click(view.getByRole("button", { name: /Verify your account/ }));
    expect(await view.findByRole("heading", { name: "Verify your account" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Resume verification" })).toBeNull();
    expect(view.getByRole("dialog").querySelector('[data-slot="drawer-footer"]')).toBeNull();
  });

  test("shows a cash-out-owned returned-funds action in its detail sheet", async () => {
    const actions: string[] = [];
    const view = render(
      <ActivityLedger
        items={[cashOutItem()]}
        onNextAction={(_, action) => actions.push(action.kind)}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: /Cash out/ }));
    const actionButton = await view.findByRole("button", { name: "Withdraw returned funds" });
    fireEvent.click(actionButton);
    expect(actions).toEqual(["withdraw-returned-funds"]);
  });

  test("fails closed when a detail action belongs to another family", async () => {
    const view = render(
      <ActivityLedger
        items={[fundingItem({
          status: "reversed",
          nextAction: { kind: "withdraw-returned-funds", label: "Withdraw returned funds" },
        })]}
        onNextAction={() => undefined}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: /Add money by bank transfer/ }));
    expect(await view.findByRole("heading", { name: "Add money by bank transfer" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Withdraw returned funds" })).toBeNull();
    expect(view.getByRole("dialog").querySelector('[data-slot="drawer-footer"]')).toBeNull();
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

  test("exposes verification recovery only for a funding-owned Home attention item", () => {
    const verificationAction = { kind: "resume-verification", label: "Resume verification" } as const;
    const { rerender } = render(
      <ActivityNeedsAttention
        item={fundingItem({
          title: "Verify your funding account",
          nextAction: verificationAction,
        })}
        onNextAction={() => undefined}
      />,
    );

    const body = within(document.body);
    expect(body.getByRole("button", { name: "Resume verification" })).toBeTruthy();

    rerender(
      <ActivityNeedsAttention
        item={homeActionItem()}
        onNextAction={() => undefined}
      />,
    );
    expect(body.queryByText("Needs your attention")).toBeNull();
    expect(body.queryByRole("button", { name: "Resume verification" })).toBeNull();
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
        item={cashOutItem({
          status: "waiting-customer",
          nextAction: { kind: "complete-payment", label: "View instructions" },
        })}
        onNextAction={() => undefined}
      />,
    );
    expect(body.queryByText("Needs your attention")).toBeNull();

    rerender(
      <ActivityNeedsAttention
        item={fundingItem({ status: "waiting-chain" })}
        onNextAction={() => undefined}
      />,
    );
    expect(body.queryByText("Needs your attention")).toBeNull();
  });
});
