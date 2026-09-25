import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
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
