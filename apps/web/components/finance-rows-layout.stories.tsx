import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { ActivityRow, AssetRow, type ActivityRowProps, type AssetRowProps } from "@/components/finance-rows";
import { CurrencyMark } from "@/components/currency-mark";
import { MoneyTicker } from "@/components/money-ticker";
import { Card, CardContent } from "@/components/ui/card";

type FinanceRowSample = {
  kind: "asset" | "activity";
  iconGlyph: string;
  iconTone: "mark" | "incoming" | "outgoing";
  label: string;
  context: string;
  value: string;
  actionable: boolean;
};

const regularAssetSample = {
  kind: "asset",
  iconGlyph: "TEST",
  iconTone: "mark",
  label: "Test Token",
  context: "12,345,678 TEST",
  value: "$123,456.78",
  actionable: false,
} satisfies FinanceRowSample;

const largeAssetSample = {
  kind: "asset",
  iconGlyph: "RESERVE",
  iconTone: "mark",
  label: "International diversified treasury reserve position",
  context: "99,999,999,999.0000 RESERVE",
  value: "Rp 1.234.567.890,12",
  actionable: false,
} satisfies FinanceRowSample;

const actionableSendSample = {
  kind: "activity",
  iconGlyph: "↑",
  iconTone: "outgoing",
  label: "Send USDC",
  context: "Sep 21, 1:23 PM · Confirmed",
  value: "−123.45 USDC",
  actionable: true,
} satisfies FinanceRowSample;

const actionableCashOutSample = {
  kind: "activity",
  iconGlyph: "↓",
  iconTone: "incoming",
  label: "Cash out to Indonesian rupiah",
  context: "Sep 20, 9:04 AM · Pending",
  value: "Rp 1.234.567.890,12",
  actionable: true,
} satisfies FinanceRowSample;

function financeRowProps(sample: FinanceRowSample): AssetRowProps & ActivityRowProps {
  return {
    icon: sample.iconTone === "mark"
      ? <CurrencyMark symbol={sample.iconGlyph} size="sm" />
      : sample.iconGlyph,
    iconTone: sample.iconTone,
    label: sample.label,
    context: sample.context,
    value: <MoneyTicker value={sample.value} />,
    ...(sample.actionable
      ? { onActivate: () => {}, activateLabel: `View ${sample.label} details` }
      : {}),
  };
}

function FinanceRowsStory({ rows }: { rows: FinanceRowSample[] }) {
  return (
    <div className="mx-auto w-full max-w-md p-2">
      <Card>
        <CardContent inset="list">
          <ul className="list-none p-0">
            {rows.map((row) => row.kind === "asset"
              ? <AssetRow key={row.label} {...financeRowProps(row)} />
              : <ActivityRow key={row.label} {...financeRowProps(row)} />)}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function rowGeometry(row: Element) {
  const identityColumn = row.querySelector<HTMLElement>("[data-slot=item-content]");
  const valueColumn = row.querySelector<HTMLElement>("[data-slot=finance-row-value]");
  const ticker = row.querySelector<HTMLElement>("[data-slot=money-ticker]");
  const actions = row.querySelector<HTMLElement>("[data-slot=item-actions]");
  if (!identityColumn || !valueColumn || !ticker) {
    throw new Error("Finance row geometry is incomplete");
  }
  return {
    row: row.getBoundingClientRect(),
    identityColumn: identityColumn.getBoundingClientRect(),
    valueColumn: valueColumn.getBoundingClientRect(),
    ticker: ticker.getBoundingClientRect(),
    actions: actions?.getBoundingClientRect() ?? null,
  };
}

function allLinesWithin(element: HTMLElement): boolean {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().height <= element.getBoundingClientRect().height + 0.5;
}

const meta = {
  id: "pilot-finance-rows",
  title: "Pilot/Finance Rows",
  component: FinanceRowsStory,
  args: {
    rows: [regularAssetSample],
  },
  parameters: {
    layout: "fullscreen",
    viewport: {
      defaultViewport: "mobile",
    },
  },
} satisfies Meta<typeof FinanceRowsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AssetRowsLargeLocalCurrency: Story = {
  args: {
    rows: [regularAssetSample, largeAssetSample],
  },
  play: async ({ canvasElement }) => {
    const rows = [...canvasElement.querySelectorAll("[data-slot=item]")];
    await expect(rows).toHaveLength(2);

    for (const row of rows) {
      const { row: rowBox, identityColumn, valueColumn, ticker, actions } = rowGeometry(row);
      await expect(Math.abs(valueColumn.width - ticker.width)).toBeLessThan(1.5);
      await expect(Math.abs(ticker.right - valueColumn.right)).toBeLessThan(1.5);
      await expect(rowBox.right - valueColumn.right).toBeGreaterThanOrEqual(10);
      await expect(rowBox.right - valueColumn.right).toBeLessThan(16);
      await expect(valueColumn.right).toBeLessThanOrEqual(rowBox.right + 0.5);
      await expect(identityColumn.right).toBeLessThanOrEqual(valueColumn.left + 0.5);
      await expect(actions).toBeNull();
    }

    const quantity = rows[1]?.querySelector<HTMLElement>("[data-slot=item-description]");
    if (!quantity) throw new Error("Asset identity is missing");
    await expect(quantity.textContent).toBe(largeAssetSample.context);
    await expect(allLinesWithin(quantity)).toBe(true);
    await expect(rows[1]?.textContent).toContain(largeAssetSample.label);
    await expect(rows[1]?.textContent).toContain(largeAssetSample.value);

    const boxes = rows.map((row) => row.getBoundingClientRect());
    await expect(boxes[0]!.bottom).toBeLessThanOrEqual(boxes[1]!.top + 0.5);

    const document = canvasElement.ownerDocument;
    await expect(document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  },
};

export const ActionableRowsChevron: Story = {
  args: {
    rows: [actionableSendSample, actionableCashOutSample],
  },
  play: async ({ canvasElement }) => {
    const rows = [...canvasElement.querySelectorAll("[data-slot=item]")];
    await expect(rows).toHaveLength(2);

    for (const row of rows) {
      const { row: rowBox, identityColumn, valueColumn, ticker, actions } = rowGeometry(row);
      if (!actions) throw new Error("Actionable finance row chevron is missing");

      await expect(Math.abs(valueColumn.width - ticker.width)).toBeLessThan(1.5);
      await expect(Math.abs(ticker.right - valueColumn.right)).toBeLessThan(1.5);
      await expect(valueColumn.right).toBeLessThanOrEqual(actions.left + 0.5);
      await expect(identityColumn.right).toBeLessThanOrEqual(valueColumn.left + 0.5);
      await expect(rowBox.right - actions.right).toBeGreaterThanOrEqual(10);
      await expect(rowBox.right - actions.right).toBeLessThan(16);
      await expect(actions.left - valueColumn.right).toBeGreaterThan(8);
      await expect(actions.left - valueColumn.right).toBeLessThan(12);
      await expect(actions.left).toBeGreaterThanOrEqual(ticker.right);
      await expect(valueColumn.bottom).toBeLessThanOrEqual(rowBox.bottom + 0.5);
      await expect(actions.bottom).toBeLessThanOrEqual(rowBox.bottom + 0.5);
    }

    const boxes = rows.map((row) => row.getBoundingClientRect());
    await expect(boxes[0]!.bottom).toBeLessThanOrEqual(boxes[1]!.top + 0.5);

    const document = canvasElement.ownerDocument;
    await expect(document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth + 1);
  },
};
