import "./../client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { TransactionDetails } from "./transaction-explorer";

const { cleanup, render, within } = await import("@testing-library/react");
const { TransactionDetailsModal } = await import("./transaction-details");

const FROM = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"a".repeat(64)}`;

function renderDetails(details: TransactionDetails) {
  const view = render(<TransactionDetailsModal open titleId="transaction-test-title" details={details} onClose={() => {}} />);
  return within(view.getByRole("dialog", { name: details.title }));
}

afterEach(() => {
  cleanup();
});

describe("transaction details", () => {
  test("exposes amount and status as terms, with decorative status and network marks", () => {
    const dialog = renderDetails({
      title: "Received TEST",
      header: { amount: "+5,678 TEST", tone: "success", status: { label: "Confirmed", tone: "success" } },
      rows: [
        { label: "Value", value: "+$12.34" },
        { label: "From", value: FROM, display: "0x1111…111111" },
        { label: "Token contract", value: TOKEN, display: "0x2222…222222" },
        { label: "Network", value: "Base", network: "base" },
        { label: "Transaction", value: HASH, display: "0xaaaa…aaaaaaaa" },
      ],
      explorer: { href: `https://basescan.org/tx/${HASH}`, label: "View on explorer" },
    });
    expect(dialog.getByText("Amount").tagName).toBe("DT");
    expect(dialog.getByText("Status").tagName).toBe("DT");
    expect(dialog.getByText("+5,678 TEST").tagName).toBe("DD");
    expect(dialog.getByText("Confirmed")).toBeTruthy();
    expect(dialog.getByText("Confirmed").getAttribute("data-status-tone")).toBe("success");
    expect(dialog.getByText("Confirmed").querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(dialog.queryByText("8453")).toBeNull();
    expect(dialog.getByText("Base")).toBeTruthy();
    const image = dialog.getByText("Base").querySelector("img");
    expect(image?.getAttribute("src")).toBe("/network-marks/base.svg");
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.getAttribute("aria-hidden")).toBe("true");
    expect(dialog.queryAllByRole("img")).toHaveLength(0);
    expect(dialog.queryByRole("list")).toBeNull();
    expect(dialog.getByRole("button", { name: "Copy 0x1111…111111" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Copy 0x2222…222222" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Copy 0xaaaa…aaaaaaaa" })).toBeTruthy();
    expect(dialog.getByRole("link", { name: "View on explorer" }).getAttribute("href")).toBe(`https://basescan.org/tx/${HASH}`);
    expect(dialog.queryByRole("img", { name: /Confirmed/ })).toBeNull();

    const content = dialog.getByText("Value").closest('[data-slot="card-content"][data-inset="list"]');
    expect(content).not.toBeNull();
    const list = content?.querySelector("dl") as HTMLElement;
    expect(list.tagName).toBe("DL");
    const pairs = [
      ["Value", "+$12.34"], ["From", "0x1111…111111"],
      ["Token contract", "0x2222…222222"], ["Network", "Base"],
      ["Transaction", "0xaaaa…aaaaaaaa"],
    ];
    expect(list.children).toHaveLength(pairs.length);
    for (const [index, [label, value]] of pairs.entries()) {
      const row = within(list.children[index] as HTMLElement);
      expect(row.getByRole("term").textContent).toBe(label);
      expect(row.getByRole("definition").textContent).toContain(value);
    }
  });

  test("renders pending receipt steps in an ordered standard block before receipt rows", () => {
    const dialog = renderDetails({
      title: "Pending transfer",
      steps: [
        { status: "complete", title: "Submitted", time: "Sep 8, 5:03 AM" },
        { status: "current", title: "Confirming on Base" },
      ],
      rows: [{ label: "Status", value: "Pending", statusTone: "pending" }],
      explorer: null,
    });

    const list = dialog.getByRole("list");
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Complete: Submitted");
    expect(items[0]?.textContent).toContain("Sep 8, 5:03 AM");
    expect(items[1]?.textContent).toContain("In progress: Confirming on Base");
    expect(list.closest('[data-slot="card-content"][data-inset="list"]')).not.toBeNull();
    const receipt = dialog.getByText("Status").closest("dl");
    expect(receipt).not.toBeNull();
    expect(list.compareDocumentPosition(receipt as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("renders operation status labels without a header", () => {
    for (const [label, tone] of [["Pending", "pending"], ["Failed", "failure"]] as const) {
      const dialog = renderDetails({
        title: `${label} transfer`,
        rows: [{ label: "Status", value: label, statusTone: tone }],
        explorer: null,
      });
      expect(dialog.getByText(label)).toBeTruthy();
      expect(dialog.getByText("Status").tagName).toBe("DT");
      expect(dialog.queryByText("Amount")).toBeNull();
      expect(dialog.queryByRole("list")).toBeNull();
      cleanup();
    }
  });
});
