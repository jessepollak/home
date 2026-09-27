import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { ActivityRow, AssetRow, BalanceRow } = await import("./finance-rows");

afterEach(cleanup);

describe("ActivityRow attention", () => {
  test("announces attention on the activation button and replaces the chevron icon", () => {
    const onActivate = mock(() => undefined);
    const view = render(<ul><ActivityRow icon="↓" label="Add money" context="Today"
      onActivate={onActivate} attention="Action needed" activateLabel="View details" /></ul>);
    const row = view.getByRole("button", { name: /Add money.*Action needed/ });
    expect(row.getAttribute("aria-describedby")).toBeTruthy();
    const actions = row.querySelector("[aria-hidden=true]:has(> svg)");
    expect(actions?.querySelectorAll("svg")).toHaveLength(1);
    expect(actions?.querySelector("svg circle")).toBeTruthy();
    fireEvent.click(row);
    expect(onActivate).toHaveBeenCalledWith(row);
  });
  test("without attention retains the usual activatable row and chevron", () => {
    const view = render(<ul><ActivityRow icon="↓" label="Received" context="Today"
      onActivate={() => undefined} activateLabel="View details" /></ul>);
    const row = view.getByRole("button", { name: "Received Today" });
    expect(row.querySelector("[aria-hidden=true]:has(> svg) svg circle")).toBeNull();
    expect(row.querySelectorAll("[aria-hidden=true]:has(> svg) svg")).toHaveLength(1);
    expect(view.queryByText("Action needed")).toBeNull();
  });
});

describe("FinanceRow disclosure", () => {
  test("keeps a generic suffix visible without duplicating its assistive description and scopes mark clipping", () => {
    const view = render(<ul>
      <ActivityRow icon="↓" iconTone="stack" label="Received" labelSuffix={<span aria-hidden="true">×4</span>}
        activateLabel="4 Received USDC transfers" onActivate={() => undefined} disclosure={{ expanded: false }} />
      <ActivityRow icon="↓" iconTone="mark" label="Sent" />
    </ul>);
    const summary = view.getByRole("button", { name: /Received/ });
    expect(summary.textContent).toContain("Received ×4");
    expect(view.queryByText("4 transfers")).toBeNull();
    expect(summary.getAttribute("aria-describedby")).toBeTruthy();
    expect(view.getByText("×4").getAttribute("aria-hidden")).toBe("true");
    expect(view.container.querySelector('[data-tone="mark"]')).toBeTruthy();
    expect(view.container.querySelector('[data-tone="stack"]')).toBeTruthy();
  });

  test("toggles native button semantics, preserves the hint and mounts children only when expanded", () => {
    const onActivate = mock(() => undefined);
    const row = (expanded: boolean) => <ul><ActivityRow icon="↓" label="Received USDC"
      context="2 transfers" onActivate={onActivate} activateLabel="Toggle transfers"
      disclosure={{ expanded, controls: "child-transfers", content: <ul id="child-transfers"><li>First transfer</li></ul> }}
    /></ul>;
    const view = render(row(false));
    const button = view.getByRole("button", { name: /Received USDC/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.hasAttribute("aria-controls")).toBe(false);
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    expect(view.queryByText("First transfer")).toBeNull();
    button.focus();
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledWith(button);
    view.rerender(row(true));
    expect(view.getByRole("button", { name: /Received USDC/ })).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe("child-transfers");
    expect(view.getByText("First transfer")).toBeTruthy();
    expect(document.activeElement).toBe(button);
    view.rerender(row(false));
    expect(view.queryByText("First transfer")).toBeNull();
    expect(button.hasAttribute("aria-controls")).toBe(false);
  });
});

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

describe("FinanceRow trailing action", () => {
  test("renders only the labeled action button and passes its element to the callback", () => {
    const onAction = mock((_opener: HTMLButtonElement) => undefined);
    const onIntent = mock(() => undefined);
    const view = render(<ul><AssetRow icon="X" label="XRP" context="Crypto" value="$2.40"
      action={{ label: "Buy", accessibleLabel: "Buy XRP", onAction, onIntent }} /></ul>);
    const button = view.getByRole("button", { name: "Buy XRP" });
    expect(view.getAllByRole("button")).toHaveLength(1);
    expect(button.textContent).toBe("Buy");
    expect(button.closest("[aria-hidden='true']")).toBeNull();
    expect(button.closest("[data-slot=item]")?.tagName).toBe("DIV");
    expect(button.closest("[data-slot=item-actions]")).not.toBeNull();
    fireEvent.pointerDown(button);
    fireEvent.focus(button);
    fireEvent.click(button);
    expect(onIntent).toHaveBeenCalledTimes(2);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(button);
  });

  test("pending and disabled actions cannot activate", () => {
    const onAction = mock(() => undefined);
    const view = render(<ul>
      <AssetRow icon="X" label="Pending" action={{ label: "Buy", accessibleLabel: "Buy pending", onAction, pending: true }} />
      <AssetRow icon="X" label="Disabled" action={{ label: "Buy", accessibleLabel: "Buy disabled", onAction, disabled: true }} />
    </ul>);
    const pending = view.getByRole("button", { name: "Buy pending" });
    const disabled = view.getByRole("button", { name: "Buy disabled" });
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.hasAttribute("disabled")).toBe(true);
    fireEvent.click(pending);
    fireEvent.click(disabled);
    expect(onAction).not.toHaveBeenCalled();
  });
});
