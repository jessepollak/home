import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { BalanceRow } = await import("./finance-rows");

afterEach(cleanup);

describe("FinanceRow read retry", () => {
  test("is reachable after the row and invokes only the read callback by mouse and keyboard", () => {
    const onRetry = mock(() => undefined);
    const onActivate = mock(() => undefined);
    const view = render(
      <ul><BalanceRow icon="$" label="Cash" context="Savings" value="Unavailable"
        onActivate={onActivate} readRetry={{ label: "Retry Cash balance", onRetry }} />
      </ul>,
    );
    const row = view.getAllByRole("button")[0]!;
    const retry = view.getByRole("button", { name: "Retry Cash balance" });
    expect(retry.closest("button:not([aria-label='Retry Cash balance'])")).toBeNull();
    expect(row.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.querySelector("[data-slot=item-actions]")?.querySelectorAll("svg")).toHaveLength(0);
    fireEvent.click(retry);
    retry.focus();
    expect(document.activeElement).toBe(retry);
    fireEvent.click(retry, { detail: 0 });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onActivate).not.toHaveBeenCalled();
  });

  test("works without a row activation button", () => {
    const onRetry = mock(() => undefined);
    const view = render(<ul><BalanceRow icon="$" label="Cash" value="Unavailable"
      readRetry={{ label: "Retry Cash balance", onRetry }} /></ul>);
    expect(view.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(view.getByRole("button", { name: "Retry Cash balance" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
