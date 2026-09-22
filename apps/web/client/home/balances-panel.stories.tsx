import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import type { BalanceRowModel } from "@/shared/balances/present";
import { Card, CardContent } from "@/components/ui/card";
import { HomeBalanceRowView } from "./balances-list";
import { ShimmerRows } from "./panel-shared";

const normalRow = {
  key: "storybook-usd",
  group: "cash",
  name: "US dollar",
  mark: { kind: "flag", currency: "USD" },
  primary: "$12,345.67",
  secondary: null,
  tone: "default",
} satisfies BalanceRowModel;

const unavailableRow = {
  key: "storybook-eur-unavailable",
  group: "cash",
  name: "Euro",
  mark: { kind: "flag", currency: "EUR" },
  primary: "Unavailable",
  secondary: null,
  tone: "error",
} satisfies BalanceRowModel;

const longLabelLargeAmountRow = {
  key: "storybook-long-balance",
  group: "asset",
  name: "International diversified treasury reserve position",
  mark: { kind: "symbol", symbol: "RESERVE" },
  primary: "$123,456,789,012,345,678,901,234.56",
  secondary: "99,999,999,999 RESERVE",
  tone: "default",
} satisfies BalanceRowModel;

const testTokenRow = {
  key: "storybook-test-token",
  group: "asset",
  name: "Test Token",
  mark: { kind: "symbol", symbol: "TEST" },
  primary: "$123,456.78",
  secondary: "123.4567 TEST",
  tone: "default",
} satisfies BalanceRowModel;

const governanceTokenRow = {
  key: "storybook-governance-token",
  group: "asset",
  name: "Sample governance token",
  mark: { kind: "symbol", symbol: "TEST" },
  primary: "$123,456.78",
  secondary: "12,345,678 TEST",
  tone: "default",
} satisfies BalanceRowModel;

const longIdentityRow = {
  key: "storybook-long-identity",
  group: "asset",
  name: "International diversified treasury reserve position",
  mark: { kind: "symbol", symbol: "RESERVE" },
  primary: "$123,456.78",
  secondary: "99,999,999,999.0000 RESERVE",
  tone: "default",
} satisfies BalanceRowModel;

const largeLocalCurrencyRow = {
  key: "storybook-idr",
  group: "cash",
  name: "Indonesian rupiah",
  mark: { kind: "flag", currency: "IDR" },
  primary: "Rp 1.234.567.890,12",
  secondary: null,
  tone: "default",
} satisfies BalanceRowModel;

type FinancialRowStoryProps = {
  rows: BalanceRowModel[];
};

function FinancialRowStory({ rows }: FinancialRowStoryProps) {
  return (
    <div className="mx-auto w-full max-w-md p-2">
      <Card>
        <CardContent inset="list">
          <ul className="list-none p-0" data-balance-list="">
            {rows.map((row) => <HomeBalanceRowView key={row.key} row={row} />)}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function balanceRowParts(row: Element) {
  const valueColumn = row.querySelector<HTMLElement>("[data-slot=finance-row-value]");
  const ticker = row.querySelector<HTMLElement>("[data-slot=money-ticker]");
  const label = row.querySelector<HTMLElement>("[data-slot=item-content] [data-slot=item-title]");
  const quantity = row.querySelector<HTMLElement>("[data-slot=item-content] [data-slot=item-description]");
  if (!valueColumn || !ticker || !label) throw new Error("Balance row geometry is incomplete");
  return { valueColumn, ticker, label, quantity };
}

function allLinesWithin(element: HTMLElement): boolean {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().height <= element.getBoundingClientRect().height + 0.5;
}

const meta = {
  id: "pilot-financial-row",
  title: "Pilot/Financial Row",
  component: FinancialRowStory,
  args: {
    rows: [normalRow],
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof FinancialRowStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {};

export const Loading: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-md p-2">
      <Card>
        <CardContent inset="list">
          <ShimmerRows count={2} />
          <span className="sr-only">Loading balances…</span>
        </CardContent>
      </Card>
    </div>
  ),
};

export const UnavailableValue: Story = {
  args: {
    rows: [unavailableRow],
  },
};

export const LongLabelLargeAmount: Story = {
  args: {
    rows: [longLabelLargeAmountRow],
  },
  parameters: {
    viewport: {
      defaultViewport: "mobile",
    },
  },
};

export const IssueExampleQuantities: Story = {
  args: {
    rows: [testTokenRow, governanceTokenRow, longIdentityRow, largeLocalCurrencyRow],
  },
  parameters: {
    viewport: {
      defaultViewport: "mobile",
    },
  },
  play: async ({ canvasElement }) => {
    const rows = [...canvasElement.querySelectorAll("[data-slot=item][data-kind=balance]")];
    await expect(rows).toHaveLength(4);
    const expected = [testTokenRow, governanceTokenRow, longIdentityRow, largeLocalCurrencyRow];

    for (const [index, row] of rows.entries()) {
      const { valueColumn, ticker, label, quantity } = balanceRowParts(row);
      const rowBox = row.getBoundingClientRect();
      const valueBox = valueColumn.getBoundingClientRect();
      const tickerBox = ticker.getBoundingClientRect();

      await expect(Math.abs(valueBox.width - tickerBox.width)).toBeLessThan(1.5);
      await expect(Math.abs(valueBox.right - tickerBox.right)).toBeLessThan(1.5);
      await expect(rowBox.right - valueBox.right).toBeGreaterThanOrEqual(10);
      await expect(rowBox.right - valueBox.right).toBeLessThan(16);
      await expect(valueBox.left - rowBox.left).toBeGreaterThanOrEqual(10);

      await expect(ticker.getAttribute("aria-label")).toBe(expected[index]!.primary);
      await expect(label.textContent).toBe(expected[index]!.name);

      if (quantity !== null) {
        await expect(quantity.textContent).toBe(expected[index]!.secondary);
        const quantityBox = quantity.getBoundingClientRect();
        await expect(quantityBox.width).toBeGreaterThan(0);
        await expect(quantityBox.left).toBeGreaterThanOrEqual(rowBox.left);
        await expect(quantityBox.right).toBeLessThanOrEqual(rowBox.right + 0.5);
        await expect(allLinesWithin(quantity)).toBe(true);
        await expect(quantityBox.right).toBeLessThanOrEqual(valueBox.left + 0.5);
      }
    }

    const boxes = rows.map((row) => row.getBoundingClientRect());
    for (const [index, box] of boxes.slice(0, -1).entries()) {
      await expect(box.bottom).toBeLessThanOrEqual(boxes[index + 1]!.top + 0.5);
    }

    const document = canvasElement.ownerDocument;
    await expect(document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  },
};
