import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AssetRow, BalanceRow, type FinanceRowAction } from "./finance-rows";

function FinanceRowActions({ onAction, onIntent, onActivate, onRetry, width = 390 }: {
  onAction: FinanceRowAction["onAction"];
  onIntent: () => void;
  onActivate: () => void;
  onRetry: () => void;
  width?: number;
}) {
  return (
    <ul className="list-none p-0" style={{ width, maxWidth: "100%" }}>
      <AssetRow icon="X" label="XRP" context="Crypto · Available to buy" value="$2.40"
        action={{ label: "Buy", accessibleLabel: "Buy XRP", onAction, onIntent }} />
      <AssetRow icon="X" label="An exceptionally long asset name that needs to truncate gracefully" context="Crypto"
        action={{ label: "Buy", accessibleLabel: "Buy long asset", onAction }} />
      <AssetRow icon="X" label="Two-line context" context="Available on Base and other supported networks with more details"
        contextLines={2} value="$24.00" valueContext="USD"
        action={{ label: "Buy", accessibleLabel: "Buy two-line asset", onAction }} />
      <AssetRow icon="X" label="Pending" context="Preparing" action={{ label: "Buy", accessibleLabel: "Buy pending asset", onAction, pending: true }} />
      <AssetRow icon="X" label="Disabled" context="Not available" action={{ label: "Buy", accessibleLabel: "Buy disabled asset", onAction, disabled: true }} />
      <BalanceRow icon="$" label="Cash" context="Savings" value="$30.01" onActivate={onActivate} />
      <BalanceRow icon="$" label="Invest" context="Unavailable" value="—"
        onActivate={onActivate} readRetry={{ label: "Retry balance", onRetry }} />
    </ul>
  );
}

const meta = {
  id: "ui-finance-rows-action",
  title: "UI/Finance Rows Action",
  component: FinanceRowActions,
  args: { onAction: fn(), onIntent: fn(), onActivate: fn(), onRetry: fn(), width: 390 },
  parameters: { layout: "centered" },
} satisfies Meta<typeof FinanceRowActions>;

export default meta;
type Story = StoryObj<typeof meta>;

function rect(element: Element | null): DOMRect {
  if (!element) throw new Error("Finance row element missing");
  return element.getBoundingClientRect();
}

async function verifyLayout(canvasElement: HTMLElement) {
  const rows = [...canvasElement.querySelectorAll("li")];
  await expect(rows).toHaveLength(7);
  for (const row of rows.slice(0, 5)) {
    const button = row.querySelector("button");
    await expect(button).not.toBeNull();
    const rowBox = rect(row.querySelector("[data-slot=item]"));
    const actionBox = rect(button);
    await expect(Math.abs((rowBox.top + rowBox.bottom) / 2 - (actionBox.top + actionBox.bottom) / 2)).toBeLessThanOrEqual(1);
    const titleBox = rect(row.querySelector("[data-slot=finance-row-body] [data-slot=item-title]"));
    await expect(titleBox.right).toBeLessThanOrEqual(actionBox.left + 1);
  }
}

export const NarrowMobile: Story = {
  args: { width: 320 },
  play: async ({ args, canvasElement }) => {
    await verifyLayout(canvasElement);
    const row = canvasElement.querySelector("li");
    if (!row) throw new Error("Action row missing");
    const button = within(row).getByRole("button", { name: "Buy XRP" });
    await expect(within(row).getAllByRole("button")).toHaveLength(1);
    await userEvent.click(button);
    await expect(args.onAction).toHaveBeenCalledTimes(1);
    await expect(args.onAction).toHaveBeenCalledWith(button);
    await expect(args.onActivate).not.toHaveBeenCalled();
  },
};

export const WideDesktop: Story = {
  args: { width: 560 },
  play: async ({ args, canvasElement }) => {
    await verifyLayout(canvasElement);
    const button = within(canvasElement).getByRole("button", { name: "Buy XRP" });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onAction).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(" ");
    await expect(args.onAction).toHaveBeenCalledTimes(2);
    await expect(args.onActivate).not.toHaveBeenCalled();
  },
};

export const StandardMobile: Story = {
  args: { width: 390 },
  play: async ({ canvasElement }) => verifyLayout(canvasElement),
};
