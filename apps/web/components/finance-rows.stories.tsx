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
