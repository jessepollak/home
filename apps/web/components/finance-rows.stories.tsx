import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ArrowDown, PiggyBank } from "lucide-react";
import { expect, within } from "storybook/test";
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

function FinanceRowStory({ row }: { row: "activity" | "balance" }) {
  return (
    <ul className="w-[30rem] max-w-full list-none p-0">
      {row === "activity" ? (
        <ActivityRow
          icon={<ArrowDown className="size-4" />}
          iconTone="incoming"
          label="Received"
          context={<time dateTime="2026-09-20T20:48:00.000Z">Sep 20, 8:48 PM</time>}
          value="+425 USDC"
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
  parameters: { layout: "centered" },
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
