import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { page } from "@/tests/helpers/dom";

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { moneyResultCopy, MoneyResult, MoneyResultFooter } = await import("./money-result");
afterEach(cleanup);

const kinds = ["send", "cash-out", "cash-out-withdraw", "savings-deposit", "savings-withdraw", "supply-collateral", "borrow", "supply-and-borrow", "repay", "repay-all", "withdraw-collateral", "close-position"] as const;

describe("truthful money result copy", () => {
  test("keeps amount and stage in send and Save titles", () => {
    expect(moneyResultCopy({ kind: "send", amount: "$25.00", outcome: "success" }).title).toBe("$25.00 sent");
    expect(moneyResultCopy({ kind: "send", amount: "$25.00", outcome: "pending" }).title).toBe("$25.00 on its way");
    expect(moneyResultCopy({ kind: "send", amount: "$25.00", outcome: "failed" })).toEqual({ title: "$25.00 wasn't sent", description: "Your $25.00 is still in your account." });
    expect(moneyResultCopy({ kind: "savings-deposit", amount: "$25.00", outcome: "success" }).title).toBe("Deposited $25.00 to Save");
    expect(moneyResultCopy({ kind: "savings-deposit", amount: "$25.00", outcome: "pending" }).title).toBe("Depositing $25.00 to Save");
    expect(moneyResultCopy({ kind: "savings-deposit", amount: "$25.00", outcome: "failed" }).title).toBe("Deposit didn't go through");
    expect(moneyResultCopy({ kind: "savings-withdraw", amount: "$25.00", outcome: "success" }).title).toBe("Withdrew $25.00 from Save");
    expect(moneyResultCopy({ kind: "savings-withdraw", amount: "$25.00", outcome: "pending" }).title).toBe("Withdrawing $25.00 from Save");
    expect(moneyResultCopy({ kind: "savings-withdraw", amount: "$25.00", outcome: "failed" })).toEqual({ title: "Withdrawal didn't go through", description: "Your $25.00 is still in Save." });
  });
  test("cash-out success makes no promise that the provider delivered its payout", () => {
    expect(moneyResultCopy({ kind: "cash-out", amount: "$25.00", provider: "Peer", outcome: "success" }).description).toBe("Peer sends the payout next. Track it in Activity.");
  });
  test("cash-out withdrawal describes funds returning to the account, never a payout", () => {
    const copy = (outcome: "success" | "pending" | "failed" | "unknown") => moneyResultCopy({ kind: "cash-out-withdraw", amount: "$25.00", provider: "Peer", outcome });
    expect(copy("success")).toEqual({ title: "$25.00 returned to your account" });
    expect(copy("pending").title).toBe("Returning $25.00 to your account");
    expect(copy("failed")).toEqual({ title: "Withdrawal didn't go through", description: "Your $25.00 is still in your Peer cash-out." });
    expect(copy("unknown").description).toBe("It may have gone through. Check Activity before trying again.");
    for (const outcome of ["success", "pending", "failed", "unknown"] as const) expect(JSON.stringify(copy(outcome))).not.toMatch(/payout|cashing out|sent to cash out|left your account/i);
  });
  test("Borrow operations name the action without implying an unobserved balance change", () => {
    expect(moneyResultCopy({ kind: "borrow", amount: "$25.00", outcome: "success" }).title).toBe("Borrowed $25.00");
    expect(moneyResultCopy({ kind: "repay", amount: "$25.00", outcome: "pending" }).title).toBe("Repaying $25.00");
    expect(moneyResultCopy({ kind: "repay", amount: "$25.00", outcome: "failed" })).toEqual({ title: "Repayment didn't go through", description: "Your Borrow position didn't change." });
    expect(moneyResultCopy({ kind: "close-position", outcome: "success" }).title).toBe("Closed Borrow position");
    expect(moneyResultCopy({ kind: "repay-all", outcome: "success" }).title).not.toContain("the amount");
  });
  test("unknown is never mistaken for failure across all operations", () => {
    for (const kind of kinds) {
      const copy = moneyResultCopy({ kind, amount: "$25.00", outcome: "unknown" });
      expect(`${copy.title} ${copy.description}`).not.toMatch(/failed|not sent|didn't go through|try again/i);
      expect(copy.description).toContain("Check Activity before");
    }
  });
});

test("only pending shows two real status stages", () => {
  const view = render(<MoneyResult kind="send" amount="$25.00" outcome="pending" submittedAt="2026-09-23T10:35:00.000Z" />);
  expect(page().getAllByRole("listitem")).toHaveLength(2);
  expect(page().getByText("Submitted")).toBeTruthy();
  expect(page().getByText("Confirming on Base")).toBeTruthy();
  view.rerender(<MoneyResult kind="send" amount="$25.00" outcome="unknown" />);
  expect(page().queryByRole("listitem")).toBeNull();
});

test("footer only offers retry after definite failure", () => {
  const pressed: string[] = [];
  const props = { onDone: () => pressed.push("done"), onTryAgain: () => pressed.push("retry"), onViewActivity: () => pressed.push("activity") };
  const view = render(<MoneyResultFooter outcome="unknown" {...props} />);
  expect(page().queryByRole("button", { name: "Try again" })).toBeNull();
  fireEvent.click(page().getByRole("button", { name: "View in Activity" }));
  expect(pressed).toEqual(["activity"]);
  view.rerender(<MoneyResultFooter outcome="failed" {...props} />);
  fireEvent.click(page().getByRole("button", { name: "Try again" }));
  expect(pressed).toEqual(["activity", "retry"]);
  view.rerender(<MoneyResultFooter outcome="success" {...props} />);
  expect(page().getAllByRole("button")).toHaveLength(1);
  fireEvent.click(page().getByRole("button", { name: "Done" }));
  expect(pressed).toEqual(["activity", "retry", "done"]);
});
