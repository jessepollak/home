import "@/client/account/dom-test-harness";
import { useRef, useState } from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type {
  ActivityLedgerItem, ActivityLedgerStatus, ActivityLedgerFamily, ActivityLedgerNextActionKind,
} from "./activity-ledger";
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { ActivityLedger, isActivityLedgerNextActionAllowed } = await import("./activity-ledger");
const { ActivityLedgerDetailSheet } = await import("./activity-ledger-sheet");
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
  "clear-order", "withdraw-returned-funds", "cancel-cash-out",
];
const statusActions: Record<ActivityLedgerStatus, ActivityLedgerNextActionKind[]> = {
  "waiting-customer": ["resume", "resume-verification", "complete-payment"],
  "waiting-provider": ["cancel-cash-out"], "waiting-chain": [], "waiting-home": [], confirmed: [],
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
  test("fails closed across status, family and action kind", () => {
    for (const status of statuses) for (const family of families) for (const kind of kinds) {
      const expected = family !== "card" && statusActions[status].includes(kind) &&
        (!["resume-verification", "complete-payment", "clear-order"].includes(kind) || family === "funding-order") &&
        (kind !== "withdraw-returned-funds" || family === "cash-out-order") &&
        (kind !== "cancel-cash-out" || family === "cash-out-order" || family === "home-action");
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
      expect(row.querySelector("time")?.getAttribute("datetime")).toBe(item.timestamp);
      if (index === 0) expect(view.getByRole("button", { name: /Action needed/ })).toBe(row);
      else expect(view.queryAllByRole("button", { name: /Action needed/ })).toHaveLength(1);
      expect(row.querySelector("[title]")?.getAttribute("title"))
        .toBe(`Today${word ? ` · ${word}` : ""}`);
    }
    view.rerender(<ActivityLedger items={[{ ...item, direction: "out", amount: "−$200.00" }]}
      onOpen={ignoreOpen} />);
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
  test("pending Home action sheet shows submitted and confirming stages", () => {
    const action: ActivityLedgerItem = {
      ...item, family: "home-action", status: "waiting-chain", title: "Send USDC",
      steps: [
        { status: "complete", title: "Submitted", time: "Sep 15, 12:00 PM" },
        { status: "current", title: "Confirming on Base" },
      ],
      detail: { family: "home-action", operation: "Send", network: "Base" },
    };
    const view = render(<ActivityLedgerDetailSheet item={action} open
      onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    const stages = within(view.getByRole("dialog")).getAllByRole("listitem");
    expect(stages).toHaveLength(2);
    expect(stages[0]?.textContent).toContain("Complete: Submitted");
    expect(stages[0]?.textContent).toContain("Sep 15, 12:00 PM");
    expect(stages[1]?.textContent).toContain("In progress: Confirming on Base");
  });
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
    expect(view.getByRole("list", { hidden: true }).textContent).toContain("Heute");
    expect(view.getByRole("list", { hidden: true }).textContent).not.toContain("Bitte handeln");
    expect(within(view.getByRole("dialog")).getByText("Bitte handeln")).toBeTruthy();
    view.rerender(<><ActivityLedger items={[{ ...funding, nextAction: undefined,
      statusLabel: "Bitte handeln" }]} onOpen={ignoreOpen} />
      <ActivityLedgerDetailSheet item={{ ...funding, nextAction: undefined,
        statusLabel: "Bitte handeln" }} open onDismiss={ignoreOpen} onAction={ignoreOpen} /></>);
    expect(view.getByRole("list", { hidden: true }).textContent).toContain("Today");
    expect(view.getByRole("list", { hidden: true }).textContent).not.toContain("Bitte handeln");
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
  test("groups every status by pending lifecycle, not by available retry", () => {
    const entries = statuses.map((status, index): ActivityLedgerItem => ({
      ...item, id: `status-${index}`, status, title: `Status ${index}`,
    }));
    const view = render(<ActivityLedger items={entries} onOpen={ignoreOpen} />);
    expect(within(view.getByRole("list", { name: "Pending" })).getAllByRole("button")
      .map((row) => row.textContent)).toEqual([
      expect.stringContaining("Status 0"), expect.stringContaining("Status 1"),
      expect.stringContaining("Status 2"), expect.stringContaining("Status 3"),
      expect.stringContaining("Status 7"),
    ]);
    expect(within(view.getByRole("list", { name: "Recent" })).getAllByRole("button")
      .map((row) => row.textContent)).toEqual([
      expect.stringContaining("Status 4"), expect.stringContaining("Status 5"),
      expect.stringContaining("Status 6"), expect.stringContaining("Status 8"),
      expect.stringContaining("Status 9"),
    ]);
  });
  test("feed layout leaves cards to its host and labels both groups; footer follows the last list", () => {
    const view = render(<ActivityLedger layout="feed" items={[funding, item]}
      footer={<button type="button">See all activity</button>} onOpen={ignoreOpen} />);
    const pending = view.getByRole("list", { name: "Pending" });
    const recent = view.getByRole("list", { name: "Recent" });
    const footer = view.getByRole("button", { name: "See all activity" });
    expect(pending.closest("[data-slot=card]")).toBeNull();
    expect(recent.closest("[data-slot=card]")).toBeNull();
    expect(recent.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.rerender(<ActivityLedger layout="feed" items={[funding]}
      footer={<button type="button">See all activity</button>} onOpen={ignoreOpen} />);
    expect(view.queryByRole("heading", { name: "Recent" })).toBeNull();
    expect(view.getByRole("list", { name: "Pending" }).compareDocumentPosition(
      view.getByRole("button", { name: "See all activity" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.rerender(<ActivityLedger layout="feed" items={[item]}
      footer={<button type="button">See all activity</button>} onOpen={ignoreOpen} />);
    expect(view.queryByRole("heading")).toBeNull();
    expect(view.getByRole("list").closest("[data-slot=card]")).toBeNull();
    view.rerender(<ActivityLedger items={[]} footer={<button type="button">See all activity</button>}
      onOpen={ignoreOpen} />);
    expect(view.queryByRole("list")).toBeNull();
    expect(view.getByRole("button", { name: "See all activity" })).toBeTruthy();
    view.rerender(<ActivityLedger items={[]} onOpen={ignoreOpen} />);
    expect(view.container.textContent).toBe("");
  });
  test("page footer is inside the last card in each group configuration", () => {
    const view = render(<ActivityLedger items={[funding, item]} footer={<p>See more</p>}
      onOpen={ignoreOpen} />);
    expect(view.getByText("See more").closest("[data-slot=card]"))
      .toBe(view.getByRole("list", { name: "Recent" }).closest("[data-slot=card]"));
    view.rerender(<ActivityLedger items={[funding]} footer={<p>See more</p>}
      onOpen={ignoreOpen} />);
    expect(view.getByText("See more").closest("[data-slot=card]"))
      .toBe(view.getByRole("list", { name: "Pending" }).closest("[data-slot=card]"));
    view.rerender(<ActivityLedger items={[item]} footer={<p>See more</p>}
      onOpen={ignoreOpen} />);
    expect(view.getByText("See more").closest("[data-slot=card]"))
      .toBe(view.getByRole("list").closest("[data-slot=card]"));
  });
  test("passes the row amount context, optional mark image, and caller activation hint", () => {
    const open = mock(() => undefined);
    const entry: ActivityLedgerItem = { ...item, amount: "", amountContext: "0.3 USDC",
      activateLabel: "Inspect receipt", mark: { kind: "asset", symbol: "USDC", imageUrl: "/coin.svg" } };
    const view = render(<ActivityLedger items={[entry]} onOpen={open} />);
    const row = view.getByRole("button", { description: "Inspect receipt" });
    expect(within(row).getByText("0.3 USDC")).toBeTruthy();
    expect(row.textContent).not.toContain("+$200.00");
    expect(row.querySelector('img[src="/coin.svg"]')).toBeTruthy();
    fireEvent.click(row);
    expect(open).toHaveBeenCalledWith(entry, row);
  });
  test("detail amount and source facts precede the copyable transaction without excluded fields", () => {
    const excludedFields = {
      actionId: "hidden-action", tokenContract: "hidden-contract", blockNumber: "hidden-block",
    };
    const entry: ActivityLedgerItem = { ...item, detailAmount: "0.3 USDC", detail: {
      ...item.detail, ...excludedFields, facts: [{ label: "Asset", value: "USDC" }],
      transaction: { value: "0xabc", display: "0xabc" },
    } };
    const view = render(<ActivityLedgerDetailSheet item={entry} open
      onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    const dialog = view.getByRole("dialog");
    expect(within(dialog).getByText("0.3 USDC")).toBeTruthy();
    expect(within(dialog).queryByText("+$200.00")).toBeNull();
    const labels = within(dialog).getAllByRole("term").map((term) => term.textContent);
    expect(labels).toEqual(["Date", "From", "Network", "Asset", "Transaction"]);
    expect(within(dialog).queryByText(/action id|token contract|block number/i)).toBeNull();
    for (const excluded of ["hidden-action", "hidden-contract", "hidden-block"]) {
      expect(within(dialog).queryByText(excluded)).toBeNull();
    }
  });
  test("rows and sheets expose the full date and a copyable full counterparty address", async () => {
    const address = "0x2222222222222222222222222222222222222222";
    const entry: ActivityLedgerItem = { ...item, dateLabel: "Dec 31, 12:00 PM",
      fullDateLabel: "Dec 31, 2025, 12:00 PM",
      detail: { ...item.detail, family: "onchain-transfer", counterparty: address } };
    const list = render(<ActivityLedger items={[entry]} onOpen={ignoreOpen} />);
    const time = list.getByRole("button", { description: "View Received details" }).querySelector("time");
    expect(time?.textContent).toBe("Dec 31, 12:00 PM");
    expect(time?.getAttribute("aria-label")).toBe("Dec 31, 2025, 12:00 PM");
    list.unmount();
    const writeText = mock(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = render(<ActivityLedgerDetailSheet item={entry} open onDismiss={ignoreOpen}
      onAction={ignoreOpen} />);
    const dialog = view.getByRole("dialog");
    expect(within(dialog).getByText("Dec 31, 2025, 12:00 PM")).toBeTruthy();
    expect(within(dialog).getByText("0x2222…222222")).toBeTruthy();
    const copy = within(dialog).getByRole("button", { name: "Copy 0x2222…222222" });
    expect(copy.getAttribute("title")).toBe(address);
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(address));
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
    view.rerender(<ActivityLedgerDetailSheet item={{ ...action, detail: {
      family: "home-action", operation: "Deposit", network: "Base",
      facts: [{ label: "Asset", value: "USDC" }],
      transaction: { value: "0xabc", display: "0xabc" },
    } }} open onDismiss={ignoreOpen} onAction={ignoreOpen} />);
    expect(within(view.getByRole("dialog")).getAllByRole("term")
      .map((term) => term.textContent)).toEqual([
      "Date", "Operation", "Network", "Asset", "Transaction",
    ]);
  });
});
