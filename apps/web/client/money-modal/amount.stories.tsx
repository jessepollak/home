import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { isPositiveDecimalAmount } from "./amount-input";
import { amountExceedsCeiling, type MoneyAmountUnit } from "./amount-units";
import { MoneyAmountDisplay } from "./amount";

type AmountStoryProps = {
  initialAmount?: string;
  availableLabel?: string;
  availableAmount?: string | null;
  nativeSymbol?: string;
  unit?: MoneyAmountUnit;
  maxDecimals?: number;
};

function AmountStory({
  initialAmount = "",
  availableLabel = "$12.00 available",
  availableAmount = "12",
  nativeSymbol = "USDC",
  unit = { kind: "fiat", currency: "USD" },
  maxDecimals = 6,
}: AmountStoryProps) {
  const [amount, setAmount] = useState(initialAmount);
  const [continued, setContinued] = useState(false);
  const overAvailable = amountExceedsCeiling(amount, availableAmount);
  const canContinue = isPositiveDecimalAmount(amount) && !overAvailable;
  return (
    <main className="mx-auto flex min-h-[36rem] w-full max-w-md flex-col p-4">
      <MoneyAmountDisplay
        amount={amount}
        onAmountChange={setAmount}
        maxDecimals={maxDecimals}
        onSubmit={canContinue ? () => setContinued(true) : undefined}
        overAvailable={overAvailable}
        availableLabel={availableLabel}
        availableAmount={availableAmount}
        assetId={nativeSymbol.toLowerCase()}
        assetLabel={nativeSymbol}
        assetLocked
        chipSet={availableAmount === null ? "none" : "quick-local"}
        unit={unit}
        nativeSymbol={nativeSymbol}
      />
      <Button disabled={!canContinue} onClick={() => setContinued(true)}>Continue</Button>
      {continued ? <output>Ready to review {amount} {nativeSymbol}</output> : null}
    </main>
  );
}

const meta = {
  title: "Money/Primary Amount",
  component: AmountStory,
  args: {},
  parameters: {
    layout: "fullscreen",
    viewport: { defaultViewport: "mobile" },
    a11y: { test: "error" },
    design: { type: "figma", url: "https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=166-1776" },
  },
} satisfies Meta<typeof AmountStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await expect(input).toHaveValue("");
    await expect(canvas.queryByRole("button", { name: /as the primary amount/ })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.type(input, "10");
    await expect(input).toHaveValue("10");
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeEnabled();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByText("Ready to review 10 USDC")).toBeVisible();
  },
};

export const Entered: Story = {
  args: { initialAmount: "3.50" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await expect(input).toHaveValue("3.50");
    await userEvent.clear(input);
    await userEvent.type(input, "4,25");
    await expect(input).toHaveValue("4.25");
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeEnabled();
  },
};

export const LongAmount: Story = {
  args: { initialAmount: "123456789012.123456", availableAmount: null, availableLabel: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await expect(input).toHaveValue("123456789012.123456");
    await userEvent.type(input, "7");
    await expect(input).toHaveValue("123456789012.123456");
  },
};

export const OverAvailable: Story = {
  args: { initialAmount: "25" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByText("Only $12.00 available")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "5");
    await expect(input).toHaveValue("5");
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeEnabled();
  },
};

export const NativeUnit: Story = {
  args: { unit: { kind: "native" }, nativeSymbol: "ETH", maxDecimals: 18, availableLabel: "1.1010 ETH available", availableAmount: "1.1010" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await userEvent.type(input, "0.123456789012345678");
    await expect(input).toHaveValue("0.123456789012345678");
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeEnabled();
  },
};

export const FiatDeposit: Story = {
  args: { unit: { kind: "fiat", currency: "IDR" }, nativeSymbol: "IDR", maxDecimals: 2, availableLabel: undefined, availableAmount: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await userEvent.type(input, "250.50");
    await expect(input).toHaveValue("250.50");
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeEnabled();
  },
};

export const PricedBitcoin: Story = {
  args: {
    initialAmount: "0.001",
    unit: { kind: "convertible", currency: "USD", perUnit: { atoms: "65000", scale: 0 } },
    nativeSymbol: "cbBTC",
    maxDecimals: 8,
    availableLabel: "0.02 cbBTC available",
    availableAmount: "0.02",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await expect(input).toHaveValue("0.001");
    await expect(canvas.getByText("0.02 cbBTC available")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Show ≈ $65.00 as the primary amount" }));
    await expect(input).toHaveValue("65.00");
    await expect(canvas.getByRole("button", { name: "Show 0.001 cbBTC as the primary amount" })).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, "100.00");
    await expect(input).toHaveValue("100.00");
    await expect(canvas.queryByText("Ready to review 0.00153846 cbBTC")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
    await expect(canvas.getByText("Ready to review 0.00153846 cbBTC")).toBeVisible();
  },
};
