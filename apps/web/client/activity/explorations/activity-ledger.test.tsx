import "@/client/account/dom-test-harness";
import { useRef, useState } from "react";
import { ActivityRow } from "@/components/finance-rows";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type {
  ActivityLedgerItem, ActivityLedgerStatus, ActivityLedgerFamily, ActivityLedgerNextActionKind,
} from "./activity-ledger";
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { ActivityLedger, ActivityLedgerDetailSheet, isActivityLedgerNextActionAllowed } =
  await import("./activity-ledger");
afterEach(cleanup);

const item: ActivityLedgerItem = {
  id: "transfer-1", family: "onchain-transfer", status: "confirmed", timestamp: "2026-09-23T12:00:00.000Z",
  dateLabel: "Today", title: "Received", amount: "+$200.00", direction: "in",
  detail: { family: "onchain-transfer", counterpartyLabel: "From", counterparty: "alex.base.eth", network: "Base" },
};
const funding: ActivityLedgerItem = {
  id: "funding-1", family: "funding-order", status: "waiting-customer", timestamp: item.timestamp,
  dateLabel: "Today", title: "Add money", amount: "$50.00", direction: "in",
  nextAction: { kind: "complete-payment", label: "Continue payment" },
  detail: { family: "funding-order", provider: "Coinbase", paymentMethod: "Bank transfer", orderId: "order-1" },
};
const statuses: ActivityLedgerStatus[] = [
  "waiting-customer", "waiting-provider", "waiting-chain", "waiting-home", "confirmed",
  "failed", "expired", "ambiguous", "reversed", "refunded",
];
const families: ActivityLedgerFamily[] = ["onchain-transfer", "home-action", "funding-order", "cash-out-order", "card"];
const kinds: ActivityLedgerNextActionKind[] = [
  "resume", "resume-verification", "complete-payment", "retry", "start-again",
  "clear-order", "withdraw-returned-funds",
];
const statusActions: Record<ActivityLedgerStatus, ActivityLedgerNextActionKind[]> = {
  "waiting-customer": ["resume", "resume-verification", "complete-payment"],
  "waiting-provider": [], "waiting-chain": [], "waiting-home": [], confirmed: [],
  failed: ["retry"], expired: ["start-again"],
  ambiguous: ["clear-order"], reversed: ["withdraw-returned-funds"], refunded: [],
};
const ignoreOpen = () => undefined;

function Composition({ onAction = () => undefined }: {
  onAction?: (selected: ActivityLedgerItem, kind: ActivityLedgerNextActionKind) => void;
}) {
  const [selected, setSelected] = useState<ActivityLedgerItem | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const open = (entry: ActivityLedgerItem, element: HTMLElement) => {
    opener.current = element;
    setSelected(entry);
    setIsOpen(true);
  };
  const closed = () => {
    setSelected(null);
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  };
  return <>
    <ActivityLedger items={[funding]} onOpen={open} />
    <ActivityLedgerDetailSheet item={selected} open={isOpen} immediate onDismiss={() => setIsOpen(false)}
      onClosed={closed} onAction={onAction} />
  </>;
}

function rows(view: ReturnType<typeof render>): HTMLElement[] {
  return view.getAllByRole("list").flatMap((list) => within(list).getAllByRole("button"));
}

describe("activity ledger", () => {
  test("finance row attention replaces a hidden chevron without losing its accessible announcement", () => {
    const view = render(<ul><ActivityRow icon="↓" label="Review payment" chevron={false}
      attention="Action needed" onActivate={ignoreOpen} /></ul>);
    const row = view.getByRole("button", { name: /Review payment Action needed/ });
    expect(row.querySelector('[data-slot="item-actions"] svg')).toBeTruthy();
    view.rerender(<ul><ActivityRow icon="↓" label="Review payment" chevron={false}
      onActivate={ignoreOpen} /></ul>);
    expect(view.getByRole("button", { name: "Review payment" })
      .querySelector('[data-slot="item-actions"]')).toBeNull();
    view.rerender(<ul><ActivityRow icon="↓" label="Review payment" chevron={false}
      attention="Action needed" /></ul>);
    expect(view.queryByRole("button")).toBeNull();
    expect(view.container.querySelector('[data-slot="item-actions"]')).toBeNull();
  });
  test("fails closed across status, family and action kind", () => {
    for (const status of statuses) for (const family of families) for (const kind of kinds) {
      const expected = family !== "card" && statusActions[status].includes(kind) &&
        (!["resume-verification", "complete-payment", "clear-order"].includes(kind) || family === "funding-order") &&
        (kind !== "withdraw-returned-funds" || family === "cash-out-order");
      expect(isActivityLedgerNextActionAllowed(status, family, kind)).toBe(expected);
    }
  });
  test("uses row status words, value tones, and matching context titles", () => {
    const words = ["", "", "", "", "", "Failed", "Expired",
      "", "Reversed", "Refunded"];
    const view = render(<ActivityLedger items={statuses.map((status, index) => ({
      ...item, id: `${index}`, status, title: `Entry ${index}`,
      nextAction: status === "waiting-customer" ? { kind: "resume" as const, label: "Resume" } : undefined,
    }))} onOpen={ignoreOpen} />);
    for (const [index, word] of words.entries()) {
      const row = view.getByRole("button", { description: `View Entry ${index} details` });
      expect(row.textContent).toContain(`Today${word ? ` · ${word}` : ""}`);
      if (index === 0) expect(view.getByRole("button", { name: /Action needed/ })).toBe(row);
      else expect(view.queryAllByRole("button", { name: /Action needed/ })).toHaveLength(1);
      expect(row.querySelector("[data-value-tone]")?.getAttribute("data-value-tone"))
        .toBe([4, 9].includes(index) ? "success" : [2, 3].includes(index) ? "default" : "muted");
      expect(row.querySelector("[title]")?.getAttribute("title"))
        .toBe(`Today${word ? ` · ${word}` : ""}`);
    }
    view.rerender(<ActivityLedger items={[{ ...item, direction: "out", amount: "−$200.00" }]}
      onOpen={ignoreOpen} />);
    expect(view.container.querySelector("[data-value-tone]")?.getAttribute("data-value-tone")).toBe("default");
  });
  for (const { reason, nextAction } of [
    { reason: "no next action", nextAction: undefined },
    { reason: "disallowed retry action", nextAction: { kind: "retry" as const, label: "Try again" } },
  ]) {
    test(`waiting-customer with ${reason} is pending without an action`, () => {
      const entry: ActivityLedgerItem = { ...funding, nextAction };
      const view = render(<ActivityLedger items={[entry]} onOpen={ignoreOpen} />);
      const row = view.getByRole("button", { description: "View Add money details" });
      expect(row.textContent).toContain("Today");
      expect(view.queryByRole("button", { name: /Action needed/ })).toBeNull();
      expect(view.getByRole("list", { name: "Pending" })).toBeTruthy();
      view.rerender(<ActivityLedgerDetailSheet item={entry} open
        onDismiss={ignoreOpen} onAction={ignoreOpen} />);
      const dialog = view.getByRole("dialog");
      expect(within(dialog).getByText("Pending")).toBeTruthy();
      expect(within(dialog).queryByText("Action needed")).toBeNull();
      expect(within(dialog).getAllByRole("button")).toHaveLength(2);
      expect(within(dialog).queryByRole("button", { name: /Continue payment|Try again/ })).toBeNull();
    });
  }
  test("sheet badges distinguish actionable waits, pending waits and ambiguous checks", () => {
    const view = render(<ActivityLedgerDetailSheet item={funding} open
      onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    expect(within(view.getByRole("dialog")).getByText("Pending")).toBeTruthy();
    for (const status of ["waiting-provider", "waiting-chain", "waiting-home"] as const) {
      view.rerender(<ActivityLedgerDetailSheet item={{ ...funding, status }} open
        onDismiss={ignoreOpen} onAction={ignoreOpen} />);
      expect(within(view.getByRole("dialog")).getByText("Pending")).toBeTruthy();
    }
    view.rerender(<ActivityLedgerDetailSheet item={{ ...funding, status: "ambiguous", nextAction: undefined }} open
      onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    expect(within(view.getByRole("dialog")).getByText("Unconfirmed")).toBeTruthy();
    expect(within(view.getByRole("dialog")).getAllByRole("button")).toHaveLength(2);
    expect(within(view.getByRole("dialog")).getByRole("button", { name: /Copy order-1/ })).toBeTruthy();
  });
  test("caller status labels replace row words and sheet badge; declined card has no next action", () => {
    const card: ActivityLedgerItem = { ...item, family: "card",
      detail: { family: "card", merchant: "Shop", cardLabel: "Home Card" }, status: "failed",
      nextAction: { kind: "retry", label: "Try again" } };
    const view = render(<ActivityLedger items={[card]} onOpen={ignoreOpen} />);
    expect(view.getByRole("list").textContent).toContain("Declined");
    view.rerender(<ActivityLedgerDetailSheet item={card} open onDismiss={ignoreOpen}
      onAction={ignoreOpen} />);
    expect(within(view.getByRole("dialog")).getByText("Declined")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
    view.rerender(<><ActivityLedger items={[{ ...funding, dateLabel: "Heute", statusLabel: "Bitte handeln" }]}
      onOpen={ignoreOpen} /><ActivityLedgerDetailSheet item={{ ...funding, statusLabel: "Bitte handeln" }}
      open onDismiss={ignoreOpen} onAction={ignoreOpen} /></>);
    expect(view.container.querySelector("ul")?.textContent).toContain("Heute · Bitte handeln");
    expect(within(view.getByRole("dialog")).getByText("Bitte handeln")).toBeTruthy();
    view.rerender(<><ActivityLedger items={[{ ...funding, nextAction: undefined,
      statusLabel: "Bitte handeln" }]} onOpen={ignoreOpen} />
      <ActivityLedgerDetailSheet item={{ ...funding, nextAction: undefined,
        statusLabel: "Bitte handeln" }} open onDismiss={ignoreOpen} onAction={ignoreOpen} /></>);
    expect(view.container.querySelector("ul")?.textContent).toContain("Today · Bitte handeln");
    expect(within(view.getByRole("dialog")).getByText("Bitte handeln")).toBeTruthy();
    expect(within(view.getByRole("dialog")).queryByRole("button", { name: "Continue payment" })).toBeNull();
  });
  test("groups needs-customer first, preserves within-group order and labels both lists", () => {
    const reversed: ActivityLedgerItem = { ...funding, id: "reversed", family: "cash-out-order",
      detail: { family: "cash-out-order", provider: "Peer", payoutMethod: "Bank", orderId: "reversed" },
      status: "reversed", title: "Returned funds",
      nextAction: { kind: "withdraw-returned-funds", label: "Withdraw" } };
    const entries: ActivityLedgerItem[] = [
      { ...item, id: "done" },
      { ...funding, id: "provider", status: "waiting-provider", title: "Provider" },
      { ...reversed, nextAction: undefined, id: "no-action", title: "Returned without action" },
      { ...item, id: "failed", status: "failed", title: "Failed entry" },
      funding, reversed,
      { ...item, id: "expired", status: "expired", title: "Expired entry" },
      { ...item, id: "ambiguous", status: "ambiguous", title: "Checking" },
    ];
    const view = render(<ActivityLedger items={entries} onOpen={ignoreOpen} />);
    expect(view.getByRole("heading", { name: "Pending" })).toBeTruthy();
    expect(view.getByRole("heading", { name: "Recent" })).toBeTruthy();
    const pending = within(view.getByRole("list", { name: "Pending" })).getAllByRole("button");
    const recent = within(view.getByRole("list", { name: "Recent" })).getAllByRole("button");
    for (const [index, title] of ["Add money", "Returned funds", "Provider", "Checking"].entries()) {
      expect(pending[index]?.textContent).toContain(title);
    }
    expect(within(view.getByRole("list", { name: "Pending" }))
      .getAllByRole("button", { name: /Action needed/ })).toEqual(pending.slice(0, 2));
    expect(within(view.getByRole("list", { name: "Recent" }))
      .queryByRole("button", { name: /Action needed/ })).toBeNull();
    expect(pending[0]?.textContent).toContain("Today");
    expect(pending[0]?.textContent).not.toContain(" · ");
    expect(pending[1]?.textContent).toContain("Today · Reversed");
    expect(pending[3]?.textContent).toContain("Today");
    expect(pending[3]?.textContent).not.toContain(" · ");
    expect(pending[0]?.closest('[data-slot="card"]')).not.toBe(recent[0]?.closest('[data-slot="card"]'));
    expect(recent.map((row) => row.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("Returned without action"), expect.stringContaining("Failed entry"),
      expect.stringContaining("Expired entry"),
    ]));
    expect(recent[1]?.textContent).toContain("Reversed");
    view.rerender(<ActivityLedger items={[item]} onOpen={ignoreOpen} />);
    expect(view.getAllByRole("list")).toHaveLength(1);
    expect(view.queryByRole("heading", { name: "Pending" })).toBeNull();
    expect(view.queryByRole("heading", { name: "Recent" })).toBeNull();
    view.rerender(<ActivityLedger items={[funding, item]} pendingLabel="Ausstehend"
      recentLabel="Zuletzt" onOpen={ignoreOpen} />);
    expect(view.getByRole("list", { name: "Ausstehend" })).toBeTruthy();
    expect(view.getByRole("list", { name: "Zuletzt" })).toBeTruthy();
  });
  test("announces attention only for allowed customer actions, including reversed withdrawals", () => {
    const reversed: ActivityLedgerItem = { ...funding, family: "cash-out-order", id: "returned",
      status: "reversed", title: "Returned funds",
      detail: { family: "cash-out-order", provider: "Peer", payoutMethod: "Bank", orderId: "returned" },
      nextAction: { kind: "withdraw-returned-funds", label: "Withdraw" } };
    const view = render(<ActivityLedger items={[
      funding, { ...funding, id: "missing", title: "Missing action", nextAction: undefined },
      { ...funding, id: "invalid", title: "Disallowed action",
        nextAction: { kind: "retry", label: "Retry" } }, reversed,
      { ...reversed, id: "invalid-reversal", title: "Disallowed withdrawal",
        nextAction: { kind: "resume", label: "Resume" } },
      { ...reversed, id: "missing-reversal", title: "Missing withdrawal", nextAction: undefined },
    ]} attentionLabel="Intervention requise" onOpen={ignoreOpen} />);
    expect(view.getAllByRole("button", { name: /Intervention requise/ })).toEqual([
      view.getByRole("button", { description: "View Add money details" }),
      view.getByRole("button", { description: "View Returned funds details" }),
    ]);
    expect(view.getByRole("button", { description: "View Returned funds details" }).textContent)
      .toContain("Today · Reversed");
    for (const title of ["Missing action", "Disallowed action", "Disallowed withdrawal", "Missing withdrawal"]) {
      const row = view.getByRole("button", { description: `View ${title} details` });
      expect(view.getAllByRole("button", { name: /Intervention requise/ })).not.toContain(row);
    }
  });
  test("loads in the last card when both groups are rendered", () => {
    const view = render(<ActivityLedger items={[funding, item]} onOpen={ignoreOpen} sources={[
      { id: "funding", label: "Funding orders", status: "loading", onRetry: ignoreOpen },
    ]} />);
    const pendingCard = view.getByRole("list", { name: "Pending" }).closest('[data-slot="card"]');
    const recentCard = view.getByRole("list", { name: "Recent" }).closest('[data-slot="card"]');
    expect(pendingCard).not.toBe(recentCard);
    expect(pendingCard?.querySelector('[aria-busy="true"]')).toBeNull();
    expect(recentCard?.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    view.rerender(<ActivityLedger items={[funding]} onOpen={ignoreOpen} sources={[
      { id: "funding", label: "Funding orders", status: "loading", onRetry: ignoreOpen },
    ]} />);
    expect(view.getByRole("list", { name: "Pending" }).closest('[data-slot="card"]')
      ?.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
  });
  test("deduplicates only exact family and ID pairs", () => {
    const view = render(<ActivityLedger items={[item, { ...item, title: "duplicate" }, { ...item, id: "another" }]}
      onOpen={ignoreOpen} />);
    expect(rows(view)).toHaveLength(2);
    expect(view.queryByText("duplicate")).toBeNull();
  });
  test("keeps records from different families that share a raw ID", () => {
    const sameRawId = { ...funding, id: item.id, title: "Funding order" };
    const view = render(<ActivityLedger items={[item, sameRawId]} onOpen={ignoreOpen} />);
    expect(rows(view)).toHaveLength(2);
    expect(view.getByText("Funding order")).toBeTruthy();
  });
  test("confirmed snapshot supersedes waiting funding without a pending heading", () => {
    const confirmed = { ...funding, status: "confirmed" as const, title: "Added money", nextAction: undefined };
    const open = mock(() => undefined);
    const view = render(<ActivityLedger items={[funding, item, confirmed]} onOpen={open} />);
    expect(view.queryByRole("heading", { name: "Pending" })).toBeNull();
    const rendered = rows(view);
    expect(rendered).toHaveLength(2);
    expect(rendered[0]?.textContent).toContain("Added money");
    expect(view.queryByRole("button", { name: /Action needed/ })).toBeNull();
    fireEvent.click(rendered[0]!);
    expect(open).toHaveBeenCalledWith(confirmed, rendered[0]);
  });
  test("newer updatedAt selects a waiting snapshot regardless of input order", () => {
    const older = { ...funding, updatedAt: "2026-09-23T12:00:00.000Z", title: "Older order" };
    const newer = { ...funding, updatedAt: "2026-09-24T12:00:00.000Z", title: "Newer order" };
    const open = mock(() => undefined);
    for (const entries of [[older, newer], [newer, older]]) {
      const view = render(<ActivityLedger items={entries} onOpen={open} />);
      expect(view.getByRole("list", { name: "Pending" }).textContent).toContain("Newer order");
      expect(view.queryByText("Older order")).toBeNull();
      const row = view.getByRole("button", { description: "View Newer order details" });
      fireEvent.click(row);
      expect(open).toHaveBeenLastCalledWith(newer, row);
      view.unmount();
    }
    expect(open).toHaveBeenCalledTimes(2);
  });
  test("unparseable updatedAt counts as missing so a later stage supersedes it", () => {
    const view = render(<ActivityLedger items={[{ ...funding, updatedAt: "not-a-date" },
      { ...funding, status: "confirmed", title: "Added money", nextAction: undefined }]}
      onOpen={ignoreOpen} />);
    expect(view.queryByRole("heading", { name: "Pending" })).toBeNull();
    expect(rows(view)[0]?.textContent).toContain("Added money");
    expect(view.queryByRole("button", { name: /Action needed/ })).toBeNull();
  });
  test("equal snapshot times use lifecycle rank and an updatedAt beats a missing one", () => {
    const updatedAt = "2026-09-24T12:00:00.000Z";
    const snapshots = [
      { ...funding, updatedAt, title: "Waiting" },
      { ...funding, updatedAt, status: "ambiguous" as const, title: "Checking" },
      { ...funding, updatedAt, status: "failed" as const, title: "Failed" },
      { ...funding, updatedAt, status: "refunded" as const, title: "Refunded" },
      { ...funding, updatedAt, status: "reversed" as const, title: "Reversed" },
    ];
    const view = render(<ActivityLedger items={snapshots} onOpen={ignoreOpen} />);
    expect(rows(view)[0]?.textContent).toContain("Refunded");
    expect(view.queryByText("Reversed")).toBeNull();
    view.rerender(<ActivityLedger items={[{ ...funding, status: "refunded", title: "Undated" },
      snapshots[0]!]} onOpen={ignoreOpen} />);
    expect(rows(view)[0]?.textContent).toContain("Waiting");
    expect(view.queryByText("Undated")).toBeNull();
  });
  test("newer updatedAt wins over a later lifecycle stage", () => {
    const older = { ...funding, status: "confirmed" as const,
      updatedAt: "2026-09-23T12:00:00.000Z", title: "Added money", nextAction: undefined };
    const newer = { ...funding, updatedAt: "2026-09-24T12:00:00.000Z" };
    const view = render(<ActivityLedger items={[older, newer]} onOpen={ignoreOpen} />);
    expect(view.getByRole("button", { name: /Action needed/ })).toBe(rows(view)[0]);
    expect(view.queryByText("Added money")).toBeNull();
  });
  test("owner defaults appear only for chain and ambiguous, never settled", () => {
    const view = render(<ActivityLedgerDetailSheet item={{ ...funding, status: "waiting-provider" }} open
      onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    expect(within(view.getByRole("dialog")).queryByRole("alert")).toBeNull();
    view.rerender(<ActivityLedgerDetailSheet item={{ ...item, status: "waiting-chain" }} open
      onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    expect(within(view.getByRole("dialog")).getByText("Still sending")).toBeTruthy();
    expect(within(view.getByRole("dialog")).getByText("No need to send it again.")).toBeTruthy();
    view.rerender(<ActivityLedgerDetailSheet item={{ ...item, ownerSentence: { title: "Hidden" } }} open
      onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    expect(within(view.getByRole("dialog")).queryByRole("alert")).toBeNull();
  });
  test("row opens shared detail, invokes allowed callback and restores exact focus", async () => {
    const onAction = mock(() => undefined);
    const view = render(<Composition onAction={onAction} />);
    expect(view.queryByRole("dialog")).toBeNull();
    const row = view.getByRole("button", { description: /View Add money details/ });
    row.focus();
    await act(async () => fireEvent.click(row));
    const dialog = view.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Continue payment" })).toBeTruthy();
    expect(within(dialog).queryByText(/Block|Token contract|action id|matched confirmation/i)).toBeNull();
    expect(view.container.querySelector("[data-money-action-id]")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue payment" }));
    expect(onAction).toHaveBeenCalledWith(funding, "complete-payment");
    expect(onAction).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Close Add money details" })));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row));
  });
  test("keeps last item details when selection clears before the sheet closes", () => {
    const view = render(<ActivityLedgerDetailSheet item={funding} open
      onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    view.rerender(<ActivityLedgerDetailSheet item={null} open
      onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    const dialog = view.getByRole("dialog");
    expect(within(dialog).getByText("Add money")).toBeTruthy();
    expect(within(dialog).getByText("$50.00")).toBeTruthy();
  });
  test("dismiss and transition completion have separate callbacks", async () => {
    const onDismiss = mock(() => undefined);
    const onClosed = mock(() => undefined);
    function Sheet() {
      const [isOpen, setIsOpen] = useState(true);
      return <ActivityLedgerDetailSheet item={isOpen ? funding : null} open={isOpen}
        onDismiss={() => { onDismiss(); setIsOpen(false); }} onClosed={onClosed}
        onAction={() => undefined} />;
    }
    const view = render(<Sheet />);
    fireEvent.click(within(view.getByRole("dialog"))
      .getByRole("button", { name: "Close Add money details" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
  test("keeps a silent status region when no source is loading", () => {
    const view = render(<ActivityLedger items={[item]} onOpen={ignoreOpen} />);
    const status = view.getByRole("status");
    expect(status.textContent).toBe("");
    view.rerender(<ActivityLedger items={[item]} onOpen={ignoreOpen} sources={[
      { id: "funding", label: "Funding orders", status: "loading", onRetry: ignoreOpen },
    ]} />);
    expect(view.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Loading recent activity…");
    view.rerender(<ActivityLedger items={[item]} onOpen={ignoreOpen} />);
    expect(view.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("");
  });
  test("shows loading within the rows card while another source loads", () => {
    const view = render(<ActivityLedger items={[item]} onOpen={ignoreOpen} sources={[
      { id: "funding", label: "Funding orders", status: "loading", onRetry: ignoreOpen },
    ]} />);
    const list = view.getByRole("list");
    const card = list.closest('[data-slot="card"]');
    expect(card).toBeTruthy();
    expect(card?.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    expect(card?.querySelector('[aria-busy="true"]')?.previousElementSibling).toBe(list);
    expect(view.getByRole("status").textContent).toBe("Loading recent activity…");
    expect(view.queryByText("No activity yet")).toBeNull();
  });
  test("shows loading alongside source errors when there are no rows", () => {
    const view = render(<ActivityLedger items={[]} onOpen={ignoreOpen} sources={[
      { id: "cash-out", label: "Cash out orders", status: "error", onRetry: ignoreOpen },
      { id: "funding", label: "Funding orders", status: "loading", onRetry: ignoreOpen },
    ]} />);
    expect(view.getByText("Cash out orders unavailable")).toBeTruthy();
    expect(view.getByText("Loading recent activity…")).toBeTruthy();
    expect(view.queryByText("No activity yet")).toBeNull();
  });
  test("keeps partial rows and retries only the failed source", () => {
    const retry = mock(() => undefined);
    const view = render(<ActivityLedger items={[item]} onOpen={ignoreOpen}
      sources={[{ id: "cash-out", label: "Cash out orders", status: "error", onRetry: retry }]} />);
    expect(view.getByRole("list")).toBeTruthy();
    expect(view.getByText("Cash out orders unavailable")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Reload Cash out orders" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  test("omits an operation fact that repeats the title", () => {
    const action: ActivityLedgerItem = { ...item, id: "action-1", family: "home-action", status: "failed",
      title: "Deposit to Savings",
      detail: { family: "home-action", operation: "Deposit to Savings", from: "Cash", network: "Base" } };
    const view = render(<ActivityLedgerDetailSheet item={action} open onDismiss={ignoreOpen}
      onAction={ignoreOpen} />);
    const dialog = view.getByRole("dialog");
    expect(within(dialog).queryByText("Operation")).toBeNull();
    expect(within(dialog).getByText("From")).toBeTruthy();
    view.rerender(<ActivityLedgerDetailSheet item={{ ...action, detail: { ...action.detail,
      operation: "Deposit" } as typeof action.detail }} open onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    expect(within(view.getByRole("dialog")).getByText("Operation")).toBeTruthy();
  });
});
