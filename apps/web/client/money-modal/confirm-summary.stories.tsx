import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect, type ComponentProps, type ReactNode } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { CopyableValue } from "@/components/copyable-value";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { MoneyConfirmSummary, moneyConfirmFromRow } from "./confirm-summary";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const action: PreparedMoneyAction = {
  id: "storybook-send-review", kind: "send", title: "Send USDC", calls: [], amounts: [], warnings: [],
  owner: { subject: "storybook-owner", address: ACCOUNT, chainId: 8453, accountProvider: "cdp-embedded" },
  createdAt: "2026-09-23T00:00:00.000Z", expiresAt: "2099-09-23T00:00:00.000Z",
  networkFee: { payment: "usdc", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", paymaster: "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c", maxFeeBaseUnits: "20000", decimals: 6 },
};

const meta = {
  id: "money-modal-confirm-summary",
  title: "Money modal/Confirm summary",
  component: MoneyConfirmSummary,
  args: {
    amount: "$25.00",
    lead: "You're sending USDC",
    rows: [
      { label: "To", value: <CopyableValue value={RECIPIENT} presentation="full" valueKind="address" className="sm:justify-end" />, fullValue: true },
      moneyConfirmFromRow(action.owner),
      { label: "Network", value: "Base" },
    ],
    action,
  },
  render: (args) => <div className="mx-auto w-full max-w-md p-4"><MoneyConfirmSummary {...args} /></div>,
  parameters: { viewport: { defaultViewport: "mobile" } },
} satisfies Meta<typeof MoneyConfirmSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

async function checkRows(canvasElement: HTMLElement, pairs: readonly (readonly [string, string])[]) {
  const content = canvasElement.querySelector('[data-slot="card-content"][data-inset="list"]');
  await expect(content).not.toBeNull();
  const list = content?.querySelector("dl") as HTMLElement;
  await expect(list.tagName).toBe("DL");
  await expect(list.children).toHaveLength(pairs.length);
  for (const [index, [label, value]] of pairs.entries()) {
    const row = within(list.children[index] as HTMLElement);
    await expect(row.getByRole("term")).toHaveTextContent(label);
    await expect(row.getByRole("definition")).toHaveTextContent(value);
  }
}

export const SendReview: Story = {
  play: async ({ canvasElement }) => {
    await checkRows(canvasElement, [
      ["To", RECIPIENT], ["From", "0x1111…111111"], ["Network", "Base"],
      ["Network fee", "Up to 0.02 USDC · ≈ $0.02"],
    ]);
    await expect(within(canvasElement).getByRole("button", { name: `Copy ${RECIPIENT}` })).toBeVisible();
  },
};

type SummaryArgs = ComponentProps<typeof MoneyConfirmSummary>;

function frame(width: number, args: SummaryArgs) {
  return <div data-slot="confirm-frame" style={{ width, maxWidth: "100%" }}><MoneyConfirmSummary {...args} /></div>;
}

const simpleRows = [{ label: "Network", value: "Base" }];

function getFrame(canvasElement: HTMLElement): HTMLElement {
  const element = canvasElement.querySelector('[data-slot="confirm-frame"]');
  if (!(element instanceof HTMLElement)) throw new Error("Missing confirm frame");
  return element;
}

function getHeadline(frameElement: HTMLElement): HTMLElement {
  const headline = frameElement.querySelector('[data-slot="confirm-amount"]');
  if (!(headline instanceof HTMLElement)) throw new Error("Missing confirm headline");
  return headline;
}

function renderedWidth(headline: HTMLElement): number {
  const text = headline.querySelector("bdi");
  if (!text) throw new Error("Missing headline text");
  return text.getBoundingClientRect().width;
}

function heroWidth(headline: HTMLElement): number {
  const sizer = headline.parentElement?.querySelector('[aria-hidden="true"] > span');
  if (!sizer) throw new Error("Missing hero sizer");
  return sizer.getBoundingClientRect().width;
}


async function checkFit(canvasElement: HTMLElement, value: string) {
  const frameElement = getFrame(canvasElement);
  const headline = getHeadline(frameElement);
  await expect(headline.textContent).toBe(value);
  await waitFor(async () => {
    await expect(headline.scrollWidth).toBeLessThanOrEqual(headline.clientWidth + 1);
    await expect(frameElement.scrollWidth).toBeLessThanOrEqual(frameElement.clientWidth + 1);
  });
  return headline;
}

async function checkFallback(canvasElement: HTMLElement, value: string) {
  const headline = await checkFit(canvasElement, value);
  await waitFor(async () => {
    const number = headline.querySelector('[data-slot="confirm-amount-number"]');
    const unit = headline.querySelector('[data-slot="confirm-amount-unit"]');
    if (!(number instanceof HTMLElement) || !(unit instanceof HTMLElement)) throw new Error("Missing fallback lines");
    await expect(unit.getBoundingClientRect().top).toBeGreaterThanOrEqual(number.getBoundingClientRect().bottom - 1);
  });
}

function EnlargedText({ children }: { children: ReactNode }) {
  useEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "200%";
    return () => { document.documentElement.style.fontSize = previous; };
  }, []);
  return children;
}

export const ShortMobile: Story = {
  args: { amount: "$25.00", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  play: async ({ canvasElement }) => {
    const headline = await checkFit(canvasElement, "$25.00");
    await expect(Math.abs(renderedWidth(headline) - heroWidth(headline))).toBeLessThanOrEqual(1);
  },
};

export const LargeWholeMobile: Story = {
  args: { amount: "$12,345,678,901", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  play: async ({ canvasElement }) => {
    const headline = await checkFit(canvasElement, "$12,345,678,901");
    await waitFor(async () => { await expect(renderedWidth(headline)).toBeLessThan(heroWidth(headline) - 1); });
  },
};

export const LongDecimalMobile: Story = {
  args: { amount: "12,345.678901234567 WETH", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  play: async ({ canvasElement }) => { await checkFit(canvasElement, "12,345.678901234567 WETH"); },
};

export const LongSymbolMobile: Story = {
  args: { amount: "1,250.50 USDCBRIDGED", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  play: async ({ canvasElement }) => { await checkFit(canvasElement, "1,250.50 USDCBRIDGED"); },
};

export const LocalizedDotsMobile: Story = {
  args: { amount: "1.234.567,89 €", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  play: async ({ canvasElement }) => { await checkFit(canvasElement, "1.234.567,89 €"); },
};

export const LocalizedSpacesMobile: Story = {
  args: { amount: "12\u202f345\u202f678,90 €", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  play: async ({ canvasElement }) => { await checkFit(canvasElement, "12\u202f345\u202f678,90 €"); },
};

export const SignedMobile: Story = {
  args: { amount: "-$1,234,567.89", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  play: async ({ canvasElement }) => { await checkFit(canvasElement, "-$1,234,567.89"); },
};

export const QualifiedMobile: Story = {
  args: { amount: "Up to 1,234.567891 USDC", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  play: async ({ canvasElement }) => { await checkFit(canvasElement, "Up to 1,234.567891 USDC"); },
};

export const TinyMobile: Story = {
  args: { amount: "0.000000000000000001 ETH", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  play: async ({ canvasElement }) => { await checkFit(canvasElement, "0.000000000000000001 ETH"); },
};

export const ExtremeFallbackMobile: Story = {
  args: { amount: "Up to 123,456,789,012,345.123456789012345678 WETH", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  play: async ({ canvasElement }) => checkFallback(canvasElement, "Up to 123,456,789,012,345.123456789012345678 WETH"),
};

export const LargeWholeWideMobile: Story = {
  args: { amount: "$12,345,678,901", rows: simpleRows, action: null },
  render: (args) => frame(390, args),
  play: async ({ canvasElement }) => { await checkFit(canvasElement, "$12,345,678,901"); },
};

export const LargeWholeDesktopSheet: Story = {
  args: { amount: "$12,345,678,901", rows: simpleRows, action: null },
  render: (args) => frame(448, args),
  play: async ({ canvasElement }) => { await checkFit(canvasElement, "$12,345,678,901"); },
};

export const EnlargedTextMobile: Story = {
  args: { amount: "12,345.678901234567 WETH", rows: simpleRows, action: null },
  render: (args) => frame(320, args),
  decorators: [(StoryComponent) => <EnlargedText><StoryComponent /></EnlargedText>],
  play: async ({ canvasElement }) => {
    await checkFallback(canvasElement, "12,345.678901234567 WETH");
  },
};

export const ResizeRefit: Story = {
  args: { amount: "$12,345,678,901", rows: simpleRows, action: null },
  render: (args) => frame(448, args),
  play: async ({ canvasElement }) => {
    const frameElement = getFrame(canvasElement);
    const headline = await checkFit(canvasElement, "$12,345,678,901");
    const wideWidth = renderedWidth(headline);
    frameElement.style.width = "320px";
    await waitFor(async () => { await expect(renderedWidth(headline)).toBeLessThan(wideWidth - 1); });
    await checkFit(canvasElement, "$12,345,678,901");
    frameElement.style.width = "448px";
    await waitFor(async () => { await expect(Math.abs(renderedWidth(headline) - wideWidth)).toBeLessThanOrEqual(1); });
    await checkFit(canvasElement, "$12,345,678,901");
  },
};

export const ReviewDetails: Story = {
  args: {
    rows: [{ label: "You get", value: "≈ 1 DEGEN" }],
    details: [{ label: "Minimum received", value: "0.99 DEGEN" }, { label: "Max slippage", value: "1%" }],
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement);
    const toggle = screen.getByRole("button", { name: "Details" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(screen.queryByText("Minimum received")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(screen.getByText("Minimum received")).toBeVisible();
  },
};

export const SavingsDepositReview: Story = {
  args: {
    amount: "$25.00",
    lead: "Deposit to Save",
    rows: [
      moneyConfirmFromRow(action.owner),
      { label: "Vault", value: "Gauntlet USDC Prime" },
      { label: "Network", value: "Base (8453)" },
      { label: "Discovery APY", value: "4.6% · fresh" },
      { label: "Current vault fee", value: "10% (current)" },
      { label: "Amount", value: "$25.00" },
      { label: "Share preview", value: "24 vault shares" },
      { label: "Minimum shares", value: "23.976 vault shares" },
    ],
    action: { ...action, id: "storybook-savings-review", kind: "savings-deposit", title: "Deposit USDC" },
  },
  play: async ({ canvasElement }) => {
    await checkRows(canvasElement, [
      ["From", "0x1111…111111"], ["Vault", "Gauntlet USDC Prime"],
      ["Network", "Base (8453)"], ["Discovery APY", "4.6% · fresh"],
      ["Current vault fee", "10% (current)"], ["Amount", "$25.00"],
      ["Share preview", "24 vault shares"], ["Minimum shares", "23.976 vault shares"],
      ["Network fee", "Up to 0.02 USDC · ≈ $0.02"],
    ]);
  },
};
