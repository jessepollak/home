import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import type { OperatorRevenueEntry, OperatorRevenueSummary } from "@/shared/fees/revenue";
import { OperatorRevenue } from "./operator-revenue";

const recipient = "0x52908400098527886e0f7030069857d2e4169ee7";
const dailyAmounts = [
  0, 0, 1_250_000, 400_000, 0, 2_100_000, 900_000, 0, 0, 3_400_000,
  1_800_000, 600_000, 0, 250_000, 4_200_000, 1_100_000, 0, 0, 2_750_000, 950_000,
  0, 1_500_000, 3_050_000, 0, 700_000, 2_200_000, 0, 1_900_000, 5_300_000, 1_250_000,
];
const days = dailyAmounts.map((amount, index) => ({
  date: new Date(Date.UTC(2026, 7, 26 + index)).toISOString().slice(0, 10),
  collectedBaseUnits: String(amount),
}));

function entry(overrides: Partial<OperatorRevenueEntry> & Pick<OperatorRevenueEntry, "actionId">): OperatorRevenueEntry {
  return {
    actionKind: "trade",
    recordedAt: "2026-09-24T12:00:00.000Z",
    amountBaseUnits: "1250000",
    symbol: "USDC",
    decimals: 6,
    bps: 50,
    recipient,
    collectedBy: "in-batch-transfer",
    result: "succeeded",
    transactionHash: `0x${"a1".repeat(32)}`,
    ...overrides,
  };
}

const populated: OperatorRevenueSummary = {
  collectedBaseUnits: "184250000",
  days,
  entries: [
    entry({ actionId: "a-1", recordedAt: "2026-09-24T15:42:00.000Z", result: "unresolved", amountBaseUnits: "2500000" }),
    entry({ actionId: "a-2", recordedAt: "2026-09-24T12:00:00.000Z" }),
    entry({ actionId: "a-3", recordedAt: "2026-09-23T18:05:00.000Z", result: "reverted", bps: 30, amountBaseUnits: "300000", transactionHash: `0x${"b2".repeat(32)}` }),
    entry({ actionId: "a-4", recordedAt: "2026-09-23T09:14:00.000Z", result: "not_submitted", transactionHash: null, amountBaseUnits: "750000" }),
    entry({ actionId: "a-5", recordedAt: "2026-09-22T21:30:00.000Z", bps: 300, amountBaseUnits: "4200000", collectedBy: "provider-native", transactionHash: `0x${"c3".repeat(32)}` }),
  ],
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
  args: { summary: { collectedBaseUnits: "0", days: days.map((day) => ({ ...day, collectedBaseUnits: "0" })), entries: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No fees yet")).toBeVisible();
    await expect(canvas.queryByRole("table")).toBeNull();
  },
};

export const MixedResults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("$184.25")).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Expected fees", level: 3 })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Expected fees, last 30 days", level: 3 })).toBeVisible();
    await expect(within(canvas.getByRole("list", { name: "Daily fee revenue" })).getAllByRole("listitem")).toHaveLength(30);
    for (const result of ["Succeeded", "Reverted", "Not submitted", "Unresolved"]) {
      await expect(canvas.getAllByText(result)[0]).toBeVisible();
    }
    await expect(canvas.getAllByRole("link")).toHaveLength(4);
  },
};
