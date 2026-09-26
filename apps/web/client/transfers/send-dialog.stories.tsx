import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import type { PreparedMoneyAction, OperationResult } from "@/shared/money-actions/types";
import { TransferExecutionError } from "@/shared/transfers/types";
import { encodeUsdcTransfer } from "@/shared/transfers/transfer-helpers";
import { SendDialog } from "./send-dialog";

const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
const action: PreparedMoneyAction = {
  id: "11111111-1111-4111-8111-111111111111", kind: "send", title: "Send USDC",
  createdAt: "2026-09-23T10:35:00.000Z", expiresAt: "2099-09-23T10:45:00.000Z",
  owner: { subject: "send-story", address: "0x1111111111111111111111111111111111111111", chainId: 8453, accountProvider: "cdp-embedded" },
  amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
  calls: [{ to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", data: encodeUsdcTransfer(RECIPIENT, BigInt(1000000)), value: "0" }],
  warnings: [],
};
const meta = {
  id: "transfers-send-dialog",
  title: "Transfers/Send dialog",
  component: SendDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true, immediate: true, address: action.owner.address, ownerBoundary: "send-story", resumeActionId: action.id,
    prepareMoneyAction: async () => action, resumeMoneyAction: async () => action,
    fetchAccountResource: async (url: string) => url === "/api/actions" ? { actions: [] } : { version: 1, recipients: [] },
    executeMoneyAction: async (): Promise<OperationResult> => ({ id: action.id, status: "submitted" as const }), onClose: () => {},
  },
} satisfies Meta<typeof SendDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function canvas(documentBody: HTMLElement) {
  return within(documentBody.ownerDocument.body);
}

export const Submitting: Story = {
  args: { executeMoneyAction: () => new Promise(() => {}) },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    const primary = await screen.findByRole("button", { name: "Send $1.00" });
    primary.focus();
    await userEvent.click(primary);
    await expect(primary).toHaveAttribute("aria-busy", "true");
    await expect(primary).toHaveAttribute("aria-disabled", "true");
    await expect(primary).toHaveFocus();
    await expect(screen.queryByText("Waiting for your wallet…")).toBeNull();
  },
};

export const Pending: Story = {
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Send $1.00" }));
    await expect(await screen.findByRole("heading", { name: "$1.00 on its way" })).toBeVisible();
    await expect(screen.getByText("Submitted")).toBeVisible();
    await expect(screen.getByText("Confirming on Base")).toBeVisible();
    await expect(screen.getByRole("button", { name: "View in Activity" })).toBeVisible();
  },
};

export const Ambiguous: Story = {
  args: { executeMoneyAction: async () => { throw new TransferExecutionError("submission-unknown"); } },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Send $1.00" }));
    await expect(await screen.findByRole("heading", { name: "We can't confirm $1.00" })).toBeVisible();
    await expect(screen.getByRole("button", { name: "View in Activity" })).toBeVisible();
    await expect(screen.queryByRole("button", { name: /try again|retry/i })).toBeNull();
  },
};

export const Rejected: Story = {
  args: { executeMoneyAction: async () => ({ id: action.id, status: "rejected" }) },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Send $1.00" }));
    await expect(await screen.findByRole("alert")).toHaveTextContent("The wallet request was rejected. Your reviewed send is still ready to retry.");
    await expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  },
};

const withdrawAction: PreparedMoneyAction = {
  ...action, id: "22222222-2222-4222-8222-222222222222", kind: "cash-out-withdraw", title: "Withdraw cash-out",
  owner: { ...action.owner, subject: "withdraw-story" },
  calls: [{ to: "0x777777779d229cdF3110e9de47943791c26300Ef", data: "0x1234", value: "0" }],
  amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "2000000", direction: "receive" }],
  metadata: {
    product: "cashout", operation: "withdraw", providerId: "peer", providerName: "Peer", environment: "production",
    platform: "cashapp", platformLabel: "Cash App", currency: "USD", depositId: "0xescrow_7", approximateFiatAmount: "0", etaSeconds: null,
    minConversionRate: "1", intentAmountRange: { min: "2000000", max: "2000000" },
    estimateAsOf: "2026-09-23T10:35:00.000Z", escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
  },
};

export const WithdrawalPending: Story = {
  args: {
    ownerBoundary: "withdraw-story", resumeActionId: withdrawAction.id,
    prepareMoneyAction: async () => withdrawAction, resumeMoneyAction: async () => withdrawAction,
    executeMoneyAction: async (): Promise<OperationResult> => ({ id: withdrawAction.id, status: "submitted" as const }),
  },
  play: async ({ canvasElement }) => {
    const screen = canvas(canvasElement);
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw $2.00" }));
    await expect(await screen.findByRole("heading", { name: "Returning $2.00 to your account" })).toBeVisible();
    await expect(screen.queryByText(/payout/i)).toBeNull();
    await expect(screen.getByRole("button", { name: "View in Activity" })).toBeVisible();
  },
};
