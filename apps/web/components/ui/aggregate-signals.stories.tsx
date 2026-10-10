import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { AggregateSignals } from "./aggregate-signals";

const meta = {
  id: "ui-aggregate-signals",
  title: "UI/Aggregate signals", component: AggregateSignals,
  parameters: { a11y: { test: "error" } },
  decorators: [(Story) => <div className="w-full max-w-sm"><Story /></div>],
  args: {
    title: "Token checks", source: "GoPlus",
    summary: [{ id: "restriction", label: "Sell restriction reported", tone: "danger" }],
    metadata: "Reported by GoPlus · checked Oct 5, 2026, 12:00 PM UTC",
    signals: [
      { id: "sell", label: "Sell limit", detail: "Holders may not be able to sell their full balance at once", tone: "danger" },
      { id: "tax", label: "Transfer tax 2%", detail: "Taken from each transfer", tone: "caution" },
      { id: "absent", label: "No pause capability reported", tone: "positive" },
      { id: "unknown", label: "Unknown signals", detail: "No data: blocklist", tone: "neutral" },
    ],
  },
} satisfies Meta<typeof AggregateSignals>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Mixed: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const trigger = canvas.getByRole("button", { name: /Token checks/ });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(canvas.getByText("Sell limit", { exact: true })).toBeVisible();
  await expect(canvas.getByText("Transfer tax 2%", { exact: true })).toBeVisible();
  await expect(canvas.getByText("No pause capability reported")).toBeVisible();
  await expect(canvas.getByText("No data: blocklist")).toBeVisible();
  await userEvent.keyboard(" ");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveFocus();
} };
export const ReportedAbsent: Story = { args: {
  summary: [{ id: "absent", label: "No supported flags reported", tone: "positive" }],
  signals: [{ id: "absent", label: "No honeypot flag reported", tone: "positive" }],
} };
export const Unknown: Story = { args: {
  summary: [{ id: "unknown", label: "No check data", tone: "neutral" }],
  signals: [{ id: "unknown", label: "Unknown signals", detail: "No data: honeypot, sell limit", tone: "neutral" }],
} };
export const Dark: Story = { ...Mixed, globals: { theme: "dark" } };
