import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { isPositiveDecimalAmount } from "./amount-input";
import { amountExceedsCeiling, moneyAssetPricing } from "./amount-units";
import { MoneyAmountDisplay } from "./amount";

type AmountStoryProps = {
  initialAmount?: string;
  availableLabel?: string;
  availableAmount?: string | null;
  nativeSymbol?: string;
  fiatCurrency?: string;
  maxDecimals?: number;
  priced?: boolean;
};

function AmountStory({
  initialAmount = "",
  availableLabel = "$12.00 available",
  availableAmount = "12",
  nativeSymbol = "USDC",
  fiatCurrency,
  maxDecimals = 6,
  priced = true,
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
        pricing={priced ? moneyAssetPricing("USDC", "US") : { status: "unpriced" }}
        nativeSymbol={nativeSymbol}
        fiatCurrency={fiatCurrency}
      />
      <Button disabled={!canContinue} onClick={() => setContinued(true)}>Continue</Button>
      {continued ? <output>Ready to review {amount} {nativeSymbol}</output> : null}
    </main>
  );
}

async function expectDigitsCentred(canvasElement: HTMLElement, checkFit = false) {
  await waitFor(async () => {
    const label = canvasElement.querySelector<HTMLElement>("[data-primary-amount]");
    const figure = label?.querySelector<HTMLElement>("[data-amount-figure]");
    const text = figure?.firstChild;
    await expect(label).toBeTruthy();
    await expect(text?.nodeType).toBe(Node.TEXT_NODE);
    const range = document.createRange();
    range.selectNodeContents(text!);
    const figureRect = range.getBoundingClientRect();
    const axisRect = label!.parentElement?.querySelector("p[aria-live]")?.getBoundingClientRect() ?? label!.getBoundingClientRect();
    await expect(Math.abs(figureRect.left + figureRect.width / 2 - (axisRect.left + axisRect.width / 2))).toBeLessThanOrEqual(1);
    if (checkFit) {
      const input = label!.querySelector<HTMLInputElement>("[data-money-amount-input]");
      await expectPartsInsideLabel(label!);
      await expect(input).toBeTruthy();
      await expect(input!.scrollWidth).toBeLessThanOrEqual(input!.clientWidth + 1);
    }
  });
}

async function expectPartsInsideLabel(label: HTMLElement) {
  const labelRect = label.getBoundingClientRect();
  for (const part of Array.from(label.children)) {
    const partRect = part.getBoundingClientRect();
    await expect(partRect.left).toBeGreaterThanOrEqual(labelRect.left);
    await expect(partRect.right).toBeLessThanOrEqual(labelRect.right);
  }
}

async function expectUnitInside(canvasElement: HTMLElement) {
  await waitFor(async () => {
    const label = canvasElement.querySelector<HTMLElement>("[data-primary-amount]");
    await expect(label).toBeTruthy();
    await expectPartsInsideLabel(label!);
  });
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
    await expectDigitsCentred(canvasElement);
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.type(input, "10");
    await expect(input).toHaveValue("10");
    await expectDigitsCentred(canvasElement);
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
    await expectDigitsCentred(canvasElement);
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
    await expectDigitsCentred(canvasElement, true);
    await userEvent.clear(input);
    await userEvent.type(input, "123456789.12");
    await expect(input).toHaveValue("123456789.12");
    await expectDigitsCentred(canvasElement, true);
  },
};

export const OverAvailable: Story = {
  args: { initialAmount: "25" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByText("Only $12.00 available")).toBeVisible();
    await expectDigitsCentred(canvasElement);
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "5");
    await expect(input).toHaveValue("5");
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeEnabled();
  },
};

export const NativeUnit: Story = {
  args: { priced: false, nativeSymbol: "ETH", maxDecimals: 18, availableLabel: "1.1010 ETH available", availableAmount: "1.1010" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await userEvent.type(input, "0.123456789012345678");
    await expect(input).toHaveValue("0.123456789012345678");
    await expectUnitInside(canvasElement);
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeEnabled();
  },
};

export const RightToLeft: Story = {
  render: (args) => <div dir="rtl"><AmountStory {...args} /></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await expectDigitsCentred(canvasElement);
    await userEvent.type(input, "5.25");
    await expect(input).toHaveValue("5.25");
    await expectDigitsCentred(canvasElement);
  },
};

export const FiatDeposit: Story = {
  args: { priced: false, nativeSymbol: "IDR", fiatCurrency: "IDR", maxDecimals: 2, availableLabel: undefined, availableAmount: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Amount" });
    await userEvent.type(input, "250.50");
    await expect(input).toHaveValue("250.50");
    await expectDigitsCentred(canvasElement);
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeEnabled();
  },
};
