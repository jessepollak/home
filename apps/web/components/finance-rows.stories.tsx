import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ArrowDown, HandCoins, PiggyBank } from "lucide-react";
import { expect, within } from "storybook/test";
import { GlyphMark } from "./currency-mark";
import { ActivityRow, BalanceRow } from "./finance-rows";

function textEdge(element: HTMLElement, edge: "left" | "right") {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  return edge === "left" ? rect.left : rect.right;
}

async function expectAligned(left: HTMLElement, right: HTMLElement, edge: "left" | "right") {
  const drift = Math.abs(left.getBoundingClientRect()[edge] - right.getBoundingClientRect()[edge]);
  await expect(drift).toBeLessThanOrEqual(1);
  await expect(Math.abs(textEdge(left, edge) - textEdge(right, edge))).toBeLessThanOrEqual(1);
}

function FinanceRowStory({ row }: { row: "activity" | "balance" | "borrow" | "nux" }) {
  return (
    <ul className="w-[30rem] max-w-full list-none p-0">
      {row === "borrow" ? (
        <BalanceRow
          icon={<GlyphMark size="sm"><HandCoins /></GlyphMark>}
          iconTone="mark"
          label="Borrow Cash"
          context="Against your investments"
          value="$30.01"
          valueContext="5.10% APR"
          onActivate={() => {}}
          activateLabel="Open Borrow"
        />
      ) : row === "nux" ? (
        <BalanceRow
          icon={<GlyphMark size="sm"><HandCoins /></GlyphMark>}
          iconTone="mark"
          label="Borrow Cash"
          context="Borrow at 5.10% APR"
          onActivate={() => {}}
          activateLabel="Open Borrow"
        />
      ) : row === "activity" ? (
        <ActivityRow
          icon={<ArrowDown className="size-4" />}
          iconTone="incoming"
          label="Received"
          context={<time dateTime="2026-09-20T20:48:00.000Z">Sep 20, 8:48 PM</time>}
          value="+425 USDC"
          valueTone="success"
          onActivate={() => {}}
          activateLabel="View Received transaction details"
        />
      ) : (
        <BalanceRow
          icon={<PiggyBank className="size-4" />}
          iconTone="mark"
          label="Bitcoin"
          context="0.001 cbBTC"
          value="$60.00"
          valueContext="USD"
        />
      )}
    </ul>
  );
}

const meta = {
  id: "ui-finance-rows",
  title: "UI/Finance Rows",
  component: FinanceRowStory,
  args: { row: "activity" },
  parameters: { layout: "centered", design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=96-1147" } },
} satisfies Meta<typeof FinanceRowStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Activity: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectAligned(
      canvas.getByText("Received", { exact: true }),
      canvas.getByText("Sep 20, 8:48 PM", { exact: true }),
      "left",
    );
    await expect(canvas.getByText("+425 USDC").getAttribute("data-value-tone")).toBe("success");
  },
};

export const Balance: Story = {
  args: { row: "balance" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectAligned(
      canvas.getByText("Bitcoin", { exact: true }),
      canvas.getByText("0.001 cbBTC", { exact: true }),
      "left",
    );
    await expectAligned(
      canvas.getByText("$60.00", { exact: true }),
      canvas.getByText("USD", { exact: true }),
      "right",
    );
  },
};

export const TitleAlignedValue: Story = {
  args: { row: "borrow" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const label = canvas.getByText("Borrow Cash", { exact: true });
    const value = canvas.getByText("$30.01", { exact: true });
    const valueContext = canvas.getByText("5.10% APR", { exact: true });
    await expect(Math.abs(label.getBoundingClientRect().top - value.getBoundingClientRect().top))
      .toBeLessThanOrEqual(1);
    await expect(valueContext.getBoundingClientRect().top).toBeGreaterThanOrEqual(value.getBoundingClientRect().bottom - 1);
    await expectAligned(value, valueContext, "right");
  },
};

export const NuxWithoutValue: Story = {
  args: { row: "nux" },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[data-slot=finance-row-value]")).toBeNull();
    await expect(canvasElement.querySelector("[data-slot=item-actions]")).not.toBeNull();
  },
};

function LongValueRows() {
  return (
    <div className="flex flex-col gap-4">
      {[390, 320].map((width) => (
        <ul key={width} className="max-w-full list-none p-0" style={{ width }} data-row-width={width}>
          <BalanceRow
            icon={<PiggyBank className="size-4" />}
            label="Staked ETH"
            context="Healthy"
            value="12,345,678.90 USDC"
            valueContext="5.01% APR"
            onActivate={() => {}}
            activateLabel="View Staked ETH"
          />
        </ul>
      ))}
    </div>
  );
}

async function expectLongValuesVisible(canvasElement: HTMLElement, wrapped: boolean) {
  for (const width of [390, 320]) {
    const list = canvasElement.querySelector<HTMLElement>(`[data-row-width="${width}"]`);
    if (!list) throw new Error(`Missing ${width}px finance row`);
    const canvas = within(list);
    const row = list.querySelector<HTMLElement>("[data-slot=item]");
    const body = list.querySelector<HTMLElement>("[data-slot=finance-row-body]");
    const column = list.querySelector<HTMLElement>("[data-slot=finance-row-value]");
    if (!row || !body || !column) throw new Error("Missing finance row layout");
    const label = canvas.getByText("Staked ETH");
    const value = canvas.getByText("12,345,678.90 USDC");
    const labelBox = label.getBoundingClientRect();
    const valueBox = value.getBoundingClientRect();
    const columnBox = column.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(value);
    const textBox = range.getBoundingClientRect();
    const inlineEnd = list.closest("[dir=rtl]") ? "left" : "right";
    await expect(list.getBoundingClientRect().width).toBe(width);
    await expect(labelBox.width).toBeGreaterThanOrEqual(40);
    await expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
    await expect(textBox.left).toBeGreaterThanOrEqual(valueBox.left - 1);
    await expect(textBox.right).toBeLessThanOrEqual(valueBox.right + 1);
    await expect(textBox.bottom).toBeLessThanOrEqual(valueBox.bottom + 1);
    await expect(valueBox.left).toBeGreaterThanOrEqual(rowBox.left - 1);
    await expect(valueBox.right).toBeLessThanOrEqual(rowBox.right + 1);
    await expect(Math.abs(columnBox[inlineEnd] - bodyBox[inlineEnd])).toBeLessThanOrEqual(1);
    if (wrapped) {
      await expect(columnBox.top).toBeGreaterThanOrEqual(labelBox.bottom - 1);
    } else if (width === 390) {
      await expect(Math.abs(labelBox.top - valueBox.top)).toBeLessThanOrEqual(1);
    }
    await expect(canvas.getByText("5.01% APR")).toBeVisible();
    await expect(row.querySelector("[data-slot=item-actions]")).not.toBeNull();
  }
}

export const LongValueAtNormalText: Story = {
  render: () => <LongValueRows />,
  play: async ({ canvasElement }) => expectLongValuesVisible(canvasElement, false),
};

export const LongValueAtEnlargedText: Story = {
  render: () => <LongValueRows />,
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await expectLongValuesVisible(canvasElement, true);
    } finally {
      root.style.fontSize = previous;
    }
  },
};

export const RtlLongValueAtEnlargedText: Story = {
  render: () => <div dir="rtl"><LongValueRows /></div>,
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await expectLongValuesVisible(canvasElement, true);
    } finally {
      root.style.fontSize = previous;
    }
  },
};
