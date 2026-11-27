import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import type { OperatorRevenueSummary } from "@/shared/fees/revenue";
import { OperatorRevenue } from "./operator-revenue";

const dailyAmounts = [
  0, 0, 1_250_000, 400_000, 0, 2_100_000, 900_000, 0, 0, 3_400_000,
  1_800_000, 600_000, 0, 250_000, 4_200_000, 1_100_000, 0, 0, 2_750_000, 950_000,
  0, 1_500_000, 3_050_000, 0, 700_000, 2_200_000, 0, 1_900_000, 5_300_000, 1_250_000,
];
const days = dailyAmounts.map((amount, index) => ({
  date: new Date(Date.UTC(2026, 7, 26 + index)).toISOString().slice(0, 10),
  collectedBaseUnits: String(amount),
}));

const populated: OperatorRevenueSummary = {
  collectedBaseUnits: "184250000",
  days,
};

function RevenueStory({ summary }: { summary: OperatorRevenueSummary }) {
  return (
    <div className="min-h-screen bg-muted p-4 sm:p-8">
      <div className="mx-auto grid w-full max-w-5xl gap-8">
        <OperatorRevenue summary={summary} />
      </div>
    </div>
  );
}

const meta = {
  id: "operator-revenue",
  title: "Operator/Revenue",
  component: RevenueStory,
  args: { summary: populated },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof RevenueStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { summary: { collectedBaseUnits: "0", days: days.map((day) => ({ ...day, collectedBaseUnits: "0" })) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No fees yet")).toBeVisible();
  },
};

export const NoSucceededFees: Story = {
  args: { summary: { collectedBaseUnits: "0", days: days.map((day) => ({ ...day, collectedBaseUnits: "0" })), recorded: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("No fees yet")).toBeNull();
    await expect(within(canvas.getByRole("list", { name: "Daily fee revenue" })).getAllByRole("listitem")).toHaveLength(30);
  },
};

export const MixedResults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("$184.25")).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Expected fees", level: 3 })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Expected fees, last 30 days", level: 3 })).toBeVisible();
    await expect(within(canvas.getByRole("list", { name: "Daily fee revenue" })).getAllByRole("listitem")).toHaveLength(30);
  },
};
